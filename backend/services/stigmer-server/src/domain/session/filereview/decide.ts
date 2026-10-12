/**
 * The one writer of a person's file-review decision: keep or undo a turn's
 * change set, or one of its files. SessionCommandController
 * .reviewFileChanges and its older twin RunCommandController
 * .submitFileDecision (domain/run/submit-file-decision.ts) both decide
 * here.
 *
 * A turn's edits are already applied when it ends (apply-then-review), and
 * no turn waits on review (stigmer#1471): a decision records what the
 * person chose and, for an undo, gets the file put back.
 *
 *   1. The change set's run. A change set id is `<runId>:<turnSeq>` and a
 *      run id holds no `:`, so the run is the text before the first `:`.
 *      Asked in a session, the run must be one of that session's, else
 *      NOT_FOUND.
 *   2. The target, against the run's projection: the set (and the file,
 *      for FILE scope) exists, a keep passes the completeness gate, and
 *      the expected digest is what the person reviewed. The same checks
 *      run again under the lock.
 *   3. One write on the run (session/events/run-writes.ts
 *      updateRunAppendingEvents), under the session's lock: the window
 *      (a set is decidable while its run's user.message is the
 *      conversation's newest; a reconcile turn writes none, so it never
 *      closes it) refuses a late decision with FAILED_PRECONDITION; the
 *      FILE_DECIDED ledger event is recorded and file_change_sets
 *      re-projected. The write appends its stigmer.file_review.decided
 *      event with it. A decision the ledger already holds on the target
 *      is final (its id is deterministic, author.ts): the same decision
 *      again answers success and writes nothing, and so does any other on
 *      a target already decided while the window is open; after the
 *      window closes only a repeat of the person's own decision answers
 *      success.
 *   4. An undo on a run that has ended starts the reconcile turn: a run
 *      with `reconcile_file_review` and no message, created through the
 *      run create chain as the person who decided (server-composed, so
 *      the chain's GuardReconcileFileReview admits it), unless one is
 *      already unfinished in the session (it, or the next turn, puts the
 *      file back). The decision is committed first: a refused create (a
 *      capacity gate, say) leaves it standing, is logged, and the
 *      decision still succeeds with no reconcile turn named; the next
 *      turn restores what is owed before its agent runs. An undo on a run
 *      still working is restored by that run's next start or the turn
 *      after it.
 *
 * A file decision signals no workflow: the turn's gate is its pending
 * approvals alone.
 *
 * A run in no session has no conversation to move on, so it has no
 * window and no reconcile turn.
 *
 * Proven by __tests__/decide.test.ts and the run-file-review conformance
 * suite.
 */
import { create, enumToJson, fromBinary } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileDecisionAction,
  FileDecisionActionSchema,
  FileDecisionOrigin,
  FileDecisionScope,
  FileDecisionScopeSchema,
  FileReviewEventType,
  RunPhase,
  RunPhaseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type {
  FileDecision,
  FileReviewEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import type { Logger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../../pipeline/errors.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import {
  approveBlockedReason,
  buildFileDecision,
  eventId as fileReviewEventId,
  findChange,
  findChangeSet,
  recordFileDecisionEvent,
  targetDigest,
} from "../../run/filereview/author.js";
import { projectFileChangeSets } from "../../run/filereview/project.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import type { StreamBroker } from "../../run/stream-broker.js";
import { updateRunAppendingEvents } from "../events/run-writes.js";
import type { RunEventWriteDeps } from "../events/run-writes.js";
import { sessionIdOfRun } from "../events/transitions.js";

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
  /** The run's live subscribers see the decision (stream-broker.ts). */
  readonly broker: StreamBroker;
  readonly reconcileTurns: ReconcileTurnCreatorProvider;
}

/** Where the decision lands: the change set's run, and the session it was asked in, if any. */
export interface FileDecisionTarget {
  readonly runId: string;
  /** Set when asked in a session: the run must be one of its runs. */
  readonly sessionId?: string;
}

/** What the person decided, in the ledger's terms. */
export interface FileDecisionAsked {
  readonly changeSetId: string;
  readonly scope: FileDecisionScope;
  readonly fileChangeId: string;
  readonly action: FileDecisionAction;
  readonly expectedDigest: string;
  readonly reason: string;
  readonly acknowledgeUnreviewable: boolean;
}

export interface FileDecisionOutcome {
  /** The change set's run as committed. */
  readonly run: Run;
  /** False when the ledger already held the decision and nothing was written. */
  readonly recorded: boolean;
  /** The reconcile turn this undo started; "" when none was. */
  readonly reconcileRunId: string;
}

/** The refusal of a decision once a later message was sent. */
export const CONVERSATION_MOVED_ON_MESSAGE =
  "the conversation has moved on; these edits were kept";

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

/** Thrown inside the write to leave the row as it is: the ledger already holds this decision. */
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

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  // The reviewer is the principal the caller's chain authorized, recorded
  // as the approval writer records its decider (stigmer/stigmer#1385).
  const reviewerId = identity.identityId;

  let committed: Run;
  try {
    const result = await updateRunAppendingEvents(
      deps,
      runId,
      (run, session) => {
        // Again under the lock, against the committed row: a capture or a
        // decision may have landed since the load.
        validateFileDecisionTarget(run, asked);
        const status = run.status!;
        const recorded = recordedDecision(status.fileReviewEventStream, asked);
        if (recorded !== undefined && isSameDecision(recorded, asked)) {
          throw new DecisionAlreadyRecorded(run);
        }
        if (sessionIdOfRun(run) !== "" && session.runOfNewestType !== runId) {
          throw failedPreconditionError(CONVERSATION_MOVED_ON_MESSAGE);
        }
        if (recorded !== undefined) {
          throw new DecisionAlreadyRecorded(run);
        }
        const decision = buildFileDecision(
          asked.changeSetId,
          asked.fileChangeId,
          asked.scope,
          asked.action,
          asked.expectedDigest,
          reviewerId,
          now,
          asked.reason,
          asked.acknowledgeUnreviewable,
        );
        recordFileDecisionEvent(status, runId, decision);
        // The single projection seam, so the decision reads back at once
        // and agrees with the ledger.
        status.fileChangeSets = projectFileChangeSets(
          status.fileReviewEventStream,
        );
      },
      { runOfNewestType: TURN_EVENT_TYPE },
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
      throw target.sessionId === undefined
        ? notFoundError("Run", runId)
        : changeSetNotFound(asked.changeSetId, target.sessionId);
    }
    // A refusal re-detected under the lock is the client's, verbatim.
    if (error instanceof ConnectError) {
      throw error;
    }
    throw internalError(error, "failed to persist file decision");
  }

  deps.broker.broadcast(committed);
  deps.logger.info("AUDIT: File decision submitted", {
    executionId: runId,
    org: committed.metadata?.org ?? "",
    changeSetId: asked.changeSetId,
    fileChangeId: asked.fileChangeId,
    scope: enumToJson(FileDecisionScopeSchema, asked.scope),
    action: enumToJson(FileDecisionActionSchema, asked.action),
    reviewerId,
  });

  const reconcileRunId =
    asked.action === FileDecisionAction.REJECT &&
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
    // Only a session's change set id can name no run; a run id is
    // required on the run's own method.
    throw changeSetNotFound(changeSetId, sessionId ?? "");
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
      throw sessionId === undefined
        ? notFoundError("Run", target.runId)
        : changeSetNotFound(changeSetId, sessionId);
    }
    throw internalError(error, "failed to load agent execution");
  }
  if (sessionId !== undefined && sessionIdOfRun(run) !== sessionId) {
    throw changeSetNotFound(changeSetId, sessionId);
  }
  return run;
}

