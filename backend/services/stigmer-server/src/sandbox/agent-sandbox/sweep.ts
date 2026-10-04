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
 * sweep needs no map from names back to sessions. It suspends only a
 * Sandbox whose session this server's store knows, idle by that store's
 * executions. Every Stigmer server labels its Sandboxes the same way, so a
 * second server pointed at the same namespace lists this one's too; this
 * store holds no executions for their sessions, and reading that as idle
 * would put another server's busy session to sleep. So a Sandbox whose
 * session has no executions here (another server's, or a session deleted
 * while its Sandbox's delete failed) is left alone and logged once; so is
 * one whose label names no session, or another session than its own name
 * says. The sweep never deletes anything: deleting a workspace is the
 * session delete's act, and a wrong read must cost a running pod, not a
 * user's files.
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
  sandboxBaseName,
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
  /** The Sandboxes already logged as left alone, so each is said once per sweep. */
  readonly reported?: Set<string>;
}

/** Starts the sweep: one pass now, then one per interval, never two at once. */
export function startAgentSandboxSweep(
  options: AgentSandboxSweepOptions,
): SandboxBackgroundHandle {
  const { logger, settings } = options;
  let running: Promise<void> | undefined;
  let stopped = false;

  const reported = new Set<string>();
  const tick = (): void => {
    if (stopped || running !== undefined) return;
    running = runAgentSandboxSweepPass({
      ...options,
      stopping: () => stopped,
      reported,
    })
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
  const reported = options.reported ?? new Set<string>();
  const leftAlone = (
    sandbox: AgentSandboxView,
    message: string,
    fields: Record<string, unknown>,
  ): void => {
    if (reported.has(sandbox.name)) return;
    reported.add(sandbox.name);
    logger.warn(message, { sandbox: sandbox.name, ...fields });
  };
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
        // No label, no session to read: nothing says it is idle, and an
        // ensure never puts the label back, so a sleep here could come
        // mid-turn after every wake. Left alone, and said.
        leftAlone(
          sandbox,
          "agent-sandbox sandbox names no session; left it alone",
          {},
        );
        continue;
      }
      // A label that names another session than the Sandbox's own name
      // (edited or copied by hand) could put a busy session's pod to sleep
      // on another session's idleness: left alone, and said.
      if (sandbox.name !== sandboxBaseName("session", sessionId)) {
        leftAlone(
          sandbox,
          "agent-sandbox sandbox's session label does not match its name; left it alone",
          { sessionId },
        );
        continue;
      }
      let activity = await sessions.recentActivity(sessionId);
      if (activity.lastActiveAt === undefined) {
        // The cheap read may lag; only the full read says the session has
        // no executions in this store at all.
        activity = await sessions.activity(sessionId);
        if (activity.lastActiveAt === undefined) {
          leftAlone(
            sandbox,
            "agent-sandbox sandbox's session has no executions in this server's store (another server's, or a deleted session's); left it alone",
            { sessionId },
          );
          continue;
        }
      }
      if (!decide(sandbox, activity, options, now())) continue;
      const outcome = await driver.suspend(sandbox.name, async (fresh) => {
        const latest = await sessions.activity(sessionId);
        return (
          latest.lastActiveAt !== undefined &&
          decide(fresh, latest, options, now())
        );
      });
      if (outcome !== "done") continue;
      logger.info("agent-sandbox sandbox suspended (idle)", {
        sandbox: sandbox.name,
        sessionId,
      });
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
