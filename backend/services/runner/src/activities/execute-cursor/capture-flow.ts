/**
 * Cursor adapter over the harness-agnostic capture-mode orchestration
 * ({@link ../../shared/filereview/capture.js}).
 *
 * The substrate (git snapshot/restore) and the orchestration (baseline/candidate/
 * reconcile authoring) live in `shared/filereview/` so the Cursor and deep-agent
 * harnesses author IDENTICAL ledger entries. This adapter binds the Cursor
 * specifics:
 *  - `harnessId = "cursor"` (stamped on the BASELINE payload the projection reads);
 *  - the Cursor gate files written into the workspace, excluded from the captured
 *    diff (`CURSOR_RUNNER_OWNED_PATHS`);
 *  - hiding the streamed file-edit transcript rows that flowed this turn, so
 *    `file_change_sets` is the single review surface (`hideFlowedFileEditRows`).
 *
 * The three turn-boundary functions keep their original signatures so the
 * activity wiring (index.ts) and the cutover tests are unchanged.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileCaptureClass } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { approvalCategory } from "./approval-policy.js";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { readCasObservations } from "./cas-observations.js";
import { contentDigest } from "../../shared/file-tools.js";
import { hideToolCallRow, isToolCallRowHidden } from "../../shared/tool-row.js";
import {
  applyCaptureDecisions as sharedApplyCaptureDecisions,
  captureBaselineToLedger as sharedCaptureBaselineToLedger,
  captureCandidateToLedger as sharedCaptureCandidateToLedger,
  type CaptureResumeResult,
} from "../../shared/filereview/capture.js";
import { partitionIgnoredPathsBySecret } from "../../shared/filereview/secret-paths.js";
import { casBlobReader, type CasPathCapture } from "../../shared/filereview/cas-substrate.js";
import type { GitSubstrateChange as GitCapturedChange } from "../../shared/filereview/git-substrate.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";

export type { CaptureResumeResult };

/** The harness id the projection reads from the BASELINE payload (load-bearing). */
const HARNESS_ID = "cursor";

/**
 * Workspace-relative paths the Cursor gate writes into the repo. They are excluded
 * from capture so a turn's diff never shows the gate's own machinery. (The
 * workspace-scoped gate dir and SDK state live under `~/.stigmer` / the
 * git-excluded `.stigmer`, so they need no exclusion here.)
 */
const CURSOR_RUNNER_OWNED_PATHS: readonly string[] = [
  ".cursor/hooks.json",
  ".cursor/rules/stigmer-tool-approval.mdc",
];

/**
 * Turn start: pin the pre-turn working tree behind the baseline ref and author
 * BASELINE_CAPTURED (harnessId "cursor"). Returns the baseline tree sha for the
 * turn-end diff.
 */
export function captureBaselineToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
}): Promise<string> {
  return sharedCaptureBaselineToLedger({
    ...opts,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  });
}

/**
 * Turn end: capture the change set + author CANDIDATE_CAPTURED, then hide the
 * streamed file-edit rows that flowed this turn so `file_change_sets` is the
 * single review surface. The working tree is LEFT applied (Cursor parity).
 *
 * The change set is HYBRID: git-tracked edits (diffed here) composed with the
 * gitignored writes the hook staged into the cas-observations sidecar this turn
 * ({@link readCasObservations}) — the Cursor analog of deep-agent's
 * `buildCasTurnCaptures`. Non-secret staged paths become `GIT_IGNORED_CAPTURED`
 * CAS captures (before-bytes from the sidecar, after-bytes re-read from disk);
 * secret-blocked paths become content-less `DIFF_UNREVIEWABLE` entries. The
 * boundary re-runs {@link partitionIgnoredPathsBySecret} as a fail-closed
 * backstop, so a secret that ever slipped into the captured set still has its
 * bytes withheld from durable storage.
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * gitignored delete). A streamed file-edit row whose identity is in that set is
 * left for the deny-gate reconcile path — it did NOT flow. A flowed gitignored
 * write is NOT in that set (the hook allowed it), so it is hidden like any other
 * flowed edit and surfaced as its CAS card.
 *
 * `hitlDir`/`storage` are omitted only by callers with no artifact storage
 * (captureIgnored off); the CAS half is then skipped and this is a git-only
 * capture exactly as before.
 *
 * Mutates `messages` and `status` in place. Returns the captured git changes.
 */