/**
 * The preconditions, against the run's projection: change set (and file)
 * existence, the FILE-scope file_change_id requirement, the keep
 * completeness gate and the expected_digest gate. Run before the write
 * and again under its lock.
 */
export function validateFileDecisionTarget(
  run: Run,
  asked: FileDecisionAsked,
): void {
  const runId = run.metadata?.id ?? "";
  const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;

  const changeSets = projectFileChangeSets(run.status?.fileReviewEventStream);
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

  if (asked.scope === FileDecisionScope.FILE) {
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
  if (asked.action === FileDecisionAction.APPROVE) {
    const reason = approveBlockedReason(
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

/** The decision the ledger already holds on the asked target, by its deterministic event id. */
function recordedDecision(
  stream: FileReviewEventStream | undefined,
  asked: FileDecisionAsked,
): FileDecision | undefined {
  const scopeId =
    asked.scope === FileDecisionScope.FILE
      ? asked.fileChangeId
      : asked.changeSetId;
  const id = fileReviewEventId(
    asked.changeSetId,
    scopeId,
    FileReviewEventType.FILE_DECIDED,
  );
  for (const event of stream?.events ?? []) {
    if (event.eventId === id && event.payload.case === "fileDecided") {
      return event.payload.value;
    }
  }
  return undefined;
}

/** Whether the recorded decision is this one again: a person's, with the same action. */
function isSameDecision(
  recorded: FileDecision,
  asked: FileDecisionAsked,
): boolean {
  const byPerson =
    recorded.origin === FileDecisionOrigin.USER ||
    recorded.origin === FileDecisionOrigin.UNSPECIFIED;
  return byPerson && recorded.action === asked.action;
}

/**
 * Starts the reconcile turn for an undo on an ended run, unless one is
 * already unfinished in the session. Never throws: the decision is
 * committed, and the next turn restores what is owed.
 */
async function startReconcileTurn(
  deps: FileDecisionDeps,
  run: Run,
  identity: CallerIdentity,
): Promise<string> {
  const sessionId = sessionIdOfRun(run);
  if (sessionId === "") {
    return "";
  }
  const runId = run.metadata?.id ?? "";
  try {
    if (await reconcileTurnUnfinished(deps, sessionId)) {
      deps.logger.info(
        "A reconcile turn is already unfinished in the session; it restores this undo",
        {
          executionId: runId,
          sessionId,
        },
      );
      return "";
    }
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

/** Whether a reconcile turn is working in the session, read from the working runs' key alone. */
async function reconcileTurnUnfinished(
  deps: FileDecisionDeps,
  sessionId: string,
): Promise<boolean> {
  const rows = await deps.store.queryResources(agentExecutionListIndex, {
    anyKey: [{ name: "working_session", value: sessionId }],
  });
  return rows.some(
    (row) => fromBinary(RunSchema, row.data).spec?.reconcileFileReview === true,
  );
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
