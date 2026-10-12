/**
 * The one core every answer to a waiting tool use goes through:
 * SessionCommandController.confirmToolUse and grantPermission, and the
 * RunCommandController.submitApproval adapter. Each method authorizes its
 * own way, then appends these steps to its chain:
 *
 *   LoadAskedRun ... the run is the text before the first `.` of the tool
 *                    use id (run ids hold none), and must be one of the
 *                    session's runs; the row is the call whose tool use id
 *                    (../events/ids.ts, the runner's derivation) is the one
 *                    answered and that asked, at the root or in a sub-agent.
 *                    Anything else is NOT_FOUND.
 *   AnswerReplay ... an answer already recorded for the tool use (its
 *                    user.tool_confirmation, by its derived id) ends the
 *                    chain: the same answer is success with the stored
 *                    events, another is FAILED_PRECONDITION (an answer is
 *                    final). A replay never reaches the gate slot, the
 *                    write or the signal.
 *   ValidateAnswer . the run waits for approval or is in progress (a fast
 *                    answer can land between the runner's asks and its
 *                    waiting write), and the call still waits undecided.
 *   the gate slot .. `agent-execution-submit-approval:gate`, run once per
 *                    fresh answer whichever method came in. Its steps read
 *                    the answer with `approvalAnswerOf(ctx)`
 *                    (APPROVAL_ANSWER_KEY).
 *   RecordAnswer ... one run write (updateRunAppendingEvents): the
 *                    user.tool_confirmation (and, for a grant, the
 *                    stigmer.permission.grant and a confirmation for every
 *                    other waiting call of the class), the rows' decision
 *                    stamps (APPROVE, REJECT for a deny, APPROVE_ALL for a
 *                    grant: RunStatus readers and file review's auto-keep
 *                    read them until the transcript leaves the run), the
 *                    recomputed pending approvals and whatever the
 *                    session's status becomes. Under the session's lock it
 *                    checks again what ValidateAnswer checked (the ask is
 *                    open, the call waits undecided, the run waits or
 *                    works), so an answer racing a stop is refused; a
 *                    concurrent identical answer that landed first is
 *                    answered as the replay.
 *   SignalWorkflow . when the run has no open ask left, the turn's workflow
 *                    is told to resume. A workflow that no longer runs
 *                    fails the run (reconcileStaleExecution).
 *
 * A deny's message is recorded on the confirmation, which the runner reads
 * at the turn's resume and hands the agent. A grant's class is the call's
 * lease scope (run/approval/lease-scope.ts); a call with none is allowed
 * alone and no grant is written, as an "approve all" always degraded.
 *
 * The confirmation's id is `sevt_tc_` and the first 40 hex digits of the
 * sha256 of the tool use id, the grant's `sevt_pg_`, so the log refuses a
 * second of either. Each is written in the tool use's own thread.
 *
 * Proven by __tests__/answer.test.ts and the run-approval conformance
 * suite.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  MessageType,
  RunPhase,
  RunPhaseSchema,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { enumToJson } from "@bufbuild/protobuf";

import type { Logger } from "../../../boot/logger.js";
import type { ResolvedGateSteps } from "../../../extensions/gate-slots.js";
import { stepsForSlot } from "../../../extensions/gate-slots.js";
import type { RunStatusObserver } from "../../../extensions/status-hooks.js";
import {
  failedPreconditionError,
  internalError,
  notFoundError,
  unavailableError,
} from "../../../pipeline/errors.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import type { RequestContext } from "../../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { deriveLeaseScope, sameLeaseScope } from "../../run/approval/lease-scope.js";
import type { LeaseScope } from "../../run/approval/lease-scope.js";
import { pendingApprovalsOf } from "../../run/approval/pending.js";
import type { ExecutionEngineStateProvider } from "../../run/engine.js";
import { EngineWorkflowNotFoundError } from "../../run/engine.js";
import { gateResolved } from "../../run/filereview/gate.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import { notifyStatusObservers } from "../../run/status-observers.js";
import type { StreamBroker } from "../../run/stream-broker.js";
import { settleInterruptedToolCalls } from "../../run/tool-call-settle.js";
import type { SessionEventBroker } from "../events/broker.js";
import { SESSION_EVENT_ID_PREFIX } from "../events/catalog.js";
import { eventOf } from "../events/codec.js";
import { runIdOfToolUse, toolUseEventId } from "../events/ids.js";
import {
  openAsksOf,
  overwriteRunAppendingEvents,
  updateRunAppendingEvents,
} from "../events/run-writes.js";
import { sessionIdOfRun } from "../events/transitions.js";

export interface AnswerDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** The runs' live subscribers see the answer's stamps. */
  readonly broker: StreamBroker;
  /** The answer's events reach the session's live streams. */
  readonly sessionEventBroker: SessionEventBroker;
  readonly engineState: ExecutionEngineStateProvider;
  /** The composed slot registrations: the approval gate slot. */
  readonly gateSteps: ResolvedGateSteps;
  /** The stale-workflow reconcile's FAILED stamp is a notified transition. */
  readonly statusObservers: ReadonlyArray<RunStatusObserver>;
}

