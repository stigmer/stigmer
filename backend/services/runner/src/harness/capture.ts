/**
 * The runtime's file-review capture — apply-then-review for every harness,
 * written once: the baseline pinned before the engine runs, the mid-run
 * progress the chokepoint refreshes on every write, the candidate captured
 * after the engine's turn, the approved-command provenance, and the flowed
 * transcript rows stamped with the change set.
 *
 * Capture runs only when the turn's review is on (the session's
 * `file_review`, or a eval-run try) and the workspace has a substrate
 * (`TurnWorkspace.captureMode`). It never holds the turn: the edits are
 * applied, the turn takes its own terminal (`run-turn.ts`), and the change
 * set is offered for Keep or Undo after it, on the run's file record
 * (`RunStatus.file_changes`, read from the turn's ledger at every persist)
 * and as the session's `stigmer.file_review.changes` (`events/emitter.ts`).
 *
 * ONE CAPTURE, ONE MOMENT, ONE OWNER
 * ----------------------------------
 * A turn's reviewable change is a property of the TREE, not of the engine:
 * whatever sits on the working tree when the engine's turn is over is what
 * the user reviews, whoever wrote it — the engine, a sub-agent, a recovery
 * retry, a stdio MCP server the engine spawned. So the runtime pins the
 * baseline as its LAST act before `adapter.runTurn` (after its own writes
 * into the tree — the owed undos, the skill and File mounts — so they
 * cancel out of the diff) and captures ONCE after `runTurn` returns, over
 * the whole turn. Anything written into the tree after the pin is the
 * turn's change. An adapter needs neither the baseline nor the change-set
 * id and never learns whether a change was captured; the one fact it holds
 * that the runtime cannot read is what its engine observed touching
 * CAS-owned paths (`TurnSink.bindCasObservations`).
 *
 * Until #1096 each adapter carried this whole act, with its own evidence
 * source and its own scoping rules for the provenance and the stamp. The
 * two rules here are the one reading every engine produces:
 *
 *  - PROVENANCE (`shared/filereview/command-provenance.ts` is the
 *    rule; this is its two inputs). "This turn's commands" are the top-level
 *    rows whose id had not SETTLED before the engine ran — never a message
 *    position, because an approved command executes on the row the runtime
 *    seeded for it (each engine's translator reconciles the re-attempt onto
 *    the seeded WAITING row), at its prior position; a positional scope
 *    misses it, so an auto-keep would never qualify a gated-then-approved
 *    command.
 *    "Executed" is a COMPLETED row. "Consented" is the row's own
 *    `approval_action`, the person's answer the seed copied from the
 *    session's log (`approval-answers.ts`) — the seeded row keeps its id and
 *    its verdict when it executes on resume, so the executed command IS its
 *    consent row. Any sub-agent activity fails closed.
 *  - THE STAMP (`shared/tool-row.ts` `stampFlowedFileEditRows`). A write or
 *    delete row created this turn that reached COMPLETED flowed onto the
 *    tree and is badged with the change set; a WAITING (denied, gated) or
 *    FAILED row did not and is not. The row's own status is the evidence,
 *    not a ledger of denial tokens.
 *
 * WHAT IS NOT HERE
 * ----------------
 * The substrate and the ledger authoring (`shared/filereview/capture.ts`,
 * `cas-touched.ts`, `progress.ts`); the undo after the turn, done at every
 * turn's start (`owed-undos.ts`); the log's `changes` event
 * (`events/emitter.ts`).
 *
 * A TURN OF MANY INVOCATIONS IS ONE CHANGE SET (#1115)
 * ------------------------------------------------------
 * A turn stopped by an arm that returns (a stall the engine owed, the
 * operation limit, a mock's abort, the cost cap, a platform STOP) is
 * captured once its arm is known (`run-turn.ts` `settleInterrupted`):
 * nothing runs it on, and its edits are reviewable like any turn's. A turn
 * the workflow runs on (a drain, a lost runner, a stall the model owed, a
 * pause) is not captured where it stopped: the invocation that continues it
 * adopts the run's open set (`shared/filereview/record.ts`
 * `changeSetIdForInvocation`), keeps its baseline instead of pinning a
 * second one, and captures the whole turn at its own boundary.
 */

