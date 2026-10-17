/**
 * The one writer of a person's file-review decision: keep or undo a turn's
 * change set, or one of its files. SessionCommandController
 * .reviewFileChanges decides here.
 *
 * A turn's edits are already applied when it ends (apply-then-review), and
 * no turn waits on review (stigmer#1471): a decision records what the
 * person chose and, for an undo, gets the file put back.
 *
 *   1. The change set's run. A change set id is `<runId>:<turnSeq>` and a
 *      run id holds no `:`, so the run is the text before the first `:`.
 *      The run must be one of the session's the decision was asked in,
 *      else NOT_FOUND: a decision lives in its session's log, so a run in
 *      no session has none.
 *   2. The target, against the run's file record (run/filereview/
 *      record.ts): the set (and the file, for a file decision) exists, a
 *      keep passes the completeness gate, and the expected digest is what
 *      the person reviewed. The same checks run again under the lock.
 *   3. One write on the run (session/events/run-writes.ts
 *      updateRunAppendingEvents), under the session's lock: the window
 *      (a set is decidable while its run's user.message is the
 *      conversation's newest; a reconcile turn writes none, so it never
 *      closes it) refuses a late decision with FAILED_PRECONDITION; the
 *      write appends the decision's stigmer.file_review.decided event
 *      (run/filereview/decided.ts), naming the person who decided in
 *      decided_by. A decision the session's log already holds on the
 *      target (its decided events, read under the lock,
 *      run/filereview/logged.ts) is final: the same decision again
 *      answers success and writes nothing, even after the window closes;
 *      a different one on a target already decided is refused
 *      (CONFLICTING_DECISION_MESSAGE), so an Undo is never answered as if
 *      it were recorded when it was not.
 *   4. An undo on a run that has ended starts the reconcile turn: a run
 *      with `reconcile_file_review` and no message, created through the
 *      run create chain as the person who decided (server-composed, so
 *      the chain's GuardReconcileFileReview admits it). Every such undo
 *      starts one, even while another is unfinished: that one may already
 *      have read what is owed, the workspace lock serializes them, and a
 *      turn that finds nothing owed simply completes (the runner keys what
 *      is owed per decision, harness/owed-undos.ts). The decision is
 *      committed first: a refused create (a
 *      capacity gate, say) leaves it standing, is logged, and the
 *      decision still succeeds with no reconcile turn named; the next
 *      turn restores what is owed before its agent runs. An undo on a run
 *      still working is restored by that run's next start or the turn
 *      after it; one on a turn that is then stopped while it waits, by
 *      the reconcile turn its stop starts (stopped-turn.ts).
 *
 * A file decision signals no workflow: the turn's gate is its open asks
 * alone (run/filereview/gate.ts).
 *
 * Proven by __tests__/decide.test.ts and the run-file-review conformance
 * suite.
 */
import { create, enumToJson } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, RunPhaseSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../../pipeline/errors.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import { decidedEvent } from "../../run/filereview/decided.js";
import {
  FILE_REVIEW_DECIDED_TYPE,
  PERSON_ORIGIN,
  decisionOnTarget,
  runReviewLogOf,
} from "../../run/filereview/logged.js";
import type { LoggedDecision } from "../../run/filereview/logged.js";
import {
  findChange,
  findChangeSet,
  keepBlockedReason,
  targetDigest,
} from "../../run/filereview/record.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import { eventOf } from "../events/codec.js";
import { updateRunAppendingEvents } from "../events/run-writes.js";
import type { RunEventWriteDeps } from "../events/run-writes.js";
import { sessionIdOfRun } from "../events/transitions.js";
import type { ActionWord, ScopeWord } from "./words.js";

/**
 * The in-process edge that creates a reconcile turn: the run create chain,
 * as the caller given, over the in-process transport (boot/inprocess.ts),
 * so the request is server-composed and every create gate reads the
 * person who decided.
 */
export interface ReconcileTurnCreator {
  create(run: Run, caller: CallerIdentity): Promise<Run>;
}

/** Resolved at call time: the in-process clients are built after the routes. */
export type ReconcileTurnCreatorProvider = () => ReconcileTurnCreator;

export interface FileDecisionDeps extends RunEventWriteDeps {
  readonly logger: Logger;
  readonly reconcileTurns: ReconcileTurnCreatorProvider;
}

/** Where the decision lands: the change set's run, and the session it was asked in. */
export interface FileDecisionTarget {
  readonly runId: string;
  /** The run must be one of this session's runs. */
  readonly sessionId: string;
}

/** What the person decided, in the decision's words (words.ts). */
export interface FileDecisionAsked {
  readonly changeSetId: string;
  readonly scope: ScopeWord;
  readonly fileChangeId: string;
  readonly action: ActionWord;
  readonly expectedDigest: string;
  readonly reason: string;
  readonly acknowledgeUnreviewable: boolean;
}

