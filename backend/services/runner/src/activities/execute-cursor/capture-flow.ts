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
 *  - stamping the streamed file-edit transcript rows that flowed this turn with
 *    the change set id (`stampFlowedFileEditRows`) — the rows stay visible as
 *    observational/audit records at their transcript positions, while
 *    `file_change_sets` remains the single DECISION surface.
 *
 * The three turn-boundary functions keep their original signatures so the
 * activity wiring (index.ts) and the cutover tests are unchanged.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChangeSet, TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileCaptureClass } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { approvalCategory } from "./approval-policy.js";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { readCasObservations } from "./cas-observations.js";
import { contentDigest } from "../../shared/file-tools.js";
import { isToolCallRowHidden, stampFileEditRow } from "../../shared/tool-row.js";
import {
  applyCaptureDecisions as sharedApplyCaptureDecisions,
  captureBaselineToLedger as sharedCaptureBaselineToLedger,
  captureCandidateToLedger as sharedCaptureCandidateToLedger,
  type CaptureResumeResult,
} from "../../shared/filereview/capture.js";
import {
  captureFileChangeProgress,
  type ProgressCaptureState,
} from "../../shared/filereview/progress.js";
import { hasCandidateCaptured } from "../../shared/filereview/events.js";
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

// `deriveCaptureMode` is the single capture-vs-deny-gate decision, now shared by
// BOTH harnesses from `shared/filereview/capture.ts`. Re-exported here so existing
// Cursor imports (index.ts, the deny-gate-exact-apply seam test) keep resolving
// from this adapter.
export { deriveCaptureMode } from "../../shared/filereview/capture.js";

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
  /** True (default) for a git work tree; false for a CAS-only non-git workspace. */
  readonly gitWorkspace?: boolean;
}): Promise<string> {
  return sharedCaptureBaselineToLedger({
    ...opts,
    harnessId: HARNESS_ID,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
  });
}

/**
 * Turn end: capture the change set + author CANDIDATE_CAPTURED, then stamp the
 * streamed file-edit rows that flowed this turn with the change set id — the
 * rows stay visible in place as observational records while `file_change_sets`
 * remains the single decision surface. The working tree is LEFT applied
 * (Cursor parity).
 *
 * The change set is HYBRID (git tree) or CAS-only (non-git): the hook-staged
 * writes from the cas-observations sidecar this turn ({@link readCasObservations})
 * — the Cursor analog of deep-agent's `buildCasTurnCaptures` — composed with the
 * git-tracked diff when `gitWorkspace`. Non-secret staged paths become
 * `GIT_IGNORED_CAPTURED` (git tree) or `NON_GIT_CAS` (non-git) CAS captures
 * (before-bytes from the sidecar, after-bytes re-read from disk);
 * secret-blocked paths become content-less `DIFF_UNREVIEWABLE` entries. The
 * boundary re-runs {@link partitionIgnoredPathsBySecret} as a fail-closed
 * backstop, so a secret that ever slipped into the captured set still has its
 * bytes withheld from durable storage.
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * gitignored delete). A streamed file-edit row whose identity is in that set is
 * left for the deny-gate reconcile path — it did NOT flow. A flowed gitignored
 * write is NOT in that set (the hook allowed it), so it is stamped like any
 * other flowed edit and its captured delta surfaces as a CAS entry in the set.
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
  /**
   * Sub-agent tool-call ids that existed BEFORE this turn's stream (the seeded
   * prior sub-agents). Sub-agent edit rows created this turn are stamped with the
   * parent change set id; rows in this set are skipped so a resume never
   * re-stamps a prior turn's sub-agent rows. Omit when there are no prior
   * sub-agents.
   */
  readonly priorSubAgentToolCallIds?: ReadonlySet<string>;
  /**
   * True (default) for a git work tree — the candidate is the git diff composed
   * with the gitignored CAS captures (`GIT_IGNORED_CAPTURED`). False for a non-git
   * workspace (Slice 2c): there is no git diff, so the whole change set is the CAS
   * captures the hook staged for EVERY touched path (`NON_GIT_CAS`).
   */
  readonly gitWorkspace?: boolean;
  /**
   * The approved-command turn facts (DD-28), derived by the caller from the
   * turn's tool calls ({@link ../command-provenance.js}). Present only when the
   * turn qualifies; carried verbatim to the CANDIDATE event.
   */
  readonly commandProvenance?: TurnCommandProvenance;
}): Promise<readonly GitCapturedChange[]> {
  const { status, gitRoot, executionId, changeSetId, baselineTree, messages, deniedTokens, hitlDir, storage, priorSubAgentToolCallIds, commandProvenance } = opts;
  const gitWorkspace = opts.gitWorkspace ?? true;

  // The CAS substrate class for this turn's staged writes: gitignored paths in a
  // git tree, all touched paths in a non-git workspace.
  const casCaptureClass = gitWorkspace
    ? FileCaptureClass.GIT_IGNORED_CAPTURED
    : FileCaptureClass.NON_GIT_CAS;
  const { casCaptures, unreviewablePaths } = await buildCasTurnCaptures(
    gitRoot,
    hitlDir,
    storage,
    casCaptureClass,
  );

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
    unreviewableCaptureClass: casCaptureClass,
    gitWorkspace,
    commandProvenance,
  });

  // Observational rows: the reviewable diff lives on the file_review ledger
  // (projected to file_change_sets); the streamed file-edit rows that flowed
  // this turn stay visible in place, stamped with the change set id so clients
  // badge them and anchor the decision surface. Denied (gitignored-delete/
  // shell) rows stay on the deny-gate path. Gated on an authored CANDIDATE —
  // a no-op turn (every edit reverted before the boundary) authors no event,
  // and a row must never reference a change set that does not exist.
  if (hasCandidateCaptured(status, changeSetId)) {
    stampFlowedFileEditRows(messages, deniedTokens, changeSetId);
    // Sub-agent edit rows fold their files into the SAME parent turn set, so they
    // carry the same change set id. Walked separately (they live under
    // subAgentExecutions, not the top-level transcript) and scoped to this turn
    // via the pre-turn snapshot of seeded sub-agent tool-call ids.
    for (const sa of status.subAgentExecutions) {
      stampFlowedFileEditRows(sa.messages, deniedTokens, changeSetId, priorSubAgentToolCallIds);
    }
  }

  return changes;
}

