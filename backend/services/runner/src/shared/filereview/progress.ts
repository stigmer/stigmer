/**
 * Mid-run live capture — the harness-agnostic glue that turns a per-turn
 * workspace delta into the transient `AgentExecutionStatus.file_change_progress`
 * snapshot the "N files changed so far" strip renders (DD-32 / DD-33).
 *
 * THE MODEL
 * ---------
 * This is category 2 of the two status patterns: a runner-owned, latest-snapshot
 * DISPLAY field, NOT the event-sourced file-review ledger. It is deliberately NOT
 * a `FileChangeSet` — progress is never in the ledger, carries NO file bytes or
 * digests, and is NEVER decidable. The turn-boundary CANDIDATE_CAPTURED (in
 * `file_change_sets`) remains the single authoritative, reviewable diff; a mid-run
 * snapshot is no more authoritative than a streamed tool-call arg.
 *
 * THE SUBSTRATE ABSTRACTION (DD-33)
 * ---------------------------------
 * Where the delta comes from differs by workspace: a git tree diffs cheaply with
 * `git --numstat` (the git substrate), a non-git / gitignored workspace reads the
 * CAS observer (the cas substrate, {@link ./cas-progress.js}), and a git tree
 * with gitignored writes composes both (the hybrid substrate). A
 * {@link ProgressSubstrate} hides that behind one `capture()` so the floor + attach
 * logic below is written once. Each substrate is a per-turn object owning its own
 * short-circuit cache; `capture()` always returns the FULL cumulative turn delta
 * plus a `changed` flag, so the hybrid can merge both slices even when only one
 * moved (a `ProgressDelta | undefined` would drop the unchanged slice).
 *
 * SECRET SAFETY
 * -------------
 * No file bodies are ever carried. A secret-like path ({@link isSecretLikePath})
 * is still surfaced (path visible) but with its line counts ZEROED — the same
 * "path visible, content withheld" rule the ledger uses (DD-12). The cas
 * substrate additionally excludes gate-blocked secrets up front
 * ({@link partitionIgnoredPathsBySecret}); this zeroing is the belt-and-suspenders
 * backstop. Nothing new can leak through this field.
 *
 * @since File-Change HITL Redesign (mid-run live capture / DD-32; non-git + hybrid / DD-33)
 */

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  FileChangeProgress,
  FileChangeProgressEntry,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileChangeProgressEntrySchema,
  FileChangeProgressSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { utcTimestamp } from "../status.js";
import { toFileChangeKind } from "./capture.js";
import {
  captureProgressDelta,
  type GitProgressEntry,
} from "./git-substrate.js";
import { isSecretLikePath } from "./secret-paths.js";

/**
 * One file's slim, content-free progress row — the substrate-neutral input to
 * {@link buildFileChangeProgress}. Carries the proto {@link FileChangeKind}
 * directly (git and cas substrates both normalize to it), so no side re-maps.
 * `linesAdded`/`linesRemoved` are 0 when uncountable (binary / oversized /
 * secret-withheld).
 */
