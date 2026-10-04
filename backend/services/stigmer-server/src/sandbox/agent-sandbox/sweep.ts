/**
 * The agent-sandbox driver's idle sweep: it suspends a session's Sandbox
 * once its session has been idle for the window (config.ts), so an idle
 * session holds a kept workspace claim instead of a running pod, and its
 * next message wakes it over the same files (driver.ts, the wake path).
 * Open source keeps no record of its sandboxes, so the sweep keeps none
 * either: it lists the cluster's Sandboxes and reads what the server
 * already has about each session (SessionActivityReader).
 *
 * Only session sandboxes sleep. A workflow's sandbox is ensured once,
 * before the workflow starts, and nothing would wake it for the workflow's
 * next activity; a connect sandbox lives for one request. Both end when
 * their run ends (sandbox/steps.ts). The list asks for session Sandboxes
 * by their labels.
 *
 * A Sandbox names its session in its `stigmer.ai/sandbox-id` label, so the
 * sweep needs no map from names back to sessions. A Sandbox whose session
 * has no executions (the session is gone, and its delete did not remove
 * the Sandbox) reads as idle since its creation and is suspended like any
 * other, and so is one of ours that names no session; both are logged,
 * and neither is ever deleted: deleting a workspace is the session
 * delete's act, and a wrong read must cost a sleeping pod, not a user's
 * files.
 *
 * Each suspend is decided twice: once from the pass's reads, then again
 * inside the driver's per-sandbox queue right before the patch, from
 * fresh reads. The pass reads only what changed in the session since its
 * last look (SessionActivityReader.recentActivity), which may lag a
 * recovered run but never makes a session look busier or later than it
 * is; the second decision reads the session's every execution, so a lag
 * can only cost a suspend that the second decision refuses. Every turn's
 * execution is saved before its ensure runs (the create chain persists,
 * starts the workflow, then ensures), so a turn that has begun reads as
 * busy there. A turn whose ensure lands on another server replica between
 * this replica's second decision and its patch loses its pod and times
 * out; the user's next message wakes the sandbox again.
 */
import type { Logger } from "../../boot/logger.js";
import {
  SANDBOX_ID_LABEL,
  SANDBOX_MANAGED_BY_LABEL,
  SANDBOX_MANAGED_BY_VALUE,
  SANDBOX_SCOPE_LABEL,
} from "../naming.js";
import type {
  SandboxBackgroundHandle,
  SessionActivity,
  SessionActivityReader,
} from "../provisioner.js";
import type { AgentSandboxDriverSettings } from "./config.js";
import type { AgentSandboxDriverInternals } from "./driver.js";
import { shouldSuspend } from "./idle-decision.js";
import type { AgentSandboxView } from "./resource.js";

/** The labels that pick this server's session Sandboxes out of the namespace. */
export const SESSION_SANDBOX_SELECTOR = `${SANDBOX_MANAGED_BY_LABEL}=${SANDBOX_MANAGED_BY_VALUE},${SANDBOX_SCOPE_LABEL}=session`;

export interface AgentSandboxSweepOptions {
  readonly driver: AgentSandboxDriverInternals;
  readonly settings: AgentSandboxDriverSettings;
  readonly sessions: SessionActivityReader;
  readonly logger: Logger;
  readonly now?: () => number;
  /** True once the sweep is stopping: a pass ends between sandboxes. */
  readonly stopping?: () => boolean;
}

/** Starts the sweep: one pass now, then one per interval, never two at once. */
export function startAgentSandboxSweep(
  options: AgentSandboxSweepOptions,
): SandboxBackgroundHandle {
  const { logger, settings } = options;
  let running: Promise<void> | undefined;
  let stopped = false;

  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = runAgentSandboxSweepPass({ ...options, stopping: () => stopped })
      .catch((error: unknown) => {
        logger.error("agent-sandbox idle sweep pass failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        running = undefined;
      });
  };
  const timer = setInterval(tick, settings.sweepIntervalSeconds * 1000);
  timer.unref();
  tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}

/** One pass over this server's session Sandboxes. */
export async function runAgentSandboxSweepPass(
  options: AgentSandboxSweepOptions,
): Promise<void> {
  const { driver, sessions, logger } = options;
  const now = options.now ?? Date.now;
  const stopping = options.stopping ?? (() => false);
  const sandboxes = await driver.gateway.listSandboxes(
    SESSION_SANDBOX_SELECTOR,
  );

  for (const sandbox of sandboxes) {
    if (sandbox.operatingMode !== "Running" || sandbox.deleting) continue;
    // A shutdown waits for the sandbox in hand, never for the whole pass.
    if (stopping()) return;
    try {
      const sessionId = sandbox.labels[SANDBOX_ID_LABEL] ?? "";
      if (sessionId === "") {
        await suspendUnnamed(sandbox, options);
        continue;
      }
      const planned = decide(
        sandbox,
        await sessions.recentActivity(sessionId),
        options,
        now(),
      );
      if (!planned) continue;
      let lastActivity: SessionActivity | undefined;
      const outcome = await driver.suspend(sandbox.name, async (fresh) => {
        lastActivity = await sessions.activity(sessionId);
        return decide(fresh, lastActivity, options, now());
      });
      if (outcome !== "done") continue;
      if (lastActivity?.lastActiveAt === undefined) {
        logger.error(
          "agent-sandbox sandbox's session has no executions; suspended it (its workspace is kept)",
          { sandbox: sandbox.name, sessionId },
        );
      } else {
        logger.info("agent-sandbox sandbox suspended (idle)", {
          sandbox: sandbox.name,
          sessionId,
        });
      }
    } catch (error) {
      logger.warn("agent-sandbox idle sweep skipped a sandbox", {
        sandbox: sandbox.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Whether to suspend: the latest of the session's activity, this process's last ensure and the Sandbox's creation is the idle clock's start. */
function decide(
  sandbox: AgentSandboxView,
  activity: SessionActivity,
  options: AgentSandboxSweepOptions,
  now: number,
): boolean {
  const stamps = [
    activity.lastActiveAt?.getTime(),
    options.driver.lastEnsuredAt(sandbox.name)?.getTime(),
    sandbox.createdAt?.getTime(),
  ].filter((ms): ms is number => ms !== undefined);
  return shouldSuspend({
    operatingMode: sandbox.operatingMode,
    deleting: sandbox.deleting,
    busy: activity.busy,
    lastActiveAt: new Date(stamps.length > 0 ? Math.max(...stamps) : now),
    now: new Date(now),
    suspendAfterMs: options.settings.suspendAfterSeconds * 1000,
  });
}

async function suspendUnnamed(
  sandbox: AgentSandboxView,
  options: AgentSandboxSweepOptions,
): Promise<void> {
  const outcome = await options.driver.suspend(sandbox.name, async () => true);
  if (outcome === "done") {
    options.logger.error(
      "agent-sandbox sandbox names no session; suspended it (its workspace is kept)",
      { sandbox: sandbox.name },
    );
  }
}
