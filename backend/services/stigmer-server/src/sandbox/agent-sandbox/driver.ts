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
 *     restarts, so a turn in flight is never disturbed. A runner the
 *     kubelet restarts boots with the token of the latest ensure, which is
 *     valid for hours after it (a sandbox token's lifetime, lane.ts). So
 *     the one runner that can boot with an expired token is one restarted
 *     longer than that after its session's last ensure. The idle sweep
 *     (sweep.ts) suspends a session's sandbox long before that, so only a
 *     session busy for longer, with no new turn to ensure it, reaches it.
 *   - being deleted: wait, bounded by the pod's grace period, until it is
 *     gone (with its pod and claim: gateway.ts deletes in the foreground),
 *     then create it.
 *
 * No readiness wait after any arm: a sandbox that never polls its queue
 * surfaces as the activity's ScheduleToStartTimeout, and the ensure step's
 * error stamp names a provisioning failure (a missing agent-sandbox
 * install among them, gateway.ts).
 *
 * Every ensure, suspend and delete of one Sandbox runs through one
 * in-process queue, so a turn and the idle sweep never interleave their
 * writes to one sandbox in one server. The sweep's suspend takes a guard
 * it answers inside that queue, from fresh reads, right before the patch
 * (sweep.ts).
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

/**
 * How often, and how many times, an ensure re-reads a Sandbox being
 * deleted: a foreground delete lasts as long as its pod takes to stop, up
 * to the pod's 600-second grace period (manifest.ts), so the wait covers
 * that and a minute more.
 */
const DELETION_POLL_MS = 2_000;
const DELETION_POLLS = 330;

/** The path an ensure took, logged so a wake is told apart from a create. */
type EnsureArm = "created" | "suspended" | "running";

export interface AgentSandboxDriverLogger {
  info: (msg: string, fields?: Record<string, unknown>) => void;
}

/** What a suspend did: patched the Sandbox Suspended, or found nothing to do. */
export type AgentSandboxSuspendOutcome = "done" | "skipped";

/** What the idle sweep needs of the driver beside its provisioner. */
export interface AgentSandboxDriverInternals {
  readonly gateway: AgentSandboxGateway;
  /** When this process last ensured the Sandbox, if it has. */
  lastEnsuredAt(name: string): Date | undefined;
  /**
   * Suspends the Sandbox inside its queue, once `proceed` answers true for
   * the Sandbox as read there; a Sandbox that is gone, being deleted or
   * already Suspended is skipped without asking.
   */
  suspend(
    name: string,
    proceed: (fresh: AgentSandboxView) => Promise<boolean>,
  ): Promise<AgentSandboxSuspendOutcome>;
}

export interface AgentSandboxDriverOptions {
  readonly gateway: AgentSandboxGateway;
  readonly config: SandboxDriverConfig;
  readonly logger: AgentSandboxDriverLogger;
  /** Waits between reads of a Sandbox being deleted; a test passes its own. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** The driver's provisioner alone: the test seam for everything but the sweep. */
export function newAgentSandboxProvisionerOverGateway(
  options: AgentSandboxDriverOptions,
): SandboxProvisioner {
  return newAgentSandboxDriverOverGateway(options).provisioner;
}

/** The driver over an injected gateway: its provisioner and what its idle sweep needs. */
export function newAgentSandboxDriverOverGateway(
  options: AgentSandboxDriverOptions,
): {
  readonly provisioner: SandboxProvisioner;
  readonly internals: AgentSandboxDriverInternals;
} {
  const { gateway, config, logger } = options;
  const now = options.now ?? Date.now;
  const ensuredAt = new Map<string, number>();
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
      ensuredAt.set(name, now());
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
    ensuredAt.delete(name);
    logger.info("agent-sandbox sandbox deprovisioned", {
      scope,
      id,
      sandbox: name,
    });
  }

  const internals: AgentSandboxDriverInternals = {
    gateway,
    lastEnsuredAt: (name) => {
      const at = ensuredAt.get(name);
      return at === undefined ? undefined : new Date(at);
    },
    suspend: (name, proceed) =>
      serialize(name, async (): Promise<AgentSandboxSuspendOutcome> => {
        const fresh = await gateway.getSandbox(name);
        if (
          fresh === undefined ||
          fresh.deleting ||
          fresh.operatingMode !== "Running" ||
          !(await proceed(fresh))
        ) {
          return "skipped";
        }
        await gateway.patchSandbox(name, { operatingMode: "Suspended" });
        return "done";
      }),
  };

  const provisioner: SandboxProvisioner = {
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
  return { provisioner, internals };
}