export interface ProgressEntry {
  /** Path before the change (workspace-relative). Empty for ADD. */
  readonly pathBefore: string;
  /** Path after the change (workspace-relative). Empty for DELETE. */
  readonly pathAfter: string;
  readonly kind: FileChangeKind;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

/**
 * The substrate-neutral progress delta the git/cas/hybrid substrates emit.
 *
 * `totalFilesChanged` is the honest count of changed files this turn, which may
 * EXCEED `entries.length` when a substrate caps how many files it reads (the cas
 * substrate reads only a bounded prefix — DD-33). Undefined means "the entries
 * ARE every changed file" (the git substrate, whose numstat is free), so
 * {@link buildFileChangeProgress} falls back to `entries.length`.
 */
export interface ProgressDelta {
  readonly entries: readonly ProgressEntry[];
  readonly totalFilesChanged?: number;
}

/** One mid-run capture: the FULL cumulative turn delta + whether it changed. */
export interface ProgressCapture {
  readonly delta: ProgressDelta;
  /** False ⇒ nothing moved since the last capture; the caller skips re-attach. */
  readonly changed: boolean;
}

/**
 * A per-turn source of the mid-run delta. Implementations own their own
 * short-circuit cache and ALWAYS return the full cumulative delta (never a
 * bare "unchanged" sentinel), so {@link createHybridProgressSubstrate} can merge
 * a changed slice with an unchanged one without losing the latter.
 */
export interface ProgressSubstrate {
  capture(): Promise<ProgressCapture>;
}

/**
 * Cap the per-file entry list so a turn touching thousands of files does not
 * bloat the persisted status (which rides Temporal / the store). `files_changed`
 * and the aggregate counts stay honest over ALL files; the strip shows "… and K
 * more" when the list is capped. Also the cas substrate's read budget — it reads
 * after-bytes for at most this many files per capture (DD-33).
 */
export const PROGRESS_MAX_ENTRIES = 200;

/**
 * Minimum wall-clock gap between two mid-run captures, in ms. A floor on cost:
 * every capture stages the working tree (git) or reads the touched set (cas), so
 * we bound how often that runs regardless of persist frequency. Env-tunable for
 * large-repo deployments; defaults to 2s (feels live without hammering the disk).
 */
export const PROGRESS_CAPTURE_MIN_INTERVAL_MS = readMinIntervalMs();

function readMinIntervalMs(): number {
  const raw = process.env.STIGMER_PROGRESS_CAPTURE_MIN_INTERVAL_MS;
  if (!raw) return 2000;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 2000;
}

/**
 * Whether enough wall-clock has elapsed since the last capture to take another.
 * Pure and separated for direct testing (mirrors `persist-decision.ts`). A
 * `lastAtMs` of 0 (never captured) always passes.
 */
export function shouldCaptureProgress(
  lastAtMs: number,
  nowMs: number,
  minIntervalMs: number = PROGRESS_CAPTURE_MIN_INTERVAL_MS,
): boolean {
  return nowMs - lastAtMs >= minIntervalMs;
}

/**
 * Build the transient {@link FileChangeProgress} message from a substrate-neutral
 * delta. Zeroes counts for secret-like paths (path visible, magnitude withheld),
 * caps the entry list at {@link PROGRESS_MAX_ENTRIES}, and reports the honest
 * `files_changed` (`delta.totalFilesChanged` when a substrate capped its reads,
 * else the entry count). Aggregate counts sum over the emitted entries. Pure and
 * exported for direct testing.
 */
export function buildFileChangeProgress(
  delta: ProgressDelta,
  changeSetId: string,
): FileChangeProgress {
  let totalAdded = 0;
  let totalRemoved = 0;
  const entries: FileChangeProgressEntry[] = [];

  for (const entry of delta.entries) {
    // A secret-like path is surfaced (path visible) but its magnitude is withheld
    // — counts zeroed, mirroring the ledger's "path visible, content withheld".
    const secret = isSecretLikePath(entry.pathAfter || entry.pathBefore);
    const linesAdded = secret ? 0 : entry.linesAdded;
    const linesRemoved = secret ? 0 : entry.linesRemoved;
    totalAdded += linesAdded;
    totalRemoved += linesRemoved;

    if (entries.length < PROGRESS_MAX_ENTRIES) {
      entries.push(
        create(FileChangeProgressEntrySchema, {
          pathBefore: entry.pathBefore,
          pathAfter: entry.pathAfter,
          kind: entry.kind,
          linesAdded,
          linesRemoved,
        }),
      );
    }
  }

  return create(FileChangeProgressSchema, {
    changeSetId,
    filesChanged: delta.totalFilesChanged ?? delta.entries.length,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
    entries,
    capturedAt: utcTimestamp(),
  });
}

/**
 * Mutable per-turn state the caller threads across persists: the last capture
 * time (the floor). Substrate-specific short-circuit state (git tree sha, cas
 * signature) lives inside the {@link ProgressSubstrate}, not here. A fresh turn
 * starts a fresh state (`{ lastAtMs: 0 }`).
 */
export interface ProgressCaptureState {
  lastAtMs: number;
}

/** A fresh per-turn progress state. */
export function newProgressCaptureState(): ProgressCaptureState {
  return { lastAtMs: 0 };
}

/**
 * Capture-and-attach the live progress snapshot onto `status.file_change_progress`,
 * throttled by the floor. Mutates `status` and `state` in place; a no-op when the
 * floor has not elapsed or the substrate reports nothing changed. Content-free and
 * secret-safe (see {@link buildFileChangeProgress}). Called by both harnesses from
 * their per-persist loop, each passing a substrate built for its workspace shape.
 *
 * The field is set even when the delta is now EMPTY (the agent reverted its own
 * edits) so the strip reflects the reversion (it hides at zero) rather than
 * showing a stale count — the server's presence-guarded merge would keep the
 * stale value if the runner omitted the field.
 */
export async function captureFileChangeProgress(opts: {
  readonly status: AgentExecutionStatus;
  readonly changeSetId: string;
  readonly substrate: ProgressSubstrate;
  readonly state: ProgressCaptureState;
  /** Injectable clock for tests; defaults to `Date.now()`. */
  readonly nowMs?: number;
}): Promise<void> {
  const now = opts.nowMs ?? Date.now();
  if (!shouldCaptureProgress(opts.state.lastAtMs, now)) return;
  opts.state.lastAtMs = now;

  const { delta, changed } = await opts.substrate.capture();
  if (!changed) return;

  opts.status.fileChangeProgress = buildFileChangeProgress(delta, opts.changeSetId);
}

// ---------------------------------------------------------------------------
// Substrates
// ---------------------------------------------------------------------------

function gitEntryToProgressEntry(e: GitProgressEntry): ProgressEntry {
  return {
    pathBefore: e.pathBefore,
    pathAfter: e.pathAfter,
    kind: toFileChangeKind(e.changeType),
    linesAdded: e.linesAdded,
    linesRemoved: e.linesRemoved,
  };
}

/**
 * The git substrate: the working-tree `--numstat` delta against the pinned
 * baseline. `git add -A` honors `.gitignore`, so this covers exactly the
 * git-TRACKED changes (from any source — tool or shell), disjoint from the cas
 * substrate's gitignored set. Preserves the tree-sha short-circuit: on an
 * unchanged tree it returns the cached full delta with `changed:false` (the
 * caller skips the re-attach), byte-identical to the pre-DD-33 behavior.
 */
export function createGitProgressSubstrate(opts: {
  readonly workspaceRoot: string;
  readonly executionId: string;
  readonly baselineTree: string;
  readonly excludePaths?: readonly string[];
}): ProgressSubstrate {
  let lastTreeSha: string | undefined;
  let cachedFull: ProgressDelta = { entries: [] };
  return {
    async capture(): Promise<ProgressCapture> {
      const gitDelta = await captureProgressDelta(
        opts.workspaceRoot,
        opts.executionId,
        opts.baselineTree,
        opts.excludePaths,
        lastTreeSha,
      );
      if (gitDelta === undefined) {
        // Working tree unchanged since the last capture — reuse the cache so the
        // hybrid can still merge this (unchanged) slice with a changed cas slice.
        return { delta: cachedFull, changed: false };
      }
      lastTreeSha = gitDelta.afterTree;
      cachedFull = { entries: gitDelta.entries.map(gitEntryToProgressEntry) };
      return { delta: cachedFull, changed: true };
    },
  };
}

/**
 * The hybrid substrate: a git tree whose gitignored writes are captured via CAS.
 * Concatenates both slices (disjoint by the `.gitignore` boundary — numstat sees
 * only tracked paths, the observer only gitignored ones) and sums the honest
 * totals. `changed` is true when EITHER slice moved; because each child returns
 * its full cumulative delta, the merged delta always carries both slices.
 */
export function createHybridProgressSubstrate(
  git: ProgressSubstrate,
  cas: ProgressSubstrate,
): ProgressSubstrate {
  return {
    async capture(): Promise<ProgressCapture> {
      const [g, c] = await Promise.all([git.capture(), cas.capture()]);
      const delta: ProgressDelta = {
        entries: [...g.delta.entries, ...c.delta.entries],
        totalFilesChanged:
          (g.delta.totalFilesChanged ?? g.delta.entries.length) +
          (c.delta.totalFilesChanged ?? c.delta.entries.length),
      };
      return { delta, changed: g.changed || c.changed };
    },
  };
}
