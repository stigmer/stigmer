/**
 * Mid-run live capture — the harness-agnostic glue that turns a content-free git
 * delta ({@link ./git-substrate.js} `captureProgressDelta`) into the transient
 * `AgentExecutionStatus.file_change_progress` snapshot the "N files changed so
 * far" strip renders (DD-32).
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
 * Both harnesses drive this through {@link captureFileChangeProgress} from their
 * per-persist loop, each passing its OWN `excludePaths` (the runner-owned gate
 * files it writes into the workspace), so progress and the turn-boundary candidate
 * agree on what is "the agent's change". Capture is throttled by a floor +
 * tree-sha short-circuit so a quiet turn is nearly free.
 *
 * SECRET SAFETY
 * -------------
 * No file bodies are ever carried. A secret-like path ({@link isSecretLikePath})
 * is still surfaced (path visible) but with its line counts ZEROED — the same
 * "path visible, content withheld" rule the ledger uses (DD-12). Nothing new can
 * leak through this field.
 *
 * @since File-Change HITL Redesign (mid-run live capture / DD-32)
 */

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
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
import { captureProgressDelta, type ProgressDelta } from "./git-substrate.js";
import { isSecretLikePath } from "./secret-paths.js";

/**
 * Cap the per-file entry list so a turn touching thousands of files does not
 * bloat the persisted status (which rides Temporal / the store). `files_changed`
 * and the aggregate counts stay honest over ALL files; the strip shows "… and K
 * more" when the list is capped.
 */
export const PROGRESS_MAX_ENTRIES = 200;

/**
 * Minimum wall-clock gap between two mid-run captures, in ms. A floor on cost:
 * every capture stages the working tree (`write-tree`), so we bound how often
 * that runs regardless of persist frequency. Env-tunable for large-repo
 * deployments; defaults to 2s (feels live without hammering git).
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
 * Build the transient {@link FileChangeProgress} message from a content-free git
 * delta. Zeroes counts for secret-like paths (path visible, magnitude withheld),
 * caps the entry list at {@link PROGRESS_MAX_ENTRIES} while keeping
 * `files_changed`/aggregate counts honest over every file, and stamps
 * `captured_at`. Pure and exported for direct testing.
 */
export function buildFileChangeProgress(
  delta: ProgressDelta,
  changeSetId: string,
): FileChangeProgress {
  let filesChanged = 0;
  let totalAdded = 0;
  let totalRemoved = 0;
  const entries: FileChangeProgressEntry[] = [];

  for (const entry of delta.entries) {
    filesChanged += 1;
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
          kind: toFileChangeKind(entry.changeType),
          linesAdded,
          linesRemoved,
        }),
      );
    }
  }

  return create(FileChangeProgressSchema, {
    changeSetId,
    filesChanged,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
    entries,
    capturedAt: utcTimestamp(),
  });
}

/**
 * Mutable per-turn state the caller threads across persists: the last captured
 * tree sha (for the short-circuit) and the last capture time (for the floor).
 * A fresh turn starts a fresh state (`{ lastAtMs: 0 }`).
 */
export interface ProgressCaptureState {
  lastTreeSha?: string;
  lastAtMs: number;
}

/** A fresh per-turn progress state. */
export function newProgressCaptureState(): ProgressCaptureState {
  return { lastAtMs: 0 };
}

/**
 * Capture-and-attach the live progress snapshot onto `status.file_change_progress`,
 * throttled by the floor + tree-sha short-circuit. Mutates `status` and `state`
 * in place; a no-op when the floor has not elapsed or the working tree is
 * unchanged since the last capture. Content-free and secret-safe (see
 * {@link buildFileChangeProgress}). Called by both harnesses from their per-persist
 * loop; each passes its own `excludePaths`.
 *
 * The field is set even when the delta is now EMPTY (the agent reverted its own
 * edits) so the strip reflects the reversion (it hides at zero) rather than
 * showing a stale count — the server's presence-guarded merge would keep the
 * stale value if the runner omitted the field.
 */
export async function captureFileChangeProgress(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly excludePaths?: readonly string[];
  readonly state: ProgressCaptureState;
  /** Injectable clock for tests; defaults to `Date.now()`. */
  readonly nowMs?: number;
}): Promise<void> {
  const now = opts.nowMs ?? Date.now();
  if (!shouldCaptureProgress(opts.state.lastAtMs, now)) return;
  opts.state.lastAtMs = now;

  const delta = await captureProgressDelta(
    opts.gitRoot,
    opts.executionId,
    opts.baselineTree,
    opts.excludePaths,
    opts.state.lastTreeSha,
  );
  if (!delta) return; // working tree unchanged since the last capture

  opts.state.lastTreeSha = delta.afterTree;
  opts.status.fileChangeProgress = buildFileChangeProgress(delta, opts.changeSetId);
}
