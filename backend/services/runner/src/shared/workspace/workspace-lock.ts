/**
 * Per-workspace turn lock — serializes agent-execution turns that share a
 * working tree.
 *
 * Why this exists: the file-review substrate (shared/filereview) computes a
 * turn's change set as `git diff baselineTree candidateTree`, where both trees
 * are live snapshots of the working directory at turn start/end. That model is
 * correct for a single writer, but nothing scopes a working tree to one
 * execution: sessions declaring the same `localPath` (or sharing the runner's
 * `workspaceRootDir`) resolve to the SAME directory, and the runner happily
 * runs activities concurrently. A concurrent turn's write landing between
 * another turn's baseline and candidate gets misattributed to that other turn
 * (observed in prod: aex_01kwpzhmvbvwqdez9cb331nekr reviewed a notes.md it
 * never wrote). The same race lets a reject-reconcile in one session silently
 * revert a file another session's user just approved.
 *
 * Why a FILE lock and not in-process/server-side coordination: the shared
 * resource is a directory on one host. A `localPath` entry resolves to the
 * user's literal directory in ANY runner process on the machine — the CLI
 * daemon and the desktop app's embedded runner can contend on one tree while
 * answering to DIFFERENT control planes, so no single server can see all
 * contenders and no in-process mutex can exclude a sibling process. Mutual
 * exclusion must live where the collision happens: the filesystem.
 *
 * Mechanics (proper-lockfile):
 * - The lock artifact lives under `~/.stigmer/workspace-locks/{key}.lock`,
 *   NEVER inside the user's workspace (issue #173: attaching a real repo must
 *   leave no Stigmer droppings). The key is sha256(realpath(workspaceRoot)),
 *   so symlink aliases of one directory converge on one lock — the same
 *   keying pattern as getHitlGateDir in platform-dir.ts.
 * - While held, proper-lockfile refreshes the artifact's mtime on an interval;
 *   if the holder process dies, refreshing stops and the artifact goes stale,
 *   so the next waiter simply takes over. A crashed runner can never deadlock
 *   a workspace, and no human ever has to delete a lock file.
 * - Deadlock-free by construction: an activity holds at most ONE lock (its
 *   primary workspace root), and a turn that pauses for human approval ENDS
 *   its activity — releasing the lock — so a change set sitting unreviewed
 *   never blocks the workspace.
 */

import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import lockfile from "proper-lockfile";

/** How long a waiter polls between acquisition attempts. */
const DEFAULT_POLL_INTERVAL_MS = 1_000;

/**
 * Default bound on how long an execution waits for a contended workspace
 * before failing with {@link WorkspaceLockTimeoutError}. Generous — an agent
 * turn legitimately runs for minutes — but finite, so a pathological holder
 * produces an explicit, actionable failure instead of an invisible hang.
 */
export const DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS = 15 * 60 * 1_000;

/**
 * How long a lock artifact may go un-refreshed before waiters treat the
 * holder as dead and take over. proper-lockfile refreshes at stale/2, so a
 * live holder can never be usurped; only a crashed process trips this.
 */
const DEFAULT_STALE_MS = 10_000;

/** The acquisition wait exceeded its bound — the workspace stayed busy. */
export class WorkspaceLockTimeoutError extends Error {
  constructor(workspaceRoot: string, waitedMs: number) {
    super(
      `Workspace is in use by another session: ${workspaceRoot} ` +
      `(waited ${Math.round(waitedMs / 1000)}s). Another agent execution is ` +
      `operating on this workspace directory; retry after it finishes.`,
    );
    this.name = "WorkspaceLockTimeoutError";
  }
}

/** The acquisition wait was cancelled (e.g. the user cancelled the execution). */
export class WorkspaceLockCancelledError extends Error {
  constructor(workspaceRoot: string) {
    super(`Workspace lock wait cancelled for ${workspaceRoot}`);
    this.name = "WorkspaceLockCancelledError";
  }
}

export interface AcquireWorkspaceLockOptions {
  /**
   * Invoked once, when the first acquisition attempt finds the workspace
   * held by another turn — the hook for surfacing a visible "waiting for
   * workspace" state to the user. Never invoked on an uncontended acquire.
   */
  readonly onWaiting?: () => void | Promise<void>;
  /** Invoked on every poll while waiting (Temporal activity liveness). */
  readonly heartbeat?: () => void;
  /** Aborts the wait immediately (Temporal activity cancellation). */
  readonly signal?: AbortSignal;
  /** Max wait before {@link WorkspaceLockTimeoutError}. */
  readonly timeoutMs?: number;
  /** Poll interval override (tests). */
  readonly pollIntervalMs?: number;
  /** Staleness bound override (tests). */
  readonly staleMs?: number;
  /** Lock-artifact directory override (tests). */
  readonly lockDir?: string;
}

