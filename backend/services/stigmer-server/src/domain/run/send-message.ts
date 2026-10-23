/**
 * RunCommandController.sendMessage: a person sends a message to a session.
 * The turn starts now, or the message waits for the turn that works
 * (stigmer#2429): one turn of a session at a time, never a second racing
 * the first.
 *
 *   Admit ........... the create chain's admission (controller.ts
 *                     `runAdmissionSteps`), as the sender: every check a
 *                     turn meets, the gate slot's included, and the
 *                     message's files made the conversation's own. A
 *                     message that cannot start a turn cannot wait for one
 *                     either.
 *   Decide .......... what the session is doing, under its lock
 *                     (../session/events/queue.ts): a turn waiting for an
 *                     answer or paused refuses the message
 *                     (FAILED_PRECONDITION, SESSION_TURN_WAITS_FOR_ANSWER
 *                     or SESSION_TURN_PAUSED: Managed Agents accepts only
 *                     the answer then); nothing holding it and nothing
 *                     queued starts the turn; a turn working, or messages
 *                     already waiting, queue it.
 *   Start ........... the create chain's start (`runStartSteps`) on the
 *                     admitted turn; the reply is the turn's user.message
 *                     and the run. Persist refuses the turn when another
 *                     started since the decision (run-writes.ts), and the
 *                     message is queued instead.
 *   Queue ........... the message's user.message, with no run and no
 *                     accepted time, and the turn it would start, kept
 *                     with the files it was admitted with and the person
 *                     that turn records (its authority, queue.ts). The
 *                     reply is that user.message. When nothing was working
 *                     as it was queued (the turn that held the session
 *                     ended in between, or a queue nothing started), the
 *                     queue's turn is started at once (queued-turn.ts),
 *                     and the reply names it when it reads this message.
 *
 * A message the queue holds is read by the working turn, or starts the
 * next turn once it ends (queued-turn.ts); a stop drops it. A failure
 * before anything was stored takes back the message's files, as create's
 * does.
 *
 * Proven by __tests__/send-message.test.ts and the session-queue
 * conformance suite.
 */
import { clone, create } from "@bufbuild/protobuf";
import { ConnectError } from "@connectrpc/connect";

import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  SendMessageResponseSchema,
  type SendMessageResponse,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { QueuedSenderLane } from "../../extensions/queued-sender-lane.js";
import { errorReasonOf, failedPreconditionError, internalError } from "../../pipeline/errors.js";
import { RequestContext } from "../../pipeline/request-context.js";
import type { Store } from "../../store/interface.js";
import type { SessionEventBroker } from "../session/events/broker.js";
import { eventOf } from "../session/events/codec.js";
import { enqueueMessage, readQueueState } from "../session/events/queue.js";
import type { HeldQueueState } from "../session/events/queue.js";
import {
  SEND_MESSAGE_NEEDS_SESSION_MESSAGE,
  SESSION_TURN_PAUSED_REASON,
  SESSION_TURN_UNFINISHED_REASON,
  SESSION_TURN_WAITS_FOR_ANSWER_REASON,
  sessionTurnPausedMessage,
  sessionTurnWaitsForAnswerMessage,
} from "./constants.js";
import { runPersonOfRequest } from "./plan-run-values-step.js";
import { MAX_TURN_QUEUED_MESSAGES } from "./queued-turn.js";
import type { QueuedTurnStarter } from "./queued-turn.js";

/** The turn's opening event type, read back for the reply. */
const USER_MESSAGE_TYPE = "user.message";

/**
 * The run create chain, in the two halves a message runs
 * (controller.ts `runTurnChain`), over one request context.
 */
export interface TurnChain {
  /** Every check a turn meets, and its files made the conversation's (`runAdmissionSteps`). */
  admit(reqCtx: RequestContext<typeof RunSchema>): Promise<void>;
  /** The admitted turn's start: its row, its events and its workflow (`runStartSteps`). */
  start(reqCtx: RequestContext<typeof RunSchema>): Promise<void>;
  /** Takes back the files the admission made the conversation's, unless the turn was stored. */
  undo(reqCtx: RequestContext<typeof RunSchema>): Promise<void>;
}

export interface SendMessageDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly sessionEventBroker: SessionEventBroker;
  /** The create chain, for this message. */
  readonly chain: TurnChain;
  /** Starts the queue's turn when a message was queued with nothing working (queued-turn.ts). */
  readonly queuedTurns: QueuedTurnStarter;
  /** Keeps the lane a queued message was sent through (extensions/queued-sender-lane.ts); absent, none. */
  readonly queuedSenderLane?: QueuedSenderLane;
}

