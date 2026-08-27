/**
 * The Docker sandbox driver — DD-002's second isolation tier, built by
 * O6 (20260827.05). Each sandbox is one container running the published
 * runner image, polling exactly one task queue. Mechanism per the
 * mid-session owner ruling: the docker CLI via child_process — zero new
 * dependencies, present wherever this tier's audience (dev and small
 * self-host boxes) already has Docker; the driver seam keeps an
 * Engine-API swap mechanical if demand appears.
 *
 * The ensure state machine (the Java KubernetesSandboxProvisioner's
 * arms, minus the cloud-only archive ladder): container absent → run;
 * exists but stopped → start; running → fast path. State is derived
 * from the container itself — name + labels — never a store table (gate
 * ruling Q4).
 *
 * Deliberate divergences from the cloud manifest, named:
 *
 *   - MODE=local, not cloud: the runner's MODE distinguishes
 *     proxy-transport posture (cloud routes LLM/artifact traffic through
 *     the proxy and REQUIRES a token), not isolation. An OSS container
 *     talks to the backend directly, exactly like the compose stack's
 *     runner container.
 *   - The token rides `docker run -e STIGMER_TOKEN` with the VALUE
 *     supplied through the CLI's environment (never argv — argv is
 *     world-readable in the host process table). It remains visible in
 *     `docker inspect`, the same trust boundary as the cloud's
 *     per-sandbox Secret (cluster admins can read those too).
 *
 * Both endpoints are construct-time REQUIRED: a container cannot reach
 * the server or Temporal on this process's localhost, and a driver that
 * launched sandboxes pointing nowhere would fail as activity timeouts
 * minutes later — the loud-fail doctrine puts the error at boot instead.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxProvisionerFactory,
  SandboxScope,
} from "./provisioner.js";
import {
  SANDBOX_ID_LABEL,
  SANDBOX_MANAGED_BY_LABEL,
  SANDBOX_MANAGED_BY_VALUE,
  SANDBOX_SCOPE_LABEL,
  sandboxBaseName,
} from "./naming.js";

const execFileAsync = promisify(execFile);

/**
 * The runner entrypoint inside the sandbox image — the image's CMD is
 * /bin/bash by design (Dockerfile.sandbox: the provisioner sets the
 * command, exactly as the cloud pod spec does).
 */
const RUNNER_CONTAINER_COMMAND = ["node", "/runner/dist/main.js"];

/** The in-container workspace mount point (the cloud manifest's value). */
const CONTAINER_WORKSPACE_DIR = "/workspace";

export const newDockerSandboxProvisioner: SandboxProvisionerFactory = ({
  config,
  logger,
}) => {
  if (config.backendEndpoint === "") {
    throw new Error(
      "sandbox provisioner 'docker' requires STIGMER_SANDBOX_BACKEND_ENDPOINT — a container cannot reach the server on this process's localhost",
    );
  }
  if (config.temporalAddress === "") {
    throw new Error(
      "sandbox provisioner 'docker' requires STIGMER_SANDBOX_TEMPORAL_ADDRESS (or TEMPORAL_HOST_PORT) reachable from inside a container",
    );
  }

  async function docker(
    args: string[],
    env?: NodeJS.ProcessEnv,
  ): Promise<string> {
    const { stdout } = await execFileAsync("docker", args, {
      env: env ?? process.env,
    });
    return stdout.trim();
  }

  /** Live container state by name: absent | stopped | running (Q5's probe). */
  async function inspectState(name: string): Promise<SandboxProbeState> {
    try {
      const running = await docker([
        "inspect",
        "--format",
        "{{.State.Running}}",
        name,
      ]);
      return running === "true" ? "running" : "stopped";
    } catch (error) {
      if (isNoSuchContainer(error)) {
        return "absent";
      }
      throw error;
    }
  }

  async function ensure(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): Promise<void> {
    const name = sandboxBaseName(scope, id);
    const state = await inspectState(name);
    if (state === "running") {
      return; // The fast path.
    }
    if (state === "stopped") {
      // The scale-up arm: the container keeps its original env (token
      // included) — the cloud's defer-restart posture for a stale token
      // degenerates here to "the next full recreate re-mints" (Q6).
      await docker(["start", name]);
      logger.info("Docker sandbox restarted", { scope, id, container: name });
      return;
    }
    const runArgs = [
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `${SANDBOX_MANAGED_BY_LABEL}=${SANDBOX_MANAGED_BY_VALUE}`,
      "--label",
      `${SANDBOX_SCOPE_LABEL}=${scope}`,
      "--label",
      `${SANDBOX_ID_LABEL}=${id}`,
      "--env",
      "MODE=local",
      "--env",
      `STIGMER_TASK_QUEUE=${env.taskQueue}`,
      "--env",
      `STIGMER_BACKEND_ENDPOINT=${config.backendEndpoint}`,
      "--env",
      `TEMPORAL_SERVICE_ADDRESS=${config.temporalAddress}`,
      "--env",
      `WORKSPACE_ROOT_DIR=${CONTAINER_WORKSPACE_DIR}`,
    ];
    let runEnv: NodeJS.ProcessEnv | undefined;
    if (env.stigmerToken !== "") {
      // Value-less --env inherits from the CLI's environment (module
      // header: the token must never appear in argv).
      runArgs.push("--env", "STIGMER_TOKEN");
      runEnv = { ...process.env, STIGMER_TOKEN: env.stigmerToken };
    }
    runArgs.push(config.runnerImage, ...RUNNER_CONTAINER_COMMAND);
    await docker(runArgs, runEnv);
    logger.info("Docker sandbox provisioned", {
      scope,
      id,
      container: name,
      taskQueue: env.taskQueue,
      image: config.runnerImage,
    });
  }

  async function deprovision(scope: SandboxScope, id: string): Promise<void> {
    const name = sandboxBaseName(scope, id);
    try {
      await docker(["rm", "--force", name]);
      logger.info("Docker sandbox deprovisioned", {
        scope,
        id,
        container: name,
      });
    } catch (error) {
      if (isNoSuchContainer(error)) {
        return; // Missing is success — idempotent teardown.
      }
      throw error;
    }
  }

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
    probe: (scope, id) => inspectState(sandboxBaseName(scope, id)),
  };
  return provisioner;
};

/** Docker CLI's not-found shapes ("No such container"/"No such object"). */
function isNoSuchContainer(error: unknown): boolean {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as { stderr?: string }).stderr ?? ""}`
      : String(error);
  return text.includes("No such container") || text.includes("No such object");
}