/** Idempotent releaser returned by {@link acquireWorkspaceLock}. */
export type ReleaseWorkspaceLock = () => Promise<void>;

/** Runner-owned home for lock artifacts (HOME override honored, as in platform-dir.ts). */
function defaultLockDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".stigmer", "workspace-locks");
}

/**
 * Acquire the exclusive turn lock for a workspace working tree, waiting (with
 * heartbeats and cancellation) while another turn holds it.
 *
 * The caller must hold the lock across the turn's ENTIRE tree-mutating window
 * — decision reconcile, HITL gate install, the agent's own writes, and the
 * candidate capture — and release it in a `finally` as the last
 * workspace-touching step.
 */
export async function acquireWorkspaceLock(
  workspaceRoot: string,
  options: AcquireWorkspaceLockOptions = {},
): Promise<ReleaseWorkspaceLock> {
  const {
    onWaiting,
    heartbeat,
    signal,
    timeoutMs = DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    staleMs = DEFAULT_STALE_MS,
    lockDir = defaultLockDir(),
  } = options;

  // Resolve symlink aliases so every path spelling of one directory contends
  // on one lock. The resolved path is also what we hand proper-lockfile as
  // the target (with realpath:false — already resolved here). A root that
  // does not exist yet cannot be realpath'd, so it locks on its canonical
  // absolute spelling instead — proper-lockfile never touches the target
  // itself (the artifact lives at lockfilePath), so the lock still works.
  const resolvedRoot = await realpath(workspaceRoot).catch(() => resolve(workspaceRoot));
  const key = createHash("sha256").update(resolvedRoot).digest("hex").slice(0, 16);
  await mkdir(lockDir, { recursive: true });
  const lockfilePath = join(lockDir, `${key}.lock`);

  const startedAt = Date.now();
  let waitingReported = false;

  for (;;) {
    if (signal?.aborted) {
      throw new WorkspaceLockCancelledError(resolvedRoot);
    }

    try {
      const release = await lockfile.lock(resolvedRoot, {
        lockfilePath,
        realpath: false,
        stale: staleMs,
        // No library-side retries: the wait loop below owns retry policy so it
        // can heartbeat, report waiting, honor cancellation, and bound the wait.
        retries: 0,
        // A compromised lock (artifact vanished / refresh missed its staleness
        // window under extreme event-loop stall) must not crash the worker
        // process — the default behavior throws uncaught. Log loudly and let
        // the turn finish: the exposure is bounded to pre-lock semantics.
        onCompromised: (err) => {
          console.error(
            `[workspace-lock] lock on ${resolvedRoot} compromised mid-turn ` +
            `(continuing unlocked): ${err}`,
          );
        },
      });

      if (waitingReported) {
        console.log(
          `[workspace-lock] acquired ${resolvedRoot} after waiting ` +
          `${Date.now() - startedAt}ms`,
        );
      }

      // Idempotent wrapper: the executors release in a `finally` that also
      // runs on paths where an earlier error may already have torn the lock
      // down; a double release (or a release racing staleness takeover) must
      // never mask the turn's real outcome.
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        try {
          await release();
        } catch (err) {
          console.warn(`[workspace-lock] release of ${resolvedRoot} failed (ignored): ${err}`);
        }
      };
    } catch (err) {
      if (!isLockHeldError(err)) throw err;
    }

    if (!waitingReported) {
      waitingReported = true;
      console.log(`[workspace-lock] ${resolvedRoot} is held by another turn; waiting`);
      try {
        await onWaiting?.();
      } catch (err) {
        console.warn(`[workspace-lock] onWaiting callback failed (non-fatal): ${err}`);
      }
    }

    const waitedMs = Date.now() - startedAt;
    if (waitedMs + pollIntervalMs > timeoutMs) {
      throw new WorkspaceLockTimeoutError(resolvedRoot, waitedMs);
    }

    heartbeat?.();
    await sleepAbortable(pollIntervalMs, signal);
  }
}

/** proper-lockfile signals "already held" with code ELOCKED. */
function isLockHeldError(err: unknown): boolean {
  return typeof err === "object" && err !== null &&
    (err as { code?: unknown }).code === "ELOCKED";
}

/** Sleep that wakes immediately when the signal aborts (wait stays responsive). */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
