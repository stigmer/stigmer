/**
 * The single owner of one turn's CAS (content-addressed) capture state for the
 * deep-agent activity — the `.gitignored` half of apply-then-review (design docs
 * 08/11/12).
 *
 * WHY ONE SHARED OBSERVER (NOT PER-BACKEND STATE)
 * -----------------------------------------------
 * Capture is a property of the TURN, not of any single graph. The parent graph
 * AND every sub-agent graph run against the same workspace root within one turn,
 * and up to {@link SubAgentGate} sub-agents run CONCURRENTLY. If each filesystem
 * backend held its own before-map + reservation, two graphs touching the same
 * gitignored path could each read a "before" — the later one reading mid-turn
 * (post-write) bytes as the baseline, corrupting the reviewed diff and breaking
 * the "reviewed == applied" invariant.
 *
 * Making ONE observer own the before-map AND the reservation set fixes this by
 * construction: `reserving.add` is synchronous (executes before the first
 * `await` in {@link recordBefore}), so first-touch-wins holds across every
 * backend instance that delegates here — the parent and all sub-agents.
 *
 * WHAT IT OWNS
 * ------------
 *  - `before`: the pre-turn bytes of each first-touched gitignored path
 *    (`null` = the path did not exist → an ADD), read at the turn boundary to
 *    build the CAS `before` side.
 *  - `blockedSecretPaths`: gitignored paths the approval gate hard-blocked as
 *    secret-like (DD-E) — never applied, never captured; the boundary authors a
 *    content-less `DIFF_UNREVIEWABLE` entry for each (path only — the name is not
 *    the secret; the CONTENT never leaves the workspace).
 *
 * The AFTER bytes are re-read from disk at the turn boundary (the authoritative
 * net result of the turn), so multiple edits to one path collapse to one
 * before/after. Git-tracked paths are never recorded here — the turn-boundary git
 * diff captures them — so memory is bounded to the gitignored scope.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS deep-agent wiring); sub-agent
 * gitignored capture parity (Session 26, DD-19)
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileCaptureClass } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { resolveWorkspacePath } from "../../shared/file-change.js";
import type { CasPathCapture } from "../../shared/filereview/cas-substrate.js";
import { partitionIgnoredPathsBySecret } from "../../shared/filereview/secret-paths.js";

/**
 * Pre-turn bytes of each first-touched gitignored path, keyed by workspace-root-
 * relative path. `null` means the path did not exist before the turn (an ADD).
 */
export type CasBeforeMap = Map<string, Uint8Array | null>;

export class CasCaptureObserver {
  private readonly rootDir: string;
  /** Raw (uncached) gitignore predicate; results are memoized in {@link ignoredCache}. */
  private readonly isIgnoredRaw: (relPath: string) => Promise<boolean>;

  /** Pre-turn bytes of first-touched gitignored paths (see {@link CasBeforeMap}). */
  readonly before: CasBeforeMap = new Map();

  /** Paths whose before-read is in flight — the synchronous first-touch lock. */
  private readonly reserving = new Set<string>();
  /** Memoized `git check-ignore` results (one classification per distinct path). */
  private readonly ignoredCache = new Map<string, boolean>();
  /** Gitignored paths hard-blocked as secret-like (never applied, never captured). */
  private readonly blocked = new Set<string>();

  constructor(deps: {
    readonly rootDir: string;
    /** True when the workspace-relative path is gitignored (CAS-owned). Uncached. */
    readonly isIgnored: (relPath: string) => Promise<boolean>;
  }) {
    this.rootDir = deps.rootDir;
    this.isIgnoredRaw = deps.isIgnored;
  }

  /** Gitignored paths the gate refused as secret-like, read at the turn boundary. */
  get blockedSecretPaths(): ReadonlySet<string> {
    return this.blocked;
  }

  /**
   * Record the pre-turn bytes of `rawPath` when it is a first-touched gitignored
   * path. First-touch-wins across ALL backends sharing this observer: the slot is
   * reserved SYNCHRONOUSLY (before the first `await`), so two concurrent
   * mutations of the same path — even from different graphs — cannot both read a
   * post-write "before". Non-gitignored paths (git-tracked) are ignored here; the
   * turn-boundary git diff captures them.
   */
  async recordBefore(rawPath: string): Promise<void> {
    const { path: relPath, absolutePath } = resolveWorkspacePath(rawPath, this.rootDir, true);
    if (this.before.has(relPath) || this.reserving.has(relPath)) return;
    this.reserving.add(relPath);
    try {
      if (!(await this.isPathIgnored(relPath))) return;
      // Re-check after the await: a concurrent call may have won the slot.
      if (this.before.has(relPath)) return;
      this.before.set(relPath, await readBytesOrNull(absolutePath));
    } finally {
      this.reserving.delete(relPath);
    }
  }

  /**
   * Record a gitignored path the approval gate hard-blocked as secret-like. The
   * raw path is resolved to the same workspace-relative key the CAS reconcile
   * uses, so the boundary can author its `DIFF_UNREVIEWABLE` entry. Idempotent.
   */
  recordBlockedSecret(rawPath: string): void {
    this.blocked.add(resolveWorkspacePath(rawPath, this.rootDir, true).path);
  }

  private async isPathIgnored(relPath: string): Promise<boolean> {
    const cached = this.ignoredCache.get(relPath);
    if (cached !== undefined) return cached;
    const ignored = await this.isIgnoredRaw(relPath);
    this.ignoredCache.set(relPath, ignored);
    return ignored;
  }
}

/** Raw bytes of a file, or `null` when it does not exist (an ADD). */
async function readBytesOrNull(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Assemble the turn's CAS captures and secret-blocked paths from the shared
 * observer (the pre-turn bytes recorded by the parent AND every sub-agent CAS
 * backend, plus the gate's secret-blocked set) — what the turn boundary reads
 * to compose the change set.
 *
 * For each observed CAS-owned path the after-bytes are re-read from disk (the
 * authoritative net result of the turn; `null` when the file is gone). A path
 * that is secret-like is diverted to `unreviewablePaths` and its before-bytes are
 * dropped — the fail-closed backstop that holds even under the global bypass,
 * where the gate did not run to block it up front. The result composes into the
 * change set in `captureCandidateToLedger`.
 *
 * `captureClass` is the turn's CAS substrate class — GIT_IGNORED_CAPTURED for a
 * git work tree's ignored paths, NON_GIT_CAS for a non-git workspace (where these
 * ARE the whole change set) — so each captured path carries its true provenance.
 *
 * Lives beside the observer it reads (moved from the orchestrator at S3 M2a).
 */
export async function buildCasTurnCaptures(
  observer: CasCaptureObserver,
  workspaceRoot: string,
  captureClass: FileCaptureClass,
): Promise<{ casCaptures: CasPathCapture[]; unreviewablePaths: string[] }> {
  // The secret partition (pure, corpus-lockable) decides what may be captured;
  // this shell only performs the IO for the capturable set. The backstop that
  // withholds a secret observed under the global bypass lives in the partition.
  const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
    observer.before.keys(),
    observer.blockedSecretPaths,
  );
  const casCaptures: CasPathCapture[] = [];
  for (const relPath of capturablePaths) {
    const after = await readFileOrNull(join(workspaceRoot, relPath));
    casCaptures.push({
      path: relPath,
      before: observer.before.get(relPath) ?? null,
      after,
      captureClass,
    });
  }
  return { casCaptures, unreviewablePaths: [...unreviewablePaths] };
}

/** Raw bytes of a file, or `null` when it does not exist (a DELETE). */
async function readFileOrNull(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}