/** allow (the call runs) or deny (it does not). */
export type AnswerResult = "allow" | "deny";

/** What a method asks the core to record. */
export interface AnswerRequest {
  readonly sessionId: string;
  readonly toolUseId: string;
  readonly result: AnswerResult;
  /** Only with deny. */
  readonly denyMessage: string;
  /** A grant: allow, and every call of the class for the rest of the turn. */
  readonly grant: boolean;
}

/** The answer a gate step reads (`approvalAnswerOf`). */
export interface ApprovalAnswer {
  /** The run as loaded, before the answer is recorded. */
  readonly run: Run;
  readonly toolUseId: string;
  /** The call row the tool use was written from. */
  readonly toolCallId: string;
  readonly result: AnswerResult;
  readonly grant: boolean;
}

/** What the core recorded, or found recorded. */
export interface AnswerOutcome {
  /** The run after the answer. */
  readonly run: Run;
  /** The confirmations: the named call's first, then those a grant wrote. */
  readonly confirmations: ReadonlyArray<SessionEvent>;
  /** The grant; undefined when none was given or the call has no class. */
  readonly grant: SessionEvent | undefined;
}

/**
 * The context key a fresh answer rides under, for the steps of the
 * `agent-execution-submit-approval:gate` slot (`approvalAnswerOf`).
 */
export const APPROVAL_ANSWER_KEY = "approvalAnswer";

const OUTCOME_KEY = "approvalAnswerOutcome";

/** The answer of a chain at the approval gate slot; undefined outside one. */
export function approvalAnswerOf<Desc extends DescMessage>(
  ctx: RequestContext<Desc>,
): ApprovalAnswer | undefined {
  return ctx.get(APPROVAL_ANSWER_KEY) as ApprovalAnswer | undefined;
}

/** The outcome a chain ending in `answerSteps` recorded. */
export function answerOutcomeOf<Desc extends DescMessage>(ctx: RequestContext<Desc>): AnswerOutcome {
  const outcome = ctx.get(OUTCOME_KEY) as AnswerOutcome | undefined;
  /* v8 ignore next 3 -- @preserve: every chain that reads it ends in answerSteps, which sets it or throws */
  if (outcome === undefined) {
    throw new Error("the answer chain recorded no outcome");
  }
  return outcome;
}

/** The id prefix of a user.tool_confirmation the server writes. */
const CONFIRMATION_ID_PREFIX = `${SESSION_EVENT_ID_PREFIX}_tc_`;
/** The id prefix of a stigmer.permission.grant. */
const GRANT_ID_PREFIX = `${SESSION_EVENT_ID_PREFIX}_pg_`;

function digestOf(toolUseId: string): string {
  return createHash("sha256").update(toolUseId).digest("hex").slice(0, 40);
}

/** The user.tool_confirmation id that answers a tool use. */
export function toolConfirmationEventId(toolUseId: string): string {
  return `${CONFIRMATION_ID_PREFIX}${digestOf(toolUseId)}`;
}

/** The stigmer.permission.grant id given on a tool use. */
export function permissionGrantEventId(toolUseId: string): string {
  return `${GRANT_ID_PREFIX}${digestOf(toolUseId)}`;
}

/** An asked call row of a run, with the thread its tool use was written in. */
export interface AskedRow {
  readonly call: ToolCall;
  /** "" for the root thread; the sub-agent's thread otherwise. */
  readonly threadId: string;
}

