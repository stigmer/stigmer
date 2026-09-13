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
 * The resume-time reconcile is NOT here since S2 M2: the turn runtime's
 * `reconcileReinvocation` (`harness/turn-context.ts`) calls the shared
 * reconcile directly under {@link CURSOR_FILE_REVIEW_IDENTITY}, the one
 * export that carries the two Cursor facts it needs. The two capture
 * functions keep their original signatures so the activity wiring (index.ts)
 * and the cutover tests are unchanged.
 */

import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChangeSet, TurnCommandProvenance } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileCaptureClass } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toolIdentity, primaryToken } from "./approval-state.js";
import { readCasObservations } from "./cas-observations.js";
import { contentDigest } from "../../shared/file-tools.js";
import { stampFlowedFileEditRows } from "../../shared/tool-row.js";
import {
  captureBaselineToLedger as sharedCaptureBaselineToLedger,
  captureCandidateToLedger as sharedCaptureCandidateToLedger,
} from "../../shared/filereview/capture.js";
import {
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  type ProgressSubstrate,
} from "../../shared/filereview/progress.js";
import { createCasProgressSubstrate } from "../../shared/filereview/cas-progress.js";
import {
  buildCasTurnCaptures,
  type CasTouchedReader,
  type CasTouchedSnapshot,
} from "../../shared/filereview/cas-touched.js";
import { hasCandidateCaptured } from "../../shared/filereview/events.js";
import type { GitSubstrateChange as GitCapturedChange } from "../../shared/filereview/git-substrate.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import type { FileReviewIdentity } from "../../harness/capabilities.js";

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
 * The two facts the runtime's resume-time reconcile needs from this harness
 * (`harness/turn-context.ts` `reconcileReinvocation`): the same id and
 * exclude list the capture functions below stamp and apply, so the baseline a
 * turn authors and the reconcile a resume runs agree by construction.
 */
export const CURSOR_FILE_REVIEW_IDENTITY: FileReviewIdentity = {
  harnessId: HARNESS_ID,
  excludePaths: CURSOR_RUNNER_OWNED_PATHS,
};

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
 * boundary re-runs the secret partition (`shared/filereview/cas-touched.ts`) as a fail-closed
 * backstop, so a secret that ever slipped into the captured set still has its
 * bytes withheld from durable storage.
 *
 * `deniedTokens` are the identities the hook gated this turn (shell/MCP, or a
 * secret-like delete — non-secret CAS deletes flow since issue #303). A streamed
 * file-edit row whose identity is in that set is left for the deny-gate
 * reconcile path — it did NOT flow. A flowed gitignored write or delete is NOT
 * in that set (the hook allowed it), so it is stamped like any other flowed
 * edit and its captured delta surfaces as a CAS entry in the set.
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
  // The CAS half needs the sidecar AND storage (captureIgnored on); without
  // either this is a git-only capture exactly as before.
  const { casCaptures, unreviewablePaths } =
    hitlDir && storage
      ? await buildCasTurnCaptures(await readSidecarSnapshot(hitlDir), gitRoot, casCaptureClass)
      : { casCaptures: [], unreviewablePaths: [] };

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
    // A denied identity did NOT flow — the deny-gate reconcile owns that row.
    const flowed = (tc: ToolCall): boolean => !deniedTokens.has(identityTokenOf(tc));
    stampFlowedFileEditRows(messages, changeSetId, { flowed });
    // Sub-agent edit rows fold their files into the SAME parent turn set, so they
    // carry the same change set id. Walked separately (they live under
    // subAgentExecutions, not the top-level transcript) and scoped to this turn
    // via the pre-turn snapshot of seeded sub-agent tool-call ids.
    for (const sa of status.subAgentExecutions) {
      stampFlowedFileEditRows(sa.messages, changeSetId, { skipToolCallIds: priorSubAgentToolCallIds, flowed });
    }
  }

  return changes;
}