export async function sendMessage(
  deps: SendMessageDeps,
  turn: Run,
  identity: CallerIdentity,
): Promise<SendMessageResponse> {
  const sessionId = turn.spec?.target.case === "sessionId" ? turn.spec.target.value : "";
  if (sessionId === "") {
    throw failedPreconditionError(SEND_MESSAGE_NEEDS_SESSION_MESSAGE);
  }
  const reqCtx = new RequestContext(RunSchema, turn, identity, ApiResourceKind.run);
  let queued = false;
  try {
    await deps.chain.admit(reqCtx);

    const state = await readQueueState(deps.store, sessionId);
    if (state.kind === "waiting" || state.kind === "paused") {
      throw heldRefusal(sessionId, state);
    }
    if (state.kind === "free") {
      const started = await startNow(deps, reqCtx, sessionId);
      if (started !== undefined) {
        return started;
      }
    }

    const outcome = await enqueueMessage(deps, {
      sessionId,
      org: reqCtx.newState.metadata?.org ?? "",
      sender: identity.identityId,
      turn: queuedTurnOf(turn, reqCtx.newState, runPersonOfRequest(reqCtx)),
      lane: deps.queuedSenderLane?.encode(identity),
    });
    if ("refused" in outcome) {
      throw heldRefusal(sessionId, outcome.refused);
    }
    queued = true;
    deps.logger.info("A message was queued for the session's turn", {
      sessionId,
      eventId: eventIdOf(outcome.queued),
      idle: outcome.idle,
    });
    if (!outcome.idle) {
      return create(SendMessageResponseSchema, { message: outcome.queued });
    }
    // Nothing worked as the message was queued (the turn that held the
    // session ended in between, or a queue nothing started): the queue's
    // turn starts now, and the reply names it when it reads this message.
    const run = await deps.queuedTurns(sessionId);
    const queuedId = eventIdOf(outcome.queued);
    const reads = run !== undefined && (run.spec?.queuedMessageIds ?? []).includes(queuedId);
    const read = reads ? await takenMessage(deps, sessionId, run, queuedId) : undefined;
    return create(SendMessageResponseSchema, {
      message: read ?? outcome.queued,
      ...(reads ? { run } : {}),
    });
  } catch (error) {
    if (!queued) {
      await deps.chain.undo(reqCtx);
    }
    throw error;
  }
}

/**
 * Starts the admitted turn now; undefined when Persist found the session
 * held by a turn started since the decision, so the message is queued.
 */
async function startNow(
  deps: SendMessageDeps,
  reqCtx: RequestContext<typeof RunSchema>,
  sessionId: string,
): Promise<SendMessageResponse | undefined> {
  try {
    await deps.chain.start(reqCtx);
  } catch (error) {
    if (error instanceof ConnectError && errorReasonOf(error) === SESSION_TURN_UNFINISHED_REASON) {
      return undefined;
    }
    throw error;
  }
  const run = reqCtx.newState;
  const message = await turnMessage(deps, sessionId, run);
  if (message === undefined) {
    throw internalError(new Error("the started turn's user.message is not in the log"), "failed to read the turn's message");
  }
  return create(SendMessageResponseSchema, { message, run });
}

/** The user.message a turn was created with, or the first it took; undefined when the log holds none. */
async function turnMessage(deps: SendMessageDeps, sessionId: string, run: Run): Promise<SessionEvent | undefined> {
  const [record] = await deps.store.sessionEvents.list(sessionId, {
    order: "asc",
    runId: run.metadata?.id ?? "",
    types: [USER_MESSAGE_TYPE],
    limit: 1,
  });
  return record === undefined ? undefined : eventOf(record);
}

/** The message a turn took from the queue, as its own; undefined when the log holds none. */
async function takenMessage(
  deps: SendMessageDeps,
  sessionId: string,
  run: Run,
  eventId: string,
): Promise<SessionEvent | undefined> {
  const records = await deps.store.sessionEvents.list(sessionId, {
    order: "asc",
    runId: run.metadata?.id ?? "",
    types: [USER_MESSAGE_TYPE],
    limit: MAX_TURN_QUEUED_MESSAGES + 1,
  });
  const record = records.find((each) => each.eventId === eventId);
  return record === undefined ? undefined : eventOf(record);
}

/** The refusal of a message while a turn of the session waits for an answer or is paused. */
function heldRefusal(sessionId: string, state: HeldQueueState): ConnectError {
  const metadata = { session_id: sessionId, run_id: state.runId };
  return state.kind === "waiting"
    ? failedPreconditionError(sessionTurnWaitsForAnswerMessage(sessionId, state.runId), {
        reason: SESSION_TURN_WAITS_FOR_ANSWER_REASON,
        metadata,
      })
    : failedPreconditionError(sessionTurnPausedMessage(sessionId, state.runId), {
        reason: SESSION_TURN_PAUSED_REASON,
        metadata,
      });
}

/**
 * Admits a turn and starts it at once: run create's whole chain over one
 * request context. A failure takes back the files an unstored turn's
 * admission made the conversation's.
 */
export async function createTurn(chain: TurnChain, reqCtx: RequestContext<typeof RunSchema>): Promise<Run> {
  try {
    await chain.admit(reqCtx);
    await chain.start(reqCtx);
  } catch (error) {
    await chain.undo(reqCtx);
    throw error;
  }
  return reqCtx.newState;
}

/**
 * The turn a queued message would start: the request as sent, in its
 * session, naming the conversation's own copies of its files, with the
 * blocks its message carries them as (status.message_files, read only to
 * write the queued user.message), and the person its turn records
 * (status.credentials: the message's authority, queue.ts).
 */
function queuedTurnOf(request: Run, admitted: Run, person: string | undefined): Run {
  const turn = clone(RunSchema, request);
  const spec = (turn.spec ??= create(RunSpecSchema));
  spec.fileIds = [...(admitted.spec?.fileIds ?? [])];
  if (turn.metadata !== undefined && turn.metadata.org === "") {
    turn.metadata.org = admitted.metadata?.org ?? "";
  }
  turn.status = create(RunStatusSchema, {
    messageFiles: admitted.status?.messageFiles ?? [],
    credentials: person === undefined ? {} : { person },
  });
  return turn;
}

function eventIdOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}