export async function captureTurnToLedger(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly messages: AgentMessage[];
  readonly deniedTokens: ReadonlySet<string>;
  readonly hitlDir?: string;
  readonly storage?: ArtifactStorage;
}): Promise<readonly GitCapturedChange[]> {
  const { status, gitRoot, executionId, changeSetId, baselineTree, messages, deniedTokens, hitlDir, storage } = opts;

  const { casCaptures, unreviewablePaths } = await buildCasTurnCaptures(gitRoot, hitlDir, storage);

  const changes = await sharedCaptureCandidateToLedger({
    status,
    gitRoot,
    executionId,
    changeSetId,
    baselineTree,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
    casCaptures,
    storage,
    unreviewablePaths,
  });

  // Single review surface: the per-file edits now live on the file_review ledger
  // (projected to file_change_sets), so hide the streamed file-edit rows that
  // flowed this turn. Denied (gitignored-delete/shell) rows stay on the deny-gate
  // path. Runs regardless of the change count (a denied-only turn still hides
  // nothing and is a no-op).
  hideFlowedFileEditRows(messages, deniedTokens);

  return changes;
}

/**
 * Compose this turn's gitignored CAS captures from the sidecar the hook staged,
 * mirroring deep-agent's `buildCasTurnCaptures`: for each non-secret observed
 * path, the before-bytes come from the sidecar and the after-bytes are re-read
 * from disk now (`null` = the file was removed after the write). Secret-blocked
 * paths are returned as `unreviewablePaths`. The secret partition is re-run as a
 * fail-closed backstop over the observed set.
 *
 * Returns empty when the harness has no storage (captureIgnored off) or the
 * sidecar is empty — a git-only turn, leaving the shared capture unchanged.
 */
async function buildCasTurnCaptures(
  gitRoot: string,
  hitlDir: string | undefined,
  storage: ArtifactStorage | undefined,
): Promise<{ casCaptures: CasPathCapture[]; unreviewablePaths: string[] }> {
  if (!hitlDir || !storage) return { casCaptures: [], unreviewablePaths: [] };

  const { captured, secretPaths } = await readCasObservations(hitlDir);
  const beforeByPath = new Map(captured.map((c) => [c.path, c.before] as const));
  const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
    beforeByPath.keys(),
    new Set(secretPaths),
  );

  const casCaptures: CasPathCapture[] = [];
  for (const relPath of capturablePaths) {
    const after = await readFileOrNull(join(gitRoot, relPath));
    casCaptures.push({
      path: relPath,
      before: beforeByPath.get(relPath) ?? null,
      after,
      captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
    });
  }
  return { casCaptures, unreviewablePaths: [...unreviewablePaths] };
}

/** Raw bytes of a file, or `null` when it does not exist (an ADD-then-removed). */
async function readFileOrNull(absolutePath: string): Promise<Uint8Array | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Resume: reconcile the working tree to the change set's DECIDED decisions
 * (keep approved "after" bytes, snap rejected/undecided back to baseline,
 * hash-verified), author RECONCILED / FAILED, and release the refs. Delegates to
 * the shared orchestration with the Cursor harness id + exclude paths.
 *
 * `storage` threads the CAS blob store + reader so gitignored (CAS) files in the
 * change set reconcile from the durable manifest — approved after-blobs written
 * (hash-verified), rejected files snapped back to their before-blobs. Omit for a
 * git-only harness/turn; the shared CAS branch is then skipped. The read path is
 * the same one `exact-apply` already uses (`ArtifactStorage.download`).
 */
export function applyCaptureDecisions(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSet: FileChangeSet;
  readonly storage?: ArtifactStorage;
}): Promise<CaptureResumeResult> {
  const { storage, ...rest } = opts;
  return sharedApplyCaptureDecisions({
    ...rest,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
    storage,
    readBlob: storage ? casBlobReader(storage) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Cursor-specific presentation
// ---------------------------------------------------------------------------

/**
 * Hide every streamed file-edit row (category write/delete) that flowed this
 * turn, so the file_change_sets projection is the single review surface. Skips:
 *  - already-hidden rows (idempotent across re-persists / activity retries);
 *  - denied identities (the deny-gate reconcile path owns those rows).
 */
function hideFlowedFileEditRows(
  messages: AgentMessage[],
  deniedTokens: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (isToolCallRowHidden(tc)) continue;
      const category = approvalCategory(tc.name);
      if (category !== "write" && category !== "delete") continue;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, args);
      const token = primaryToken(id.key, id.salient, contentDigest(args));
      if (deniedTokens.has(token)) continue; // denied -> reconcile path owns it
      hideToolCallRow(tc);
    }
  }
}
