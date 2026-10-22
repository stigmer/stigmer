/**
 * The turn a session's queue starts: when a session's working turn ends
 * with messages still queued (send-message.ts), the next turn starts with
 * all of them, in the order sent.
 *
 * It is one run create, the full chain, AS THE NEWEST SENDER (the
 * in-process asCaller lane, as the reconcile turn an undo starts acts as
 * its decider, ../session/filereview/stopped-turn.ts), so every check a
 * turn meets meets it again: a gate may have changed since the messages
 * were accepted. The turn is the newest message's (its settings, labels
 * and name), with the texts joined as a Managed Agents message's blocks
 * join, the files of every message together, and
 * `spec.queued_message_ids` naming the messages, which its creation moves
 * to the head of the log as its own (../session/events/run-writes.ts).
 *
 * Idempotent, so every place a turn can end calls it, and a repeat or a
 * race starts nothing twice:
 *
 *   - the run's workflow, from its end, as a retried activity
 *     (temporal/agentexecution, StartQueuedTurn): the durable start
 *   - a status observer on every turn that ends (`newQueuedTurnObserver`):
 *     the prompt start, and the start for a turn that ends outside its
 *     workflow (a failed workflow start, the stale reconcile of a turn
 *     whose workflow is gone)
 *   - sendMessage itself, when its message was queued with nothing working
 *
 * Nothing queued, or a turn of the session still unfinished: nothing
 * starts. A start refused because another write got there first (a turn
 * started, or a stop dropped the messages) is no start. A start refused by
 * a check (the agent was removed, a gate, the sender gone) drops the
 * messages it would have read, which stay listed, never accepted, and the
 * session records why as a session.error and goes idle. A fault (the
 * server unavailable, an internal error) is thrown, for the workflow's
 * activity to retry.
 *
 * Proven by __tests__/queued-turn.test.ts and the session-queue
 * conformance suite.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { RunStatusObserver } from "../../extensions/status-hooks.js";
import { errorReasonOf } from "../../pipeline/errors.js";
import { MESSAGE_TEXT_SEPARATOR, dropQueuedMessages, queuedTurnOf } from "../session/events/queue.js";
import type { SessionQueueDeps } from "../session/events/queue.js";
import { sessionIdOfRun } from "../session/events/transitions.js";
import { QUEUED_MESSAGE_GONE_REASON, SESSION_TURN_UNFINISHED_REASON } from "./constants.js";
import { isTerminalExecutionPhase } from "./phases.js";

/** The run create the queue's turn rides, as a person (the in-process asCaller lane). */
export interface QueuedTurnCreator {
  create(run: Run, caller: CallerIdentity): Promise<Run>;
}

export interface QueuedTurnDeps extends SessionQueueDeps {
  readonly logger: Logger;
  /** The in-process run create, resolved at call time. */
  readonly creator: () => QueuedTurnCreator;
  /** The caller a sender's identity id stands for; undefined when it names nobody this server knows. */
  readonly callerOf: (senderId: string) => Promise<CallerIdentity | undefined>;
}

/** The queue's start of a session's next turn, as every caller holds it. */
export type QueuedTurnStarter = (sessionId: string) => Promise<Run | undefined>;

/**
 * The codes a check answers when it refuses a turn: the request was heard
 * and said no. Any other (unavailable, internal, a deadline) is a fault
 * the start is retried for.
 */
const REFUSAL_CODES: ReadonlySet<Code> = new Set([
  Code.InvalidArgument,
  Code.NotFound,
  Code.AlreadyExists,
  Code.PermissionDenied,
  Code.Unauthenticated,
  Code.FailedPrecondition,
  Code.ResourceExhausted,
  Code.OutOfRange,
]);

/** The error type a session.error carries for messages a refused start dropped. */
const REFUSED_START_ERROR_TYPE = "unknown_error";

/** Starts the session's next turn from its queue (module header); answers the run it started. */
export async function startQueuedTurn(deps: QueuedTurnDeps, sessionId: string): Promise<Run | undefined> {
  const queued = await deps.store.sessionEvents.queued(sessionId);
  const newest = queued.at(-1);
  if (newest === undefined) {
    return undefined;
  }
  const eventIds = queued.map((message) => message.record.eventId);
  const turns = queued.map(queuedTurnOf);
  const org = turns.at(-1)?.metadata?.org ?? "";
  const caller = await deps.callerOf(newest.sender);
  if (caller === undefined) {
    await dropQueuedMessages(deps, sessionId, org, {
      eventIds,
      reason: {
        type: REFUSED_START_ERROR_TYPE,
        message: "the queued messages were not read: their sender is no longer known to this server",
      },
    });
    deps.logger.warn("a session's queued messages name a sender nobody stands for; they were dropped", {
      sessionId,
      messages: eventIds.length,
    });
    return undefined;
  }
  try {
    const run = await deps.creator().create(queuedTurn(turns, eventIds), caller);
    deps.logger.info("Started the turn a session's queued messages wait for", {
      sessionId,
      executionId: run.metadata?.id ?? "",
      messages: eventIds.length,
    });
    return run;
  } catch (error) {
    if (!(error instanceof ConnectError) || !REFUSAL_CODES.has(error.code)) {
      throw error;
    }
    const reason = errorReasonOf(error);
    if (reason === SESSION_TURN_UNFINISHED_REASON || reason === QUEUED_MESSAGE_GONE_REASON) {
      deps.logger.info("the queue's turn did not start: another write got there first", {
        sessionId,
        reason,
      });
      return undefined;
    }
    await dropQueuedMessages(deps, sessionId, org, {
      eventIds,
      reason: { type: REFUSED_START_ERROR_TYPE, message: `the queued messages were not read: ${error.rawMessage}` },
    });
    deps.logger.warn("the queue's turn was refused; its messages were dropped", {
      sessionId,
      messages: eventIds.length,
      error: error.rawMessage,
    });
    return undefined;
  }
}

/**
 * The turn for queued messages, in the order sent (module header): the
 * newest turn, its text the texts joined, its files every message's,
 * naming the messages it takes.
 */
export function queuedTurn(turns: ReadonlyArray<Run>, eventIds: ReadonlyArray<string>): Run {
  const newest = turns.at(-1);
  const turn = newest === undefined ? create(RunSchema) : clone(RunSchema, newest);
  turn.status = undefined;
  const spec = (turn.spec ??= create(RunSpecSchema));
  spec.message = turns
    .map((each) => each.spec?.message ?? "")
    .filter((text) => text !== "")
    .join(MESSAGE_TEXT_SEPARATOR);
  spec.fileIds = [...new Set(turns.flatMap((each) => each.spec?.fileIds ?? []))];
  spec.queuedMessageIds = [...eventIds];
  return turn;
}

/**
 * The status observer that starts a session's queued turn when one of its
 * turns ends, at every phase write that ends one (run/status-observers.ts).
 * A failure is logged, never thrown: the workflow's activity is the
 * durable start.
 */
export function newQueuedTurnObserver(deps: QueuedTurnDeps): RunStatusObserver {
  return async ({ run, newPhase }) => {
    if (!isTerminalExecutionPhase(newPhase)) {
      return;
    }
    const sessionId = sessionIdOfRun(run);
    if (sessionId === "") {
      return;
    }
    try {
      await startQueuedTurn(deps, sessionId);
    } catch (error) {
      deps.logger.warn("the queue's turn could not be started yet; the workflow's end starts it", {
        sessionId,
        executionId: run.metadata?.id ?? "",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
