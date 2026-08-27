/**
 * The local-process sandbox driver — DD-002's first isolation tier
 * (process → Docker → Kubernetes), built by O6 (20260827.05, gate ruling
 * Q1: a REAL driver, not a named no-op). Each sandbox is a managed
 * runner child process polling exactly one task queue, with its own
 * isolated workspace directory — today's implicit "the runner is a local
 * process" posture made explicit and per-execution.
 *
 * The child's env is the runner's verified contract
 * (backend/services/runner/src/config.ts): MODE=local,
 * STIGMER_TASK_QUEUE (the one queue this sandbox serves),
 * STIGMER_BACKEND_ENDPOINT / TEMPORAL_SERVICE_ADDRESS (empty values fall
 * back to the runner's own local defaults and Temporal self-discovery),
 * STIGMER_TOKEN when minted ("" stays unset — optional in local mode),
 * and a per-sandbox WORKSPACE_ROOT_DIR so concurrent sandboxes never
 * share a workspace.
 *
 * Process lifecycle facts this driver leans on deliberately:
 *
 *   - The check-spawn-record section of ensure has NO awaits, so
 *     concurrent ensures for one id cannot double-spawn (single-threaded
 *     atomicity — the same reason the map needs no lock).
 *   - An exited child removes itself from the table, so the next ensure
 *     observes "absent" and respawns — the state machine's repair arm
 *     without stored state (gate ruling Q4: runtime-derived).
 *   - Children are killed on server-process exit (the exit hook below):
 *     a process-tier sandbox must not outlive the server that provisions
 *     it — unlike the container tiers, nothing could ever re-adopt it.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { Logger } from "../boot/logger.js";
import type {
  SandboxEnvironment,
  SandboxProbeState,
  SandboxProvisioner,
  SandboxProvisionerFactory,
  SandboxScope,
} from "./provisioner.js";

/** SIGTERM-first teardown; the runner's Temporal worker drains on it. */
const DEPROVISION_SIGNAL: NodeJS.Signals = "SIGTERM";

export const newLocalProcessSandboxProvisioner: SandboxProvisionerFactory = ({
  config,
  logger,
}) => {
  const children = new Map<string, ChildProcess>();

  // A process-tier sandbox dies with the server (module header). "exit"
  // allows only synchronous work — kill() is.
  process.once("exit", () => {
    for (const child of children.values()) {
      child.kill(DEPROVISION_SIGNAL);
    }
  });

  function key(scope: SandboxScope, id: string): string {
    return `${scope}:${id}`;
  }

  function ensure(
    scope: SandboxScope,
    id: string,
    env: SandboxEnvironment,
  ): void {
    // No awaits from here to children.set — the double-spawn guard.
    const existing = children.get(key(scope, id));
    if (
      existing !== undefined &&
      existing.exitCode === null &&
      !existing.killed
    ) {
      return; // Running — the fast path.
    }

    const workspaceRoot = path.join(
      homedir(),
      ".stigmer",
      "sandboxes",
      `${scope}-${id}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MODE: "local",
      STIGMER_TASK_QUEUE: env.taskQueue,
      WORKSPACE_ROOT_DIR: workspaceRoot,
    };
    if (config.backendEndpoint !== "") {
      childEnv["STIGMER_BACKEND_ENDPOINT"] = config.backendEndpoint;
    }
    if (config.temporalAddress !== "") {
      childEnv["TEMPORAL_SERVICE_ADDRESS"] = config.temporalAddress;
    }
    if (env.stigmerToken !== "") {
      childEnv["STIGMER_TOKEN"] = env.stigmerToken;
    }

    // stdio inherits: the process tier's sandbox logs belong in the
    // server's own stream (the container tiers get per-container logs).
    const child = spawn(config.runnerCommand, [], {
      env: childEnv,
      stdio: "inherit",
    });
    children.set(key(scope, id), child);
    logger.info("Local-process sandbox started", {
      scope,
      id,
      pid: child.pid ?? -1,
      taskQueue: env.taskQueue,
    });
    child.once("exit", (code, signal) => {
      // Self-removal IS the repair arm: the next ensure sees absent.
      // Guarded to THIS child — a deprovisioned child's late exit event
      // must never clobber a replacement ensured under the same key.
      if (children.get(key(scope, id)) === child) {
        children.delete(key(scope, id));
      }
      logger.info("Local-process sandbox exited", {
        scope,
        id,
        code: code ?? -1,
        signal: signal ?? "",
      });
    });
    child.once("error", (error) => {
      // Spawn failures (command not found) surface here asynchronously;
      // the exit handler above never fires for them. Same self-guard.
      if (children.get(key(scope, id)) === child) {
        children.delete(key(scope, id));
      }
      logger.error("Local-process sandbox failed to start", {
        scope,
        id,
        command: config.runnerCommand,
        error: error.message,
      });
    });
  }

  function deprovision(scope: SandboxScope, id: string): void {
    const child = children.get(key(scope, id));
    if (child === undefined) {
      return; // Missing is success — idempotent teardown.
    }
    children.delete(key(scope, id));
    child.kill(DEPROVISION_SIGNAL);
    logger.info("Local-process sandbox deprovisioned", { scope, id });
  }

  const provisioner: SandboxProvisioner = {
    async ensureSessionSandbox(sessionId, env) {
      ensure("session", sessionId, env);
    },
    async deprovisionSessionSandbox(sessionId) {
      deprovision("session", sessionId);
    },
    async ensureWorkflowSandbox(executionId, env) {
      ensure("workflow", executionId, env);
    },
    async deprovisionWorkflowSandbox(executionId) {
      deprovision("workflow", executionId);
    },
    async createConnectSandbox(connectRequestId, env) {
      ensure("connect", connectRequestId, env);
      return connectRequestId;
    },
    async deprovisionConnectSandbox(sandboxId) {
      deprovision("connect", sandboxId);
    },
    async probe(scope, id): Promise<SandboxProbeState> {
      const child = children.get(key(scope, id));
      if (child === undefined || child.exitCode !== null || child.killed) {
        // An exited child self-removed (or is mid-removal): a process has
        // no "stopped but resumable" state — absent covers both.
        return "absent";
      }
      return "running";
    },
  };
  return provisioner;
};