export interface FileDecisionOutcome {
  /** The change set's run as committed. */
  readonly run: Run;
  /** False when the log already held the decision and nothing was written. */
  readonly recorded: boolean;
  /** The reconcile turn this undo started; "" when none was. */
  readonly reconcileRunId: string;
}

/** The refusal of a decision once a later message was sent. */
export const CONVERSATION_MOVED_ON_MESSAGE =
  "the conversation has moved on; these edits were kept";

/** The refusal of a decision on a target another decision already settled. */
export const CONFLICTING_DECISION_MESSAGE =
  "this change was already decided, and a decision is final";

/** The newest event of this type names the conversation's newest turn. */
const TURN_EVENT_TYPE = "user.message";

/** The run a change set id names: the text before its first `:`, or "" for an id with none. */
export function runIdOfChangeSet(changeSetId: string): string {
  const colon = changeSetId.indexOf(":");
  return colon <= 0 ? "" : changeSetId.slice(0, colon);
}

/** A change set that is not one of the session's (absent, or another conversation's). */
function changeSetNotFound(
  changeSetId: string,
  sessionId: string,
): ConnectError {
  return notFoundError(
    "Change set",
    `'${changeSetId}' in session '${sessionId}'`,
  );
}

/** Thrown inside the write to leave the row as it is: the log already holds this decision. */
class DecisionAlreadyRecorded extends Error {
  constructor(readonly run: Run) {
    super("file decision already recorded");
    this.name = "DecisionAlreadyRecorded";
  }
}

export async function decideFileChanges(
  deps: FileDecisionDeps,
  target: FileDecisionTarget,
  asked: FileDecisionAsked,
  identity: CallerIdentity,
): Promise<FileDecisionOutcome> {
  const runId = target.runId;
  const loaded = await loadRun(deps, target, asked.changeSetId);
  validateFileDecisionTarget(loaded, asked);

  // The decider is the principal the caller's chain authorized, recorded
  // as the answer core records its decider (stigmer/stigmer#1385).
  const decidedBy = identity.identityId;

  let committed: Run;
  try {
    const result = await updateRunAppendingEvents(
      deps,
      runId,
      (run, session) => {
        // Again under the lock, against the committed row: a capture or a
        // decision may have landed since the load.
        validateFileDecisionTarget(run, asked);
        const recorded = decisionOnTarget(
          runReviewLogOf(session.runEvents.map(eventOf)),
          asked.changeSetId,
          asked.scope,
          asked.fileChangeId,
        );
        if (recorded !== undefined && isSameDecision(recorded, asked)) {
          throw new DecisionAlreadyRecorded(run);
        }
        if (session.runOfNewestType !== runId) {
          throw failedPreconditionError(CONVERSATION_MOVED_ON_MESSAGE);
        }
        if (recorded !== undefined) {
          throw failedPreconditionError(CONFLICTING_DECISION_MESSAGE);
        }
        return {
          last: [
            decidedEvent(runId, {
              changeSetId: asked.changeSetId,
              scope: asked.scope,
              fileChangeId: asked.fileChangeId,
              action: asked.action,
              expectedDigest: asked.expectedDigest,
              origin: PERSON_ORIGIN,
              reason: asked.reason,
              decidedBy,
            }),
          ],
        };
      },
      { runOfNewestType: TURN_EVENT_TYPE, runEventTypes: [FILE_REVIEW_DECIDED_TYPE] },
    );
    committed = result.run;
  } catch (error) {
    if (error instanceof DecisionAlreadyRecorded) {
      deps.logger.info("IDEMPOTENT: file decision already recorded", {
        executionId: runId,
        changeSetId: asked.changeSetId,
        fileChangeId: asked.fileChangeId,
      });
      return { run: error.run, recorded: false, reconcileRunId: "" };
    }
    if (error instanceof ResourceNotFoundError) {
      throw changeSetNotFound(asked.changeSetId, target.sessionId);
    }
    // A refusal re-detected under the lock is the client's, verbatim.
    if (error instanceof ConnectError) {
      throw error;
    }
    throw internalError(error, "failed to persist file decision");
  }

  deps.logger.info("AUDIT: File decision submitted", {
    executionId: runId,
    org: committed.metadata?.org ?? "",
    changeSetId: asked.changeSetId,
    fileChangeId: asked.fileChangeId,
    scope: asked.scope,
    action: asked.action,
    decidedBy,
  });

  const reconcileRunId =
    asked.action === "undo" &&
    isTerminalExecutionPhase(
      committed.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
    )
      ? await startReconcileTurn(deps, committed, identity)
      : "";
  return { run: committed, recorded: true, reconcileRunId };
}