/** Every call row of a run that asked, with its thread. */
function askedRowsOf(run: Run): AskedRow[] {
  const runId = run.metadata?.id ?? "";
  const rows: AskedRow[] = [];
  for (const message of run.status?.messages ?? []) {
    for (const call of message.toolCalls) {
      if (call.requiresApproval) {
        rows.push({ call, threadId: "" });
      }
    }
  }
  for (const subAgent of run.status?.subAgentRuns ?? []) {
    const threadId = toolUseEventId(runId, subAgent.id);
    for (const message of subAgent.messages) {
      for (const call of message.toolCalls) {
        if (call.requiresApproval) {
          rows.push({ call, threadId });
        }
      }
    }
  }
  return rows;
}

/**
 * The other calls a grant on `toolUseId` allows: every asked call of the
 * run whose ask is open, still waiting and undecided, whose lease scope is
 * `lease` (run/approval/lease-scope.ts: a hook's lease never allows a call
 * the default asked for, nor the reverse).
 */
export function waitingInClass(
  run: Run,
  toolUseId: string,
  lease: LeaseScope,
  open: ReadonlySet<string>,
): AskedRow[] {
  const runId = run.metadata?.id ?? "";
  return askedRowsOf(run).filter((other) => {
    const otherUseId = toolUseEventId(runId, other.call.id);
    const scope = deriveLeaseScope(other.call);
    return (
      otherUseId !== toolUseId &&
      open.has(otherUseId) &&
      other.call.approvalAction === ApprovalAction.UNSPECIFIED &&
      other.call.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL &&
      scope !== undefined &&
      sameLeaseScope(scope, lease)
    );
  });
}

/** The asked row a tool use id names; undefined when none of the run's does. */
function askedRowOf(run: Run, toolUseId: string): AskedRow | undefined {
  const runId = run.metadata?.id ?? "";
  return askedRowsOf(run).find((row) => toolUseEventId(runId, row.call.id) === toolUseId);
}

function confirmationEvent(
  runId: string,
  row: AskedRow,
  toolUseId: string,
  result: AnswerResult,
  denyMessage: string,
): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    threadId: row.threadId,
    event: {
      case: "userToolConfirmation",
      value: {
        id: toolConfirmationEventId(toolUseId),
        result,
        toolUseId,
        denyMessage: result === "deny" ? denyMessage : "",
        sessionThreadId: row.threadId,
      },
    },
  });
}

function grantEvent(runId: string, row: AskedRow, toolUseId: string, lease: LeaseScope): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    threadId: row.threadId,
    event: {
      case: "stigmerPermissionGrant",
      value: {
        id: permissionGrantEventId(toolUseId),
        toolUseId,
        scope: "turn",
        lease: {
          category: lease.category,
          server: lease.server,
          ...(lease.hook === undefined ? {} : { hook: lease.hook }),
          tool: lease.tool,
        },
      },
    },
  });
}

function phaseName(phase: RunPhase): string {
  return enumToJson(RunPhaseSchema, phase) as string;
}

/** A second answer that differs from the first. */
function answeredOtherwise(toolUseId: string): Error {
  return failedPreconditionError(
    `tool use ${toolUseId} was already answered otherwise; an answer is final`,
  );
}

/** The ask closed under the lock before this answer was recorded. */
class AskClosedError extends Error {
  constructor(readonly toolUseId: string) {
    super(`tool use ${toolUseId} no longer waits`);
    this.name = "AskClosedError";
  }
}

/**
 * The outcome of an answer already recorded for the tool use, when it is
 * this one; FAILED_PRECONDITION when another answer was recorded;
 * undefined when none was.
 */