/**
 * Mid-run: attach the live "N files changed so far" snapshot onto
 * `status.file_change_progress` (DD-32), throttled by the floor + tree-sha
 * short-circuit inside {@link captureFileChangeProgress}. The Cursor adapter binds
 * `CURSOR_RUNNER_OWNED_PATHS` so the progress diff excludes the gate's own files —
 * the SAME exclusion {@link captureTurnToLedger} uses for the turn-boundary
 * candidate, so the live count and the reviewed set agree. Content-free and
 * secret-safe; a no-op when nothing changed since the last capture.
 */
export async function captureProgressToStatus(opts: {
  readonly status: AgentExecutionStatus;
  readonly gitRoot: string;
  readonly executionId: string;
  readonly changeSetId: string;
  readonly baselineTree: string;
  readonly state: ProgressCaptureState;
}): Promise<void> {
  await captureFileChangeProgress({
    status: opts.status,
    gitRoot: opts.gitRoot,
    executionId: opts.executionId,
    changeSetId: opts.changeSetId,
    baselineTree: opts.baselineTree,
    excludePaths: CURSOR_RUNNER_OWNED_PATHS,
    state: opts.state,
  });
}

/**
 * Compose this turn's CAS captures from the sidecar the hook staged, mirroring
 * deep-agent's `buildCasTurnCaptures`: for each non-secret observed path, the
 * before-bytes come from the sidecar and the after-bytes are re-read from disk now
 * (`null` = the file was removed after the write). Secret-blocked paths are
 * returned as `unreviewablePaths`. The secret partition is re-run as a
 * fail-closed backstop over the observed set. `captureClass` labels each captured
 * path's provenance (GIT_IGNORED_CAPTURED for a git tree's ignored paths,
 * NON_GIT_CAS for a non-git workspace).
 *
 * Returns empty when the harness has no storage (captureIgnored off) or the
 * sidecar is empty — leaving the shared capture unchanged.
 */
async function buildCasTurnCaptures(
  gitRoot: string,
  hitlDir: string | undefined,
  storage: ArtifactStorage | undefined,
  captureClass: FileCaptureClass,
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
      captureClass,
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
  /**
   * True (default) for a git work tree; false for a CAS-only non-git workspace
   * (Slice 2c). When false the reconcile never consults git refs — it is driven
   * entirely by the durable CAS manifest.
   */
  readonly gitWorkspace?: boolean;
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
 * Stamp every streamed file-edit row (category write/delete) that flowed this
 * turn with the change set id, so the row stays visible as an observational
 * record and clients can badge it / anchor the decision surface. Skips:
 *  - already-stamped rows — the stamp is the idempotency AND cross-turn guard:
 *    a resume seeds prior turns' rows into this transcript, and re-stamping
 *    them with this turn's id would mis-attribute them ({@link stampFileEditRow});
 *  - legacy hidden rows (sessions persisted before stamping existed) — they
 *    belong to an earlier turn's change set, not this one;
 *  - denied identities (the deny-gate reconcile path owns those rows);
 *  - tool-call ids in `skipToolCallIds` — used for sub-agent rows, which lack
 *    the already-stamped/hidden shields the top-level transcript has, to scope
 *    the stamp to rows created this turn (the seeded prior sub-agents' ids).
 */
function stampFlowedFileEditRows(
  messages: readonly AgentMessage[],
  deniedTokens: ReadonlySet<string>,
  changeSetId: string,
  skipToolCallIds?: ReadonlySet<string>,
): void {
  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.fileChangeSetId) continue;
      if (skipToolCallIds?.has(tc.id)) continue;
      if (isToolCallRowHidden(tc)) continue;
      const category = approvalCategory(tc.name);
      if (category !== "write" && category !== "delete") continue;
      const args = (tc.args ?? {}) as Record<string, unknown>;
      const id = toolIdentity(tc.name, tc.mcpServerSlug, args);
      const token = primaryToken(id.key, id.salient, contentDigest(args));
      if (deniedTokens.has(token)) continue; // denied -> reconcile path owns it
      stampFileEditRow(tc, changeSetId);
    }
  }
}