/**
 * Choose the mid-run progress substrate for this turn's workspace shape (DD-32 /
 * DD-33), returning `undefined` when there is nothing to observe (not capture
 * mode, or no workspace). Built ONCE per turn — the substrate owns its own
 * short-circuit cache across the loop's persists; the floor lives in the caller's
 * `ProgressCaptureState`. The live count and the turn-boundary reviewed set agree
 * by construction: the git slice binds the SAME `CURSOR_RUNNER_OWNED_PATHS`
 * exclusion {@link captureTurnToLedger} uses, and the CAS slice reads the SAME
 * hook sidecar ({@link readCasObservations}) the boundary reads.
 *
 *  - git tree, no storage      -> git substrate only (tracked-file `--numstat`);
 *  - git tree, storage (HYBRID) -> git + CAS (the gitignored writes the hook staged);
 *  - non-git workspace          -> CAS only (every tool-mediated write is CAS-staged).
 *
 * The CAS slice needs the hook sidecar, which exists only when `captureIgnored`
 * is on (storage configured). A non-git capture already required storage
 * (`deriveCaptureMode`), so its sidecar is always present; a git tree with no
 * storage simply gets the git-only substrate (parity with the pre-DD-33 behavior).
 */
export function buildCursorProgressSubstrate(opts: {
  readonly captureMode: boolean;
  readonly gitWorkspace: boolean;
  readonly workspaceRoot: string | undefined;
  readonly baselineTree: string | undefined;
  readonly executionId: string;
  readonly hitlDir: string | undefined;
  readonly storage: ArtifactStorage | undefined;
}): ProgressSubstrate | undefined {
  const { captureMode, gitWorkspace, workspaceRoot, baselineTree, executionId, hitlDir, storage } = opts;
  if (!captureMode || !workspaceRoot) return undefined;

  const casReader: CasTouchedReader | undefined =
    hitlDir && storage ? createSidecarTouchedReader(hitlDir) : undefined;

  if (gitWorkspace) {
    if (!baselineTree) return undefined;
    const git = createGitProgressSubstrate({
      workspaceRoot,
      executionId,
      baselineTree,
      excludePaths: CURSOR_RUNNER_OWNED_PATHS,
    });
    return casReader
      ? createHybridProgressSubstrate(git, createCasProgressSubstrate({ workspaceRoot, read: casReader }))
      : git;
  }

  // Non-git: every tool-mediated write is CAS-staged; there is no git slice.
  return casReader ? createCasProgressSubstrate({ workspaceRoot, read: casReader }) : undefined;
}

/**
 * A {@link CasTouchedReader} over the Cursor hook's on-disk sidecar. Each capture
 * reads the current observations ({@link readCasObservations}) and maps them to
 * the substrate's snapshot shape. Reads are bounded by the caller's capture floor
 * (default 2s), and the sidecar is small (one small marker + before-blob per
 * touched gitignored path), so re-reading per capture is cheap and always
 * reflects sub-agent writes staged since the last one.
 */
function createSidecarTouchedReader(hitlDir: string): CasTouchedReader {
  return () => readSidecarSnapshot(hitlDir);
}

/** One atomic read of the sidecar as the shared {@link CasTouchedSnapshot}. */
async function readSidecarSnapshot(hitlDir: string): Promise<CasTouchedSnapshot> {
  const { captured, secretPaths } = await readCasObservations(hitlDir);
  const before = new Map<string, Uint8Array | null>();
  for (const c of captured) before.set(c.path, c.before);
  return { before, blockedSecretPaths: new Set(secretPaths) };
}

// ---------------------------------------------------------------------------
// Cursor-specific presentation
// ---------------------------------------------------------------------------

/**
 * The deny-gate identity token of a streamed row, the key the denial ledger is
 * written under: a row whose token the hook denied did not flow, so the shared
 * stamping pass (`shared/tool-row.ts` `stampFlowedFileEditRows`) leaves it to
 * the deny-gate reconcile.
 */
function identityTokenOf(tc: ToolCall): string {
  const args = (tc.args ?? {}) as Record<string, unknown>;
  const id = toolIdentity(tc.name, tc.mcpServerSlug, args);
  return primaryToken(id.key, id.salient, contentDigest(args));
}