async function recordedAnswer(
  deps: AnswerDeps,
  run: Run,
  request: AnswerRequest,
): Promise<AnswerOutcome | undefined> {
  const runId = run.metadata?.id ?? "";
  const confirmationId = toolConfirmationEventId(request.toolUseId);
  const grantId = permissionGrantEventId(request.toolUseId);
  const records = await deps.store.sessionEvents.list(request.sessionId, {
    order: "asc",
    runId,
    types: ["user.tool_confirmation", "stigmer.permission.grant"],
    limit: 1000,
  });
  const events = records.map(eventOf);
  const confirmation = events.find(
    (event) => event.event.case === "userToolConfirmation" && event.event.value.id === confirmationId,
  );
  if (confirmation === undefined || confirmation.event.case !== "userToolConfirmation") {
    return undefined;
  }
  const grant = events.find(
    (event) => event.event.case === "stigmerPermissionGrant" && event.event.value.id === grantId,
  );
  const recorded = confirmation.event.value;
  const sameResult = recorded.result === request.result && recorded.denyMessage === request.denyMessage;
  // A grant recorded nothing of its own when the call had no class; a
  // plain allow then reads the same as the grant did.
  const row = askedRowOf(run, request.toolUseId);
  const classless = row === undefined || deriveLeaseScope(row.call) === undefined;
  const sameGrant = request.grant ? grant !== undefined || classless : grant === undefined;
  if (!sameResult || !sameGrant) {
    throw answeredOtherwise(request.toolUseId);
  }
  // The calls a grant allowed were confirmed in its own write, which the
  // store stamps with one accepted time.
  const grantedAt = grant?.event.value?.processedAt;
  return {
    run,
    confirmations: [
      confirmation,
      ...(grantedAt === undefined
        ? []
        : events.filter(
            (event) =>
              event !== confirmation &&
              event.event.case === "userToolConfirmation" &&
              event.event.value.processedAt === grantedAt,
          )),
    ],
    grant,
  };
}

/** The steps every answer chain ends with (module header). */
export function answerSteps<Desc extends DescMessage>(
  deps: AnswerDeps,
  requestOf: (ctx: RequestContext<Desc>) => AnswerRequest,
): PipelineStep<Desc>[] {
  const REQUEST_KEY = "approvalAnswerRequest";
  const RUN_KEY = "approvalAnswerRun";
  const requestIn = (ctx: RequestContext<Desc>): AnswerRequest => ctx.get(REQUEST_KEY) as AnswerRequest;
  const runIn = (ctx: RequestContext<Desc>): Run => ctx.get(RUN_KEY) as Run;
  const replayed = (ctx: RequestContext<Desc>): boolean => ctx.get(OUTCOME_KEY) !== undefined;

  return [
    {
      name: "LoadAskedRun",
      async execute(ctx) {
        const request = requestOf(ctx);
        ctx.set(REQUEST_KEY, request);
        const runId = runIdOfToolUse(request.toolUseId);
        const missing = (): Error =>
          notFoundError("tool use", request.toolUseId);
        if (runId === "") {
          throw missing();
        }
        let run: Run;
        try {
          run = await deps.store.getResource(ApiResourceKind.run, runId, RunSchema);
        } catch (error) {
          if (error instanceof ResourceNotFoundError) {
            throw missing();
          }
          throw internalError(error, "failed to load the tool use's run");
        }
        if (sessionIdOfRun(run) !== request.sessionId || askedRowOf(run, request.toolUseId) === undefined) {
          throw missing();
        }
        ctx.set(RUN_KEY, run);
      },
    },
    {
      name: "AnswerReplay",
      async execute(ctx) {
        const outcome = await recordedAnswer(deps, runIn(ctx), requestIn(ctx));
        if (outcome !== undefined) {
          ctx.set(OUTCOME_KEY, outcome);
        }
      },
    },
    {
      name: "ValidateAnswer",
      execute(ctx) {
        if (replayed(ctx)) {
          return;
        }
        const run = runIn(ctx);
        const request = requestIn(ctx);
        const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        if (phase !== RunPhase.RUN_WAITING_FOR_APPROVAL && phase !== RunPhase.RUN_IN_PROGRESS) {
          throw failedPreconditionError(
            `tool use ${request.toolUseId} no longer waits: its turn is ${phaseName(phase)}`,
          );
        }
        const row = askedRowOf(run, request.toolUseId)!;
        if (row.call.approvalAction !== ApprovalAction.UNSPECIFIED) {
          throw answeredOtherwise(request.toolUseId);
        }
        if (row.call.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
          throw failedPreconditionError(`tool use ${request.toolUseId} no longer waits`);
        }
        const answer: ApprovalAnswer = {
          run,
          toolUseId: request.toolUseId,
          toolCallId: row.call.id,
          result: request.result,
          grant: request.grant,
        };
        ctx.set(APPROVAL_ANSWER_KEY, answer);
      },
    },
    // The approval gate slot, once per fresh answer: a replay skips every
    // step after AnswerReplay, so the slot's steps never see one.
    ...stepsForSlot<Desc>(deps.gateSteps, "agent-execution-submit-approval:gate").map(
      (step): PipelineStep<Desc> => ({
        name: step.name,
        async execute(ctx) {
          if (!replayed(ctx)) {
            await step.execute(ctx);
          }
        },
      }),
    ),
    {
      name: "RecordAnswer",
      async execute(ctx) {
        if (replayed(ctx)) {
          return;
        }
        const request = requestIn(ctx);
        try {
          ctx.set(OUTCOME_KEY, await recordAnswer(deps, runIn(ctx), request, ctx.callerIdentity.identityId));
        } catch (error) {
          if (error instanceof AskClosedError) {
            // A concurrent identical answer that landed first is this
            // one's replay; anything else closed the ask.
            const outcome = await recordedAnswer(deps, runIn(ctx), request);
            if (outcome !== undefined) {
              ctx.set(OUTCOME_KEY, outcome);
              return;
            }
            throw failedPreconditionError(error.message);
          }
          if (error instanceof ResourceNotFoundError) {
            // The run was removed between the load and the locked write.
            throw notFoundError("Run", runIn(ctx).metadata?.id ?? "");
          }
          throw internalError(error, "failed to record the answer");
        }
        ctx.set(SIGNAL_KEY, true);
      },
    },
    {
      name: "SignalWorkflow",
      async execute(ctx) {
        if (ctx.get(SIGNAL_KEY) !== true) {
          return;
        }
        await signalWhenResolved(deps, answerOutcomeOf(ctx).run);
      },
    },
  ];
}

