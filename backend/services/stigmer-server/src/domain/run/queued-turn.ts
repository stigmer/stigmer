/**
 * The turn a session's queue starts: when a session's working turn ends
 * with messages still queued (send-message.ts), the next turn starts with
 * the oldest of them, in the order sent.
 *
 * A turn takes the oldest message and every one after it sent with the
 * same authority (the sender and the person its turn records,
 * ../session/events/queue.ts), as many as one turn holds: its files
 * together within a turn's {@link MAX_TURN_FILES}, at most
 * {@link MAX_TURN_QUEUED_MESSAGES} messages. A message sent with another
 * authority waits for the turn after, so no message runs on another
 * person's logins or approvals.
 *
 * It is one run create, the full chain, AS THEIR SENDER (the in-process
 * asCaller lane, as the reconcile turn an undo starts acts as its
 * decider, ../session/filereview/stopped-turn.ts), recording the person
 * the messages recorded as they were sent (create-steps.ts
 * GuardQueuedMessages), so every check a turn meets meets it again: a gate
 * may have changed since the messages were accepted. The turn is the
 * newest message's (its settings, labels and name), with the texts joined
 * as a Managed Agents message's blocks join, the files of every message
 * together, and `spec.queued_message_ids` naming the messages, which its
 * creation moves to the head of the log as its own
 * (../session/events/run-writes.ts).
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
 * session records why as a session.error; the messages behind them start
 * their own turn, and with none the session goes idle. A fault (the
 * server unavailable, an internal error) is thrown, for the workflow's
 * activity to retry; a queue a fault leaves is started by the next message
 * sent (send-message.ts).
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
import type { QueuedSessionMessage } from "../../store/session-events.js";
import {
  MESSAGE_TEXT_SEPARATOR,
  authorityOfQueued,
  dropQueuedMessages,
  queuedTurnOf,
  sameAuthority,
} from "../session/events/queue.js";
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

/** The most files one turn names (RunSpec.file_ids, `max_items`). */
export const MAX_TURN_FILES = 20;

/** The most queued messages one turn takes (RunSpec.queued_message_ids, `max_items`). */
export const MAX_TURN_QUEUED_MESSAGES = 1000;

/** How one start from the queue ended. */
type QueuedStart =
  | { readonly kind: "started"; readonly run: Run }
  /** Another write got there first: a turn started, or the messages went. */
  | { readonly kind: "raced" }
  /** A check refused the turn, and its messages were dropped. */
  | { readonly kind: "dropped" };

/** Starts the session's next turn from its queue (module header); answers the run it started. */
export async function startQueuedTurn(deps: QueuedTurnDeps, sessionId: string): Promise<Run | undefined> {
  // Each pass drops at least one message or ends, so the loop ends with
  // the queue: a refused turn's messages go, and those behind them start.
  for (;;) {
    const messages = nextTurnMessages(await deps.store.sessionEvents.queued(sessionId));
    if (messages.length === 0) {
      return undefined;
    }
    const outcome = await startTurnOf(deps, sessionId, messages);
    if (outcome.kind === "started") {
      return outcome.run;
    }
    if (outcome.kind === "raced") {
      return undefined;
    }
  }
}

/**
 * The messages the queue's next turn takes (module header): the oldest,
 * and those after it sent with its authority, while the turn holds them.
 */
export function nextTurnMessages(queued: ReadonlyArray<QueuedSessionMessage>): QueuedSessionMessage[] {
  const oldest = queued[0];
  if (oldest === undefined) {
    return [];
  }
  const authority = authorityOfQueued(oldest);
  const taken: QueuedSessionMessage[] = [];
  const files = new Set<string>();
  for (const message of queued) {
    if (!sameAuthority(authorityOfQueued(message), authority) || taken.length === MAX_TURN_QUEUED_MESSAGES) {
      break;
    }
    const own = queuedTurnOf(message).spec?.fileIds ?? [];
    const together = new Set([...files, ...own]);
    if (taken.length > 0 && together.size > MAX_TURN_FILES) {
      break;
    }
    taken.push(message);
    own.forEach((fileId) => files.add(fileId));
  }
  return taken;
}

/** One start: the turn for `messages`, as their sender; what a refusal does is the module header's. */
async function startTurnOf(
  deps: QueuedTurnDeps,
  sessionId: string,
  messages: ReadonlyArray<QueuedSessionMessage>,
): Promise<QueuedStart> {
  const eventIds = messages.map((message) => message.record.eventId);
  const turns = messages.map(queuedTurnOf);
  const org = turns.at(-1)?.metadata?.org ?? "";
  const drop = async (message: string): Promise<QueuedStart> => {
    const dropped = await dropQueuedMessages(deps, sessionId, org, {
      eventIds,
      reason: { type: REFUSED_START_ERROR_TYPE, message },
    });
    return dropped.length === 0 ? { kind: "raced" } : { kind: "dropped" };
  };
  const caller = await deps.callerOf(messages[0]!.sender);
  if (caller === undefined) {
    deps.logger.warn("a session's queued messages name a sender nobody stands for; they were dropped", {
      sessionId,
      messages: eventIds.length,
    });
    return drop("the queued messages were not read: their sender is no longer known to this server");
  }
  try {
    const run = await deps.creator().create(queuedTurn(turns, eventIds), caller);
    deps.logger.info("Started the turn a session's queued messages wait for", {
      sessionId,
      executionId: run.metadata?.id ?? "",
      messages: eventIds.length,
    });
    return { kind: "started", run };
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
      return { kind: "raced" };
    }
    deps.logger.warn("the queue's turn was refused; its messages were dropped", {
      sessionId,
      messages: eventIds.length,
      error: error.rawMessage,
    });
    return drop(`the queued messages were not read: ${error.rawMessage}`);
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
