/**
 * The one core every answer to a waiting tool use goes through:
 * SessionCommandController.confirmToolUse and grantPermission. Each method
 * authorizes its own way, then appends these steps to its chain:
 *
 *   LoadAskedRun ... the run is the text before the first `.` of the tool
 *                    use id (run ids hold none), and must be one of the
 *                    session's runs; the ask is the run's agent.tool_use
 *                    (or agent.mcp_tool_use) event with that id in the
 *                    session's log, written with evaluated_permission
 *                    `ask`, at the root or in a sub-agent's thread (its
 *                    session_thread_id). Anything else is NOT_FOUND.
 *   AnswerReplay ... an answer already recorded for the tool use (its
 *                    user.tool_confirmation, by its derived id) ends the
 *                    chain: the same answer is success with the stored
 *                    events, another is FAILED_PRECONDITION (an answer is
 *                    final). A replay never reaches the gate slot, the
 *                    write or the signal.
 *   ValidateAnswer . the run waits for approval or is in progress (a fast
 *                    answer can land between the runner's asks and its
 *                    waiting write), and the ask's gate is still open in
 *                    the log: neither answered nor closed by its result.
 *   the gate slot .. `agent-execution-submit-approval:gate`, run once per
 *                    fresh answer whichever method came in. Its steps read
 *                    the answer with `approvalAnswerOf(ctx)`
 *                    (APPROVAL_ANSWER_KEY).
 *   RecordAnswer ... one run write (updateRunAppendingEvents): the
 *                    user.tool_confirmation (and, for a grant, the
 *                    stigmer.permission.grant and a confirmation for every
 *                    other open ask of the run in the class), and whatever
 *                    the session's status becomes. Under the session's
 *                    lock it checks again what ValidateAnswer checked (the
 *                    ask's gate is open, the run waits or works), so an
 *                    answer racing a stop is refused; a concurrent
 *                    identical answer that landed first is answered as the
 *                    replay.
 *   SignalWorkflow . when the run has no open ask left (filereview/gate.ts,
 *                    counted under the write's lock), the turn's workflow
 *                    is told to resume. A workflow that no longer runs
 *                    fails the run (reconcileStaleExecution).
 *
 * The log is the one source of every decision here. What an ask is comes
 * from events that never change once written (the tool use and its
 * stigmer.permission.asked event), so they are read before the lock;
 * whether it is still open is read under it.
 *
 * A deny's message is recorded on the confirmation, which the runner reads
 * at the turn's resume and hands the agent. A grant's class is the ask's
 * lease scope (run/approval/lease-scope.ts), derived from the tool use's
 * name and MCP server and its asked event's policy source and hook; a call
 * with none (or an ask whose asked event the log does not hold) is allowed
 * alone and no grant is written, as an "approve all" always degraded. The
 * other asks a grant allows are read before the write; one opened since
 * that read sends the write back to read again, a bounded number of times,
 * after which an ask the read did not see is left waiting for its own
 * answer.
 *
 * The confirmation's id is `sevt_tc_` and the first 40 hex digits of the
 * sha256 of the tool use id, the grant's `sevt_pg_`, so the log refuses a
 * second of either. Each is written in the tool use's own thread.
 *
 * Proven by __tests__/methods.test.ts, __tests__/log-only-asks.test.ts and
 * the run-approval conformance suite.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunPhase,
  RunPhaseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  SessionEventSchema,
  type SessionEvent,
  type StigmerPermissionAskedEvent,
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
import type { ExecutionEngineStateProvider } from "../../run/engine.js";
import { EngineWorkflowNotFoundError } from "../../run/engine.js";
import { gateResolved } from "../../run/filereview/gate.js";
import { isTerminalExecutionPhase } from "../../run/phases.js";
import { notifyStatusObservers } from "../../run/status-observers.js";
import type { SessionEventBroker } from "../events/broker.js";
import { SESSION_EVENT_ID_PREFIX } from "../events/catalog.js";
import { eventOf } from "../events/codec.js";
import { ASK_PERMISSION } from "../events/gates.js";
import { runIdOfToolUse } from "../events/ids.js";
import {
  openAsksOf,
  overwriteRunAppendingEvents,
  updateRunAppendingEvents,
} from "../events/run-writes.js";
import { sessionIdOfRun } from "../events/transitions.js";

export interface AnswerDeps {
  readonly store: Store;
  readonly logger: Logger;
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
  /**
   * The provider's call id the tool use was named by: the tool use id
   * after its run's (session/events/ids.ts); "" for a call id the runner
   * wrote hashed, which the tool use id does not carry.
   */
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

/** The types a tool use that can ask is written as. */
const TOOL_USE_TYPES = ["agent.tool_use", "agent.mcp_tool_use"];