import { FileCaptureClass } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { TurnCommandProvenance } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";

import type { ArtifactStorage } from "../shared/artifact-storage.js";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { adoptBaselineToLedger, captureBaselineToLedger, captureCandidateToLedger } from "../shared/filereview/capture.js";
import { adoptedChangeSetOf } from "../shared/filereview/record.js";
import { createCasProgressSubstrate } from "../shared/filereview/cas-progress.js";
import { buildCasTurnCaptures, type CasTouchedReader, type CasTouchedSnapshot } from "../shared/filereview/cas-touched.js";
import { qualifyTurnCommandProvenance } from "../shared/filereview/command-provenance.js";
import { hasCandidateCaptured } from "../shared/filereview/events.js";
import {
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  newProgressCaptureState,
  type ProgressCaptureState,
  type ProgressSubstrate,
} from "../shared/filereview/progress.js";
import { collectSettledToolCallIds, collectSubAgentToolCallIds, stampFlowedFileEditRows, stampFlowedSubAgentFileEditRows } from "../shared/tool-row.js";
import type { FileReviewIdentity } from "./capabilities.js";
import type { TurnWorkspace } from "./types.js";
import type { ToolCall, TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { ApprovalAction, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/** The mid-run progress the chokepoint refreshes on every write: the substrate and the floor it throttles by. */
export interface TurnProgress {
  readonly changeSetId: string;
  readonly substrate: ProgressSubstrate;
  readonly state: ProgressCaptureState;
}

/**
 * One turn's capture as the runtime holds it between the pin and the
 * boundary — a `runTurn` closure value beside the usage accumulator and the
 * watchdog, on neither `TurnInput` (the adapter needs none of it) nor the
 * frame (nothing here is a resource to release). Absent outside capture
 * mode.
 */
export interface TurnCapture {
  readonly changeSetId: string;
  /** The pre-turn tree on a git work tree; `""` on a non-git one (the CAS manifest is the baseline there). */
  readonly baselineTree: string;
  readonly progress: TurnProgress;
  /** Top-level rows already settled before the engine ran: the complement is "this turn's" (the provenance scope). */
  readonly priorSettledToolCallIds: ReadonlySet<string>;
  /** Sub-agent rows present before the engine ran: the stamp's scope, and any growth fails provenance closed. */
  readonly priorSubAgentToolCallIds: ReadonlySet<string>;
  /**
   * What the engine observed touching CAS-owned paths, once the adapter has
   * bound it (`TurnSink.bindCasObservations`); read at each progress capture
   * and at the boundary. Unbound reads as nothing observed: git-only capture.
   */
  casObservations: CasTouchedReader | undefined;
}

const NOTHING_OBSERVED: CasTouchedSnapshot = { before: new Map(), blockedSecretPaths: new Set() };

/**
 * Turn start, in capture mode: snapshot the pre-turn ids, pin the pre-turn
 * tree behind the baseline ref and author BASELINE_CAPTURED under the
 * harness's identity (the event rides the next persist), and build the
 * progress substrate for this workspace shape — the git slice over the
 * baseline and the harness's excluded paths, the CAS slice over whatever
 * observations the adapter later binds (a delegating reader, since the bind
 * happens inside `runTurn`), hybrid when both apply. The CAS slice exists
 * only when artifact storage does: without it a gitignored write is
 * deny-gated by the harness (`captureIgnored`), never captured, and the
 * ledger could not store its blobs anyway.
 *
 * Returns `undefined` outside capture mode: nothing to pin, nothing to
 * capture. With review off file writes flow uncaptured; with review on and
 * no substrate the classic deny-gate governs them.
 */
export async function pinCaptureBaseline(args: {
  readonly rows: TurnRows;
  readonly executionId: string;
  readonly workspace: TurnWorkspace;
  readonly fileReview: FileReviewIdentity;
  readonly artifactStorage: ArtifactStorage | undefined;
  /** The run's file record as this invocation found it (`RunStatus.file_changes`): where an open set it continues is. */
  readonly fileRecord: readonly FileChangeSet[];
}): Promise<TurnCapture | undefined> {
  const { rows, executionId, workspace, fileReview, artifactStorage, fileRecord } = args;
  if (!workspace.captureMode) return undefined;
  const { primaryDir, gitWorkspace, changeSetId } = workspace;

  const priorSettledToolCallIds = collectSettledToolCallIds(rows.messages);
  const priorSubAgentToolCallIds = collectSubAgentToolCallIds(rows.subAgentRuns);

  // An invocation that continues the run's open set keeps its baseline: a
  // second pin would fold the earlier invocation's edits into it (#1115).
  const adopted = adoptedChangeSetOf(changeSetId, fileRecord);
  const baselineTree = adopted !== undefined
    ? adoptBaselineToLedger({ rows, executionId, changeSet: adopted })
    : await captureBaselineToLedger({
        rows,
        gitRoot: primaryDir,
        executionId,
        changeSetId,
        harnessId: fileReview.harnessId,
        excludePaths: fileReview.excludePaths,
        gitWorkspace,
      });

  const capture: TurnCapture = {
    changeSetId,
    baselineTree,
    progress: {
      changeSetId,
      state: newProgressCaptureState(),
      substrate: buildProgressSubstrate({
        executionId,
        workspace,
        baselineTree,
        excludePaths: fileReview.excludePaths,
        casSlice: artifactStorage !== undefined,
        // Delegates to whatever the adapter binds later; `capture` is
        // assigned before any capture() can run.
        readObservations: () => capture.casObservations?.() ?? NOTHING_OBSERVED,
      }),
    },
    priorSettledToolCallIds,
    priorSubAgentToolCallIds,
    casObservations: undefined,
  };
  return capture;
}

/**
 * The progress substrate for this workspace shape: a git
 * tree diffs its tracked paths by `--numstat` against the baseline; the CAS
 * slice reads the engine's observations for the gitignored (git tree) or
 * every (non-git) path; a git tree with storage composes both. The truth
 * table is `deriveCaptureMode`'s: capture mode holds only for a git tree or
 * a workspace with storage, so the fourth cell is unreachable and says so.
 */
function buildProgressSubstrate(args: {
  readonly executionId: string;
  readonly workspace: TurnWorkspace;
  readonly baselineTree: string;
  readonly excludePaths: readonly string[];
  readonly casSlice: boolean;
  readonly readObservations: CasTouchedReader;
}): ProgressSubstrate {
  const { executionId, workspace, baselineTree, excludePaths, casSlice, readObservations } = args;
  const git = workspace.gitWorkspace
    ? createGitProgressSubstrate({ workspaceRoot: workspace.primaryDir, executionId, baselineTree, excludePaths })
    : undefined;
  const cas = casSlice ? createCasProgressSubstrate({ workspaceRoot: workspace.primaryDir, read: readObservations }) : undefined;
  if (git && cas) return createHybridProgressSubstrate(git, cas);
  const one = git ?? cas;
  if (!one) throw new Error(`capture: capture mode on a non-git tree without storage (execution=${executionId}); deriveCaptureMode forbids this`);
  return one;
}

/**
 * Turn end: compose the CAS captures from the bound observations, derive the
 * approved-command provenance, author CANDIDATE_CAPTURED (the seam authors
 * nothing for a turn that changed nothing), and — iff a candidate exists —
 * stamp the flowed rows. The working tree is LEFT applied: the user reviews
 * the real change, and an Undo puts files back at a later turn's start
 * (`owed-undos.ts`). Returns whether a change set was authored; it never
 * decides how the turn ends.
 */
export async function captureCandidate(args: {
  readonly rows: TurnRows;
  readonly executionId: string;
  readonly workspace: TurnWorkspace;
  readonly fileReview: FileReviewIdentity;
  readonly artifactStorage: ArtifactStorage | undefined;
  readonly capture: TurnCapture;
  /** `spec.auto_approve_all`, the one whole-run bypass: qualifies every executed command as consented. */
  readonly globalBypass: boolean;
}): Promise<boolean> {
  const { rows, executionId, workspace, fileReview, artifactStorage, capture, globalBypass } = args;
  const { primaryDir, gitWorkspace } = workspace;
  const { changeSetId } = capture;

  const casCaptureClass = gitWorkspace ? FileCaptureClass.GIT_IGNORED_CAPTURED : FileCaptureClass.NON_GIT_CAS;
  const observed = artifactStorage && capture.casObservations ? await capture.casObservations() : NOTHING_OBSERVED;
  const { casCaptures, unreviewablePaths } = await buildCasTurnCaptures(observed, primaryDir, casCaptureClass);

  const commandProvenance = deriveCommandProvenance(rows, capture, globalBypass);
  if (commandProvenance) {
    console.log(
      `capture: turn qualifies for approved-command auto-keep ` +
        `(consent rows: ${commandProvenance.consentToolCallIds.join(",") || "(auto_approve_all)"}); ` +
        `attaching provenance to candidate (execution=${executionId})`,
    );
  }

  await captureCandidateToLedger({
    rows,
    gitRoot: primaryDir,
    executionId,
    changeSetId,
    baselineTree: capture.baselineTree,
    harnessId: fileReview.harnessId,
    excludePaths: fileReview.excludePaths,
    casCaptures,
    storage: artifactStorage,
    unreviewablePaths,
    unreviewableCaptureClass: casCaptureClass,
    gitWorkspace,
    commandProvenance,
  });

  const captured = hasCandidateCaptured(rows, changeSetId);
  if (captured) {
    // A row must never reference a change set that does not exist, so the
    // stamp is gated on the authored candidate.
    stampFlowedFileEditRows(rows.messages, changeSetId, { flowed: isCompletedRow });
    stampFlowedSubAgentFileEditRows(rows.subAgentRuns, changeSetId, capture.priorSubAgentToolCallIds, isCompletedRow);
    console.log(`capture: change set ${changeSetId} authored to the file_review ledger; working tree left applied for review (execution=${executionId})`);
  }
  return captured;
}

/** The row's own evidence that its effect landed on the tree. */
function isCompletedRow(tc: ToolCall): boolean {
  return tc.status === ToolCallStatus.TOOL_CALL_COMPLETED;
}

/**
 * The runtime's two inputs to the shared approved-command rule (see the
 * header). Pure
 * over the rows and the pre-turn snapshots; exported for its own tests.
 */
export function deriveCommandProvenance(
  rows: Pick<TurnRows, "messages" | "subAgentRuns">,
  capture: Pick<TurnCapture, "priorSettledToolCallIds" | "priorSubAgentToolCallIds">,
  globalBypass: boolean,
): TurnCommandProvenance | undefined {
  // Any sub-agent activity this turn disqualifies — a sub-agent
  // that ran contributes at least one row id absent from the pre-turn set,
  // and its writes fold into this change set without a consented command.
  for (const id of collectSubAgentToolCallIds(rows.subAgentRuns)) {
    if (!capture.priorSubAgentToolCallIds.has(id)) return undefined;
  }
  const turnToolCalls = rows.messages.flatMap((m) => m.toolCalls).filter((tc) => !capture.priorSettledToolCallIds.has(tc.id));
  return qualifyTurnCommandProvenance({
    turnToolCalls,
    messages: rows.messages,
    isExecutedCommand: isCompletedRow,
    resolveDirectConsent: (tc) =>
      tc.approvalAction === ApprovalAction.APPROVE || tc.approvalAction === ApprovalAction.APPROVE_ALL ? tc.id : undefined,
    globalBypass,
  });
}