const SIGNAL_KEY = "approvalAnswerSignal";

/** The locked write of a fresh answer (module header, RecordAnswer). */
async function recordAnswer(
  deps: AnswerDeps,
  loaded: Run,
  request: AnswerRequest,
  decidedBy: string,
): Promise<AnswerOutcome> {
  const runId = loaded.metadata?.id ?? "";
  const decidedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let confirmations: SessionEvent[] = [];
  let grant: SessionEvent | undefined;
  const { run, events } = await updateRunAppendingEvents(deps, runId, (current, session) => {
    const open = openAsksOf(session, runId);
    const row = askedRowOf(current, request.toolUseId);
    const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    // Everything ValidateAnswer checked, again under the lock: a stop or
    // another answer may have landed since.
    if (
      row === undefined ||
      !open.has(request.toolUseId) ||
      row.call.approvalAction !== ApprovalAction.UNSPECIFIED ||
      row.call.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL ||
      (phase !== RunPhase.RUN_WAITING_FOR_APPROVAL && phase !== RunPhase.RUN_IN_PROGRESS)
    ) {
      throw new AskClosedError(request.toolUseId);
    }
    const stamp = (call: ToolCall, action: ApprovalAction): void => {
      call.approvalAction = action;
      call.approvalDecidedAt = decidedAt;
      call.approvedBy = decidedBy;
    };
    confirmations = [confirmationEvent(runId, row, request.toolUseId, request.result, request.denyMessage)];
    grant = undefined;
    const lease = request.grant ? deriveLeaseScope(row.call) : undefined;
    if (lease === undefined) {
      stamp(row.call, request.result === "allow" ? ApprovalAction.APPROVE : ApprovalAction.REJECT);
    } else {
      stamp(row.call, ApprovalAction.APPROVE_ALL);
      grant = grantEvent(runId, row, request.toolUseId, lease);
      // Every other call of the class that waits is allowed with it, with
      // a plain APPROVE: one call carries the grant, the person's
      // escalation point.
      for (const other of waitingInClass(current, request.toolUseId, lease, open)) {
        stamp(other.call, ApprovalAction.APPROVE);
        confirmations.push(confirmationEvent(runId, other, toolUseEventId(runId, other.call.id), "allow", ""));
      }
    }
    const own = grant === undefined ? confirmations : [confirmations[0]!, grant, ...confirmations.slice(1)];
    current.status!.pendingApprovals = pendingApprovalsOf(
      runId,
      current.status!,
      openAsksOf(session, runId, own),
      deps.logger,
    );
    return own;
  });
  deps.logger.info("AUDIT: tool use answered", {
    runId,
    org: run.metadata?.org ?? "",
    toolUseId: request.toolUseId,
    result: request.result,
    grant: grant !== undefined,
    answered: confirmations.length,
    decidedBy,
    pendingApprovalsRemaining: run.status?.pendingApprovals.length ?? 0,
  });
  deps.broker.broadcast(run);
  // The events as stored: numbered and stamped.
  const storedById = new Map(events.map((event) => [event.event.value?.id ?? "", event]));
  const asStored = (event: SessionEvent): SessionEvent => storedById.get(event.event.value?.id ?? "") ?? event;
  return {
    run,
    confirmations: confirmations.map(asStored),
    grant: grant === undefined ? undefined : asStored(grant),
  };
}