async function loadRun(
  deps: FileDecisionDeps,
  target: FileDecisionTarget,
  changeSetId: string,
): Promise<Run> {
  const sessionId = target.sessionId;
  if (target.runId === "") {
    throw changeSetNotFound(changeSetId, sessionId);
  }
  let run: Run;
  try {
    run = await deps.store.getResource(
      ApiResourceKind.run,
      target.runId,
      RunSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      throw changeSetNotFound(changeSetId, sessionId);
    }
    throw internalError(error, "failed to load agent execution");
  }
  if (sessionIdOfRun(run) !== sessionId) {
    throw changeSetNotFound(changeSetId, sessionId);
  }
  return run;
}

/**
 * The preconditions, against the run's file record: change set (and file)
 * existence, the file decision's file_change_id requirement, the keep
 * completeness gate and the expected_digest gate. Run before the write
 * and again under its lock.
 */
export function validateFileDecisionTarget(
  run: Run,
  asked: FileDecisionAsked,
): void {
  const runId = run.metadata?.id ?? "";
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;

  const changeSets = run.status?.fileChanges ?? [];
  if (changeSets.length === 0) {
    throw failedPreconditionError(
      `execution ${runId} has no actionable file change sets (phase ${enumToJson(RunPhaseSchema, phase) as string})`,
    );
  }

  const cs = findChangeSet(changeSets, asked.changeSetId);
  if (cs === undefined) {
    throw failedPreconditionError(
      `change set ${asked.changeSetId} not found for execution ${runId}`,
    );
  }

  if (asked.scope === "file") {
    if (asked.fileChangeId === "") {
      throw invalidArgumentError("file_change_id is required for FILE scope");
    }
    if (findChange(cs, asked.fileChangeId) === undefined) {
      throw failedPreconditionError(
        `file change ${asked.fileChangeId} not found in change set ${asked.changeSetId}`,
      );
    }
  }

  // A change that cannot be shown whole is never kept as if it could;
  // only a keep is gated, so any change can still be undone.
  if (asked.action === "keep") {
    const reason = keepBlockedReason(
      cs,
      asked.scope,
      asked.fileChangeId,
      asked.acknowledgeUnreviewable,
    );
    if (reason !== "") {
      throw failedPreconditionError(reason);
    }
  }

  if (
    asked.expectedDigest !== targetDigest(cs, asked.scope, asked.fileChangeId)
  ) {
    throw invalidArgumentError(
      `expected_digest mismatch for change set ${asked.changeSetId}: the captured content changed since it was reviewed`,
    );
  }
}

/** Whether the recorded decision is this one again: a person's, with the same action. */
function isSameDecision(
  recorded: LoggedDecision,
  asked: FileDecisionAsked,
): boolean {
  return recorded.origin === PERSON_ORIGIN && recorded.action === asked.action;
}

/**
 * Starts the reconcile turn for an undo on an ended run, as `identity`.
 * Never throws: the decision is committed, and the next turn restores
 * what is owed. Also started for a turn stopped while it waited
 * (stopped-turn.ts).
 */
export async function startReconcileTurn(
  deps: Pick<FileDecisionDeps, "logger" | "reconcileTurns">,
  run: Run,
  identity: CallerIdentity,
): Promise<string> {
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "") {
    return "";
  }
  const runId = run.metadata?.id ?? "";
  try {
    const created = await deps
      .reconcileTurns()
      .create(reconcileTurnRequest(run, sessionId), identity);
    const reconcileRunId = created.metadata?.id ?? "";
    deps.logger.info("Started a reconcile turn for an undo on an ended turn", {
      executionId: runId,
      sessionId,
      reconcileRunId,
    });
    return reconcileRunId;
  } catch (error) {
    const fields = {
      executionId: runId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    };
    if (error instanceof ConnectError) {
      deps.logger.warn(
        "The reconcile turn was refused; the undo stands and the next turn restores it",
        fields,
      );
    } else {
      deps.logger.error(
        "The reconcile turn could not be started; the undo stands and the next turn restores it",
        fields,
      );
    }
    return "";
  }
}

/**
 * The reconcile turn: in the change set's session and its organization
 * (a turn in a session is that session's organization's, run/
 * session-binding.ts), no message, nothing else set; the runner reads
 * what is owed from the session's log.
 */
export function reconcileTurnRequest(run: Run, sessionId: string): Run {
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, {
      name: `reconcile-file-review-${Date.now()}`,
      org: run.metadata?.org ?? "",
    }),
    spec: create(RunSpecSchema, {
      target: { case: "sessionId", value: sessionId },
      reconcileFileReview: true,
    }),
  });
}