/** The type that says why a tool use waits. */
const PERMISSION_ASKED_TYPE = "stigmer.permission.asked";

/** One page of a run's asked events; a run asks far fewer times. */
const ASKED_PAGE_SIZE = 1000;

/**
 * How many times a grant reads the run's open asks before it writes: an
 * ask opened between the read and the write sends it back to read again.
 */
const GRANT_ASK_READS = 3;

/** An ask as the session's log states it (module header). */
export interface LoggedAsk {
  readonly toolUseId: string;
  /** "" for the root thread; the sub-agent's thread otherwise (the tool use's session_thread_id). */
  readonly threadId: string;
  /** The class a grant on it would lease; undefined when it has none, or the log holds no asked event for it. */
  readonly lease: LeaseScope | undefined;
}

/** The asked event of each of a run's asks, by tool use id (the first, should one be written twice). */
async function askedEventsOf(
  store: Store,
  sessionId: string,
  runId: string,
): Promise<Map<string, StigmerPermissionAskedEvent>> {
  const asked = new Map<string, StigmerPermissionAskedEvent>();
  let afterSeq: number | undefined;
  for (;;) {
    const page = await store.sessionEvents.list(sessionId, {
      order: "asc",
      runId,
      types: [PERMISSION_ASKED_TYPE],
      limit: ASKED_PAGE_SIZE,
      ...(afterSeq === undefined ? {} : { afterSeq }),
    });
    for (const record of page) {
      const event = eventOf(record);
      if (event.event.case === "stigmerPermissionAsked" && !asked.has(event.event.value.toolUseId)) {
        asked.set(event.event.value.toolUseId, event.event.value);
      }
    }
    if (page.length < ASKED_PAGE_SIZE) {
      return asked;
    }
    afterSeq = page[page.length - 1]!.seq;
  }
}

/**
 * The asks among `toolUseIds` the run wrote in the session's log: tool use
 * events of the run, by id, that asked, each with its asked event's class.
 */
export async function readAsks(
  store: Store,
  sessionId: string,
  runId: string,
  toolUseIds: ReadonlyArray<string>,
): Promise<Map<string, LoggedAsk>> {
  const asks = new Map<string, LoggedAsk>();
  // No id reads no event (the store's rule for an empty eventIds).
  const uses = await store.sessionEvents.list(sessionId, {
    order: "asc",
    eventIds: toolUseIds,
    types: TOOL_USE_TYPES,
    limit: Math.max(1, toolUseIds.length),
  });
  const asked = await askedEventsOf(store, sessionId, runId);
  for (const record of uses) {
    const event = eventOf(record);
    if (record.runId !== runId) {
      continue;
    }
    const use =
      event.event.case === "agentToolUse"
        ? { ...event.event.value, mcpServer: "" }
        : event.event.case === "agentMcpToolUse"
          ? { ...event.event.value, mcpServer: event.event.value.mcpServerName }
          : undefined;
    if (use === undefined || use.evaluatedPermission !== ASK_PERMISSION) {
      continue;
    }
    const why = asked.get(use.id);
    asks.set(use.id, {
      toolUseId: use.id,
      threadId: use.sessionThreadId,
      lease:
        why === undefined
          ? undefined
          : deriveLeaseScope({
              name: use.name,
              mcpServer: use.mcpServer,
              policySource: why.policySource,
              policyHook: why.policyHook,
            }),
    });
  }
  return asks;
}

/**
 * The other asks a grant on `toolUseId` allows: every ask of `asks` whose
 * gate is open (`open`, in log order) and whose lease scope is `lease`
 * (run/approval/lease-scope.ts: a hook's lease never allows a call the
 * default asked for, nor the reverse).
 */
export function waitingInClass(
  asks: ReadonlyMap<string, LoggedAsk>,
  toolUseId: string,
  lease: LeaseScope,
  open: ReadonlySet<string>,
): LoggedAsk[] {
  return [...open].flatMap((otherUseId) => {
    const other = asks.get(otherUseId);
    return otherUseId !== toolUseId &&
      other !== undefined &&
      other.lease !== undefined &&
      sameLeaseScope(other.lease, lease)
      ? [other]
      : [];
  });
}

/** The call id a tool use id carries (AnswerRequest.toolCallId); "" for a hashed one. */
export function callIdOfToolUse(runId: string, toolUseId: string): string {
  const prefix = `${runId}.`;
  if (!toolUseId.startsWith(prefix)) {
    return "";
  }
  const callId = toolUseId.slice(prefix.length);
  return HASHED_CALL_ID.test(callId) ? "" : callId;
}

/** A call id the runner wrote hashed: `h` and 32 hex digits (session/events/ids.ts). */
const HASHED_CALL_ID = /^h[0-9a-f]{32}$/;

