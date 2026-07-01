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
import { resolveWorkspacePath } from "../../shared/file-change.js";

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