/**
 * Tells the turn's workflow to resume once the run has no open ask left;
 * with the engine disconnected the answer stands and nothing is signalled.
 */
async function signalWhenResolved(deps: AnswerDeps, run: Run): Promise<void> {
  const runId = run.metadata?.id ?? "";
  /* v8 ignore next 3 -- @preserve: the locked write refuses an answer on a finished run, so a recorded answer's run never is one; kept so a finished run is never reconciled from here */
  if (isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    return;
  }
  if (run.status !== undefined && !gateResolved(run.status)) {
    deps.logger.info("answer recorded; the turn still waits for others", {
      runId,
      pendingApprovalsRemaining: run.status.pendingApprovals.length,
    });
    return;
  }
  const engine = deps.engineState();
  if (!engine.connected) {
    deps.logger.warn("execution engine not connected; the turn is not signalled to resume", { runId });
    return;
  }
  try {
    await engine.engine.signalApprovalGateResolved(runId);
  } catch (error) {
    if (error instanceof EngineWorkflowNotFoundError) {
      deps.logger.warn("workflow not found; reconciling the waiting run to FAILED", { runId });
      await reconcileStaleExecution(deps, run);
      throw failedPreconditionError(
        `workflow not running for execution ${runId} - the backing workflow has terminated unexpectedly and the execution has been marked as failed`,
      );
    }
    throw unavailableError(
      `failed to signal workflow: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  deps.logger.info("the turn's workflow was signalled to resume", { runId });
}

/**
 * Terminalizes an execution stuck in WAITING_FOR_APPROVAL because the
 * backing workflow no longer runs. Best-effort: a failed persist is
 * logged and the caller still surfaces the refusal. pending_approvals is
 * left empty (a FAILED execution has no actionable approvals).
 * Whole-resource save is intentional: this writes a terminal state with no
 * live appender racing the stream.
 */
export async function reconcileStaleExecution(deps: AnswerDeps, execution: Run): Promise<void> {
  const executionId = execution.metadata?.id ?? "";

  const reconciled = create(RunSchema, {
    apiVersion: execution.apiVersion,
    kind: execution.kind,
    metadata: execution.metadata,
    spec: execution.spec,
    status: {
      phase: RunPhase.RUN_FAILED,
      error:
        "Workflow backing this execution is no longer running. Execution has been marked as failed.",
      messages: execution.status?.messages ?? [],
      audit: execution.status?.audit,
      approvalEventStream: execution.status?.approvalEventStream,
    },
  });

  // A system message explaining what happened.
  reconciled.status?.messages.push(
    create(AgentMessageSchema, {
      type: MessageType.MESSAGE_SYSTEM,
      content:
        "The workflow backing this execution is no longer running. This can happen due to infrastructure issues or manual termination. The execution has been marked as failed.",
    }),
  );

  // The gated call that brought the user here, and any other in-flight
  // call, is still non-terminal; this write terminalizes the execution, so
  // settle them (issue #207).
  settleInterruptedToolCalls(reconciled.status, new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));

  try {
    // The whole-resource save stays; the session's events come from the
    // committed row, not the copy this reconcile started from.
    await overwriteRunAppendingEvents(deps, reconciled);
  } catch (error) {
    deps.logger.error(
      "Failed to reconcile stale execution status - execution will remain in WAITING_FOR_APPROVAL until next attempt",
      {
        executionId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return;
  }

  deps.logger.info("RECONCILIATION: Updated stale execution status to FAILED", {
    executionId,
  });

  // A notifying site (run/status-observers.ts): the reconcile's FAILED
  // stamp is a persisted terminal transition.
  await notifyStatusObservers(
    deps,
    reconciled,
    execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
    RunPhase.RUN_FAILED,
  );
}
