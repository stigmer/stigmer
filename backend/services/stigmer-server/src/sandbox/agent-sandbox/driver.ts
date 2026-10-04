/**
 * The agent-sandbox driver: every sandbox is one agent-sandbox `Sandbox`
 * (kubernetes-sigs/agent-sandbox, resource.ts) in one shared namespace.
 * The Sandbox owns everything about it (its pod, its workspace claim and
 * its Secret), so the cluster's controller and garbage collector do the
 * object management: a pod lost to a node or deleted by hand comes back
 * while the Sandbox is Running, suspending it deletes the pod and keeps
 * the disk, and deleting it removes the rest. State is the cluster's,
 * never a store table; a Sandbox is named sandboxBaseName(scope, id).
 *
 * Shape: the substrate driver's. A gateway is the only surface touching
 * the cluster (gateway.ts), the provisioner is built over it, and
 * newAgentSandboxProvisionerOverGateway is the test seam.
 *
 * The ensure, from the Sandbox's state:
 *
 *   - absent: create it Suspended (its claim is made, no pod starts), then
 *     wake it. A first start and a resume are one path.
 *   - Suspended (wake): write the Secret with a fresh token, owned by the
 *     Sandbox, then one patch setting Running and this server's pod
 *     template, so a woken sandbox runs this server's runner image and
 *     environment, never the one it was created with.
 *   - Running: rewrite the Secret's token and nothing else. Nothing
 *     restarts, so a turn in flight is never disturbed, and a runner the
 *     kubelet restarts later boots with a token that is still valid (a
 *     sandbox token lives for hours, lane.ts, and a pod can outlive it).
 *   - being deleted: wait, bounded, until it is gone (with its pod and
 *     claim: gateway.ts deletes in the foreground), then create it.
 *
 * No readiness wait after any arm: a sandbox that never polls its queue
 * surfaces as the activity's ScheduleToStartTimeout, and the ensure step's
 * error stamp names a provisioning failure (a missing agent-sandbox
 * install among them, gateway.ts).
 *
 * Every ensure and delete of one Sandbox runs through one in-process
 * queue, so two ensures of one sandbox in one server never interleave
 * their writes.
 */
import { sandboxBaseName } from "../naming.js";
import type {
  SandboxDriverConfig,
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxScope,
} from "../provisioner.js";
import type { AgentSandboxGateway } from "./gateway.js";
import {
  buildAgentSandbox,
  buildAgentSandboxPodTemplate,
  buildAgentSandboxSecret,
} from "./manifest.js";
import type { AgentSandboxView } from "./resource.js";

/** How often, and how many times, an ensure re-reads a Sandbox being deleted. */
const DELETION_POLL_MS = 500;
const DELETION_POLLS = 120;

/** The path an ensure took, logged so a wake is told apart from a create. */
type EnsureArm = "created" | "suspended" | "running";

export interface AgentSandboxDriverLogger {
  info: (msg: string, fields?: Record<string, unknown>) => void;
}

export function newAgentSandboxProvisionerOverGateway(options: {
  readonly gateway: AgentSandboxGateway;
  readonly config: SandboxDriverConfig;
  readonly logger: AgentSandboxDriverLogger;
  /** Waits between reads of a Sandbox being deleted; a test passes its own. */
  readonly sleep?: (ms: number) => Promise<void>;
}): SandboxProvisioner {
  const { gateway, config, logger } = options;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const queues = new Map<string, Promise<unknown>>();
  function serialize<T>(name: string, body: () => Promise<T>): Promise<T> {
    const previous = queues.get(name) ?? Promise.resolve();
    const next = previous.then(body, body);
    const settled = next.catch(() => undefined);
    queues.set(name, settled);
    void settled.then(() => {
      if (queues.get(name) === settled) queues.delete(name);
    });
    return next;
  }

  async function settled(name: string): Promise<AgentSandboxView | undefined> {
    for (let poll = 0; poll < DELETION_POLLS; poll += 1) {
      const sandbox = await gateway.getSandbox(name);
      if (sandbox === undefined || !sandbox.deleting) return sandbox;
      await sleep(DELETION_POLL_MS);
    }
    throw new Error(
      `agent-sandbox Sandbox '${name}' is still being deleted after ${(DELETION_POLL_MS * DELETION_POLLS) / 1000}s`,
    );
  }

  async function ensure(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<void> {
    const name = sandboxBaseName(scope, id);
    await serialize(name, async () => {
      let sandbox = await settled(name);
      let arm: EnsureArm;
      if (sandbox === undefined) {
        // Another server may create it between the read and the create;
        // its Sandbox is then this one's to wake.
        sandbox =
          (await gateway.createSandbox(
            buildAgentSandbox(scope, id, env, config),
          )) ?? (await gateway.getSandbox(name));
        if (sandbox === undefined) {
          throw new Error(
            `agent-sandbox Sandbox '${name}' was reported to exist and then could not be read`,
          );
        }
        arm = "created";
      } else {
        arm = sandbox.operatingMode === "Running" ? "running" : "suspended";
      }
      // The Secret before the pod: the pod's environment names its keys.
      await gateway.applySecret(
        buildAgentSandboxSecret(scope, id, env.stigmerToken, config, sandbox),
      );
      if (arm !== "running") {
        await gateway.patchSandbox(name, {
          operatingMode: "Running",
          podTemplate: buildAgentSandboxPodTemplate(scope, id, env, config),
        });
      }
      logger.info("agent-sandbox sandbox ensured", {
        scope,
        id,
        sandbox: name,
        arm,
        taskQueue: env.taskQueue,
      });
    });
  }

  async function deprovision(scope: SandboxScope, id: string): Promise<void> {
    const name = sandboxBaseName(scope, id);
    await serialize(name, () => gateway.deleteSandbox(name));
    logger.info("agent-sandbox sandbox deprovisioned", {
      scope,
      id,
      sandbox: name,
    });
  }

  return {
    ensureSessionSandbox: (sessionId, env) => ensure("session", sessionId, env),
    deprovisionSessionSandbox: (sessionId) => deprovision("session", sessionId),
    ensureWorkflowSandbox: (executionId, env) =>
      ensure("workflow", executionId, env),
    deprovisionWorkflowSandbox: (executionId) =>
      deprovision("workflow", executionId),
    async createConnectSandbox(connectRequestId, env) {
      await ensure("connect", connectRequestId, env);
      return connectRequestId;
    },
    deprovisionConnectSandbox: (sandboxId) => deprovision("connect", sandboxId),
    async probe(scope, id): Promise<SandboxProbeState> {
      const sandbox = await gateway.getSandbox(sandboxBaseName(scope, id));
      if (sandbox === undefined || sandbox.deleting) return "absent";
      return sandbox.operatingMode === "Running" ? "running" : "stopped";
    },
  };
}