function confirmationEvent(
  runId: string,
  ask: LoggedAsk,
  result: AnswerResult,
  denyMessage: string,
): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    threadId: ask.threadId,
    event: {
      case: "userToolConfirmation",
      value: {
        id: toolConfirmationEventId(ask.toolUseId),
        result,
        toolUseId: ask.toolUseId,
        denyMessage: result === "deny" ? denyMessage : "",
        sessionThreadId: ask.threadId,
      },
    },
  });
}

function grantEvent(runId: string, ask: LoggedAsk, lease: LeaseScope): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    threadId: ask.threadId,
    event: {
      case: "stigmerPermissionGrant",
      value: {
        id: permissionGrantEventId(ask.toolUseId),
        toolUseId: ask.toolUseId,
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

/** An ask of the run opened since a grant read the run's asks: the grant reads again. */
class AsksMovedError extends Error {
  constructor() {
    super("an ask opened since the run's asks were read");
    this.name = "AsksMovedError";
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
  ask: LoggedAsk,
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
  const sameGrant = request.grant ? grant !== undefined || ask.lease === undefined : grant === undefined;
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
  const ASK_KEY = "approvalAnswerAsk";
  const requestIn = (ctx: RequestContext<Desc>): AnswerRequest => ctx.get(REQUEST_KEY) as AnswerRequest;
  const runIn = (ctx: RequestContext<Desc>): Run => ctx.get(RUN_KEY) as Run;
  const askIn = (ctx: RequestContext<Desc>): LoggedAsk => ctx.get(ASK_KEY) as LoggedAsk;
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
        if (sessionIdOfRun(run) !== request.sessionId) {
          throw missing();
        }
        let ask: LoggedAsk | undefined;
        try {
          ask = (await readAsks(deps.store, request.sessionId, runId, [request.toolUseId])).get(request.toolUseId);
        } catch (error) {
          throw internalError(error, "failed to read the tool use's ask");
        }
        if (ask === undefined) {
          throw missing();
        }
        ctx.set(RUN_KEY, run);
        ctx.set(ASK_KEY, ask);
      },
    },
    {
      name: "AnswerReplay",
      async execute(ctx) {
        const outcome = await recordedAnswer(deps, runIn(ctx), requestIn(ctx), askIn(ctx));
        if (outcome !== undefined) {
          ctx.set(OUTCOME_KEY, outcome);
        }
      },
    },
    {
      name: "ValidateAnswer",
      async execute(ctx) {
        if (replayed(ctx)) {
          return;
        }
        const run = runIn(ctx);
        const request = requestIn(ctx);
        const runId = run.metadata?.id ?? "";
        const phase = run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
        if (phase !== RunPhase.RUN_WAITING_FOR_APPROVAL && phase !== RunPhase.RUN_IN_PROGRESS) {
          throw failedPreconditionError(
            `tool use ${request.toolUseId} no longer waits: its turn is ${phaseName(phase)}`,
          );
        }
        let open: boolean;
        try {
          open = (await deps.store.sessionEvents.openGates(request.sessionId, runId)).some(
            (gate) => gate.toolUseId === request.toolUseId,
          );
        } catch (error) {
          throw internalError(error, "failed to read the tool use's ask");
        }
        if (!open) {
          throw failedPreconditionError(`tool use ${request.toolUseId} no longer waits`);
        }
        const answer: ApprovalAnswer = {
          run,
          toolUseId: request.toolUseId,
          toolCallId: callIdOfToolUse(runId, request.toolUseId),
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
          const recorded = await recordAnswer(deps, runIn(ctx), request, askIn(ctx), ctx.callerIdentity.identityId);
          ctx.set(OUTCOME_KEY, recorded.outcome);
          ctx.set(SIGNAL_KEY, recorded.openAsks);
        } catch (error) {
          if (error instanceof AskClosedError) {
            // A concurrent identical answer that landed first is this
            // one's replay; anything else closed the ask.
            const outcome = await recordedAnswer(deps, runIn(ctx), request, askIn(ctx));
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
      },
    },
    {
      name: "SignalWorkflow",
      async execute(ctx) {
        const openAsks = ctx.get(SIGNAL_KEY) as number | undefined;
        if (openAsks === undefined) {
          return;
        }
        await signalWhenResolved(deps, answerOutcomeOf(ctx).run, openAsks);
      },
    },
  ];
}

/** The run's open asks after a fresh answer's write; unset for a replay, which signals nothing. */
const SIGNAL_KEY = "approvalAnswerOpenAsks";

/** A fresh answer as written, with the run's asks still open after it. */
interface RecordedAnswer {
  readonly outcome: AnswerOutcome;
  readonly openAsks: number;
}

/**
 * The locked write of a fresh answer (module header, RecordAnswer). A
 * grant with a class first reads the run's open asks from the log; the
 * write goes back to read them again when one opened since, up to
 * GRANT_ASK_READS reads.
 */
async function recordAnswer(
  deps: AnswerDeps,
  loaded: Run,
  request: AnswerRequest,
  ask: LoggedAsk,
  decidedBy: string,
): Promise<RecordedAnswer> {
  const runId = loaded.metadata?.id ?? "";
  for (let read = 1; ; read++) {
    const others =
      request.grant && ask.lease !== undefined
        ? await readAsks(
            deps.store,
            request.sessionId,
            runId,
            (await deps.store.sessionEvents.openGates(request.sessionId, runId)).map((gate) => gate.toolUseId),
          )
        : new Map<string, LoggedAsk>();
    try {
      return await writeAnswer(deps, runId, request, ask, others, decidedBy, read === GRANT_ASK_READS);
    } catch (error) {
      if (error instanceof AsksMovedError && read < GRANT_ASK_READS) {
        continue;
      }
      throw error;
    }
  }
}

/**
 * One locked write of a fresh answer. `others` are the run's asks a grant
 * may allow; an open ask of the run they do not hold throws AsksMovedError
 * unless `final`, when it is left waiting.
 */
async function writeAnswer(
  deps: AnswerDeps,
  runId: string,
  request: AnswerRequest,
  ask: LoggedAsk,
  others: ReadonlyMap<string, LoggedAsk>,
  decidedBy: string,
  final: boolean,
): Promise<RecordedAnswer> {
  let confirmations: SessionEvent[] = [];
  let grant: SessionEvent | undefined;
  let openAsks = 0;
  const { run, events } = await updateRunAppendingEvents(deps, runId, (current, session) => {
    const open = openAsksOf(session, runId);
    const phase = current.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
    // Everything ValidateAnswer checked, again under the lock: a stop or
    // another answer may have landed since.
    if (
      !open.has(request.toolUseId) ||
      (phase !== RunPhase.RUN_WAITING_FOR_APPROVAL && phase !== RunPhase.RUN_IN_PROGRESS)
    ) {
      throw new AskClosedError(request.toolUseId);
    }
    confirmations = [confirmationEvent(runId, ask, request.result, request.denyMessage)];
    grant = undefined;
    const lease = request.grant ? ask.lease : undefined;
    if (lease !== undefined) {
      if (!final && [...open].some((id) => id !== request.toolUseId && !others.has(id))) {
        throw new AsksMovedError();
      }
      grant = grantEvent(runId, ask, lease);
      // Every other open ask of the class is allowed with it: one call
      // carries the grant, the person's escalation point.
      for (const other of waitingInClass(others, request.toolUseId, lease, open)) {
        confirmations.push(confirmationEvent(runId, other, "allow", ""));
      }
    }
    const own = grant === undefined ? confirmations : [confirmations[0]!, grant, ...confirmations.slice(1)];
    openAsks = openAsksOf(session, runId, own).size;
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
    openAsksRemaining: openAsks,
  });
  // The events as stored: numbered and stamped.
  const storedById = new Map(events.map((event) => [event.event.value?.id ?? "", event]));
  const asStored = (event: SessionEvent): SessionEvent => storedById.get(event.event.value?.id ?? "") ?? event;
  return {
    outcome: {
      run,
      confirmations: confirmations.map(asStored),
      grant: grant === undefined ? undefined : asStored(grant),
    },
    openAsks,
  };
}

/**
 * Tells the turn's workflow to resume once the run has no open ask left
 * (`openAsks`, counted under the answer's lock); with the engine
 * disconnected the answer stands and nothing is signalled.
 */
async function signalWhenResolved(deps: AnswerDeps, run: Run, openAsks: number): Promise<void> {
  const runId = run.metadata?.id ?? "";
  /* v8 ignore next 3 -- @preserve: the locked write refuses an answer on a finished run, so a recorded answer's run never is one; kept so a finished run is never reconciled from here */
  if (isTerminalExecutionPhase(run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED)) {
    return;
  }
  if (!gateResolved(openAsks)) {
    deps.logger.info("answer recorded; the turn still waits for others", {
      runId,
      openAsksRemaining: openAsks,
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
 * logged and the caller still surfaces the refusal. The FAILED phase and
 * its error are the explanation: a tool call the turn never finished is
 * read as stopped from the turn's end in the session's log. The run's
 * file record is kept, so an undo of its files can still be put back.
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
      audit: execution.status?.audit,
      fileChanges: execution.status?.fileChanges ?? [],
    },
  });

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
