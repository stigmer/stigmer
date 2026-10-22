/**
 * A session's queue: the messages sent while a turn of the session works,
 * waiting in its log until a turn reads them (store/session-events.ts,
 * "The queue"; run/send-message.ts sends, run/queued-turn.ts starts the
 * turn that reads the ones left when a turn ends).
 *
 * A queued message is a `user.message` with no run and no accepted time,
 * stored at once so every reader of the log sees it, and a side row with
 * who sent it and the turn it would start (a Run, encoded). Every write
 * here runs under the session's lock, over the run list index's working,
 * waiting and paused keys (run/list-index.ts), so what it decides from is
 * what it commits against:
 *
 *   enqueue ...... unless a turn waits for an answer or is paused
 *                  (Managed Agents accepts only an answer then: a 400),
 *                  when it answers what holds the session and queues
 *                  nothing; it says whether a turn was working, for a
 *                  queue with nothing working is its sender's to start
 *                  (run/send-message.ts): whatever left it so (a start
 *                  that failed, a race), the next message starts it
 *   drop ......... the messages still waiting lose their side rows and stay
 *                  listed, never accepted: a stop (interrupt, terminate)
 *                  and a turn from the queue that could not start
 *
 * A queue write also states the session's status when it changes it
 * (transitions.ts `sessionEventsForQueue`): a drop that empties the queue
 * of a session nothing else holds ends its turn, as end_turn, with the
 * reason first when one is given (a session.error).
 *
 * A message keeps whose authority it was sent with ({@link TurnAuthority}):
 * its sender, and the person its turn records (RunStatus.credentials,
 * run/plan-run-values-step.ts), decided as it was admitted. A turn reads
 * only the messages sent with its own authority, and a turn the queue
 * starts takes only messages that share one, so a participant's message
 * never runs on the owner's logins or with approvals the owner waived.
 *
 * Proven by __tests__/queue.test.ts on both drivers, and end to end by the
 * session-queue conformance suite.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { generateId } from "../../../pipeline/steps/defaults.js";
import type { Store } from "../../../store/interface.js";
import type {
  QueuedSessionMessage,
  SessionQueueContext,
  SessionQueueScope,
} from "../../../store/session-events.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import type { SessionEventBroker } from "./broker.js";
import { SESSION_EVENT_ID_PREFIX, SESSION_STATUS_TYPES } from "./catalog.js";
import { draftOf, eventOf } from "./codec.js";
import { messageContent, sessionEventsForQueue, sessionStatusOf } from "./transitions.js";

/**
 * How the texts of one message's blocks, and of the messages one turn
 * reads, join into the turn's message: as Managed Agents text blocks
 * join (transport/managed-agents/send.ts).
 */
export const MESSAGE_TEXT_SEPARATOR = "\n\n";

/** What a queue write needs. */
export interface SessionQueueDeps {
  readonly store: Store;
  readonly sessionEventBroker: SessionEventBroker;
}

type RunListKey = keyof typeof agentExecutionListIndex.keys;

/** The run keys a queue write counts the session's turns by. */
export const SESSION_QUEUE_SCOPE: SessionQueueScope = {
  kind: ApiResourceKind.run,
  workingKey: "working_session" satisfies RunListKey,
  waitingKey: "waiting_session" satisfies RunListKey,
  pausedKey: "paused_session" satisfies RunListKey,
  stateEventTypes: SESSION_STATUS_TYPES,
};

/** What the session is doing, as a queue write reads it under the lock. */
export type SessionQueueState =
  /** A turn waits for an answer: the run, the first such. */
  | { readonly kind: "waiting"; readonly runId: string }
  /** A turn is paused: the run, the first such. */
  | { readonly kind: "paused"; readonly runId: string }
  /** A turn works. */
  | { readonly kind: "busy" }
  /** Nothing works, and messages wait: the queue's turn is to start. */
  | { readonly kind: "queued" }
  /** Nothing holds the session: a turn may start now. */
  | { readonly kind: "free" };

/** The session's state for a message (module header): a turn held first, then one working, then the queue. */
export function queueStateOf(session: SessionQueueContext): SessionQueueState {
  const waiting = session.waiting[0];
  if (waiting !== undefined) {
    return { kind: "waiting", runId: waiting };
  }
  const paused = session.paused[0];
  if (paused !== undefined) {
    return { kind: "paused", runId: paused };
  }
  if (session.working.length > 0) {
    return { kind: "busy" };
  }
  return session.queued.length > 0 ? { kind: "queued" } : { kind: "free" };
}

/** A message to queue: who sends it and the turn it would start, as the run create chain admitted it. */
export interface MessageToQueue {
  readonly sessionId: string;
  readonly org: string;
  readonly sender: string;
  readonly turn: Run;
}

/** A state that holds the session: a turn waiting for an answer, or paused. */
export type HeldQueueState = Extract<SessionQueueState, { kind: "waiting" | "paused" }>;

/**
 * What an enqueue did: the queued `user.message` and whether nothing was
 * working as it was queued, or what kept it out.
 */
export type EnqueueOutcome =
  | { readonly queued: SessionEvent; readonly idle: boolean }
  | { readonly refused: HeldQueueState };

/**
 * Queues a message unless a turn holds the session, under its lock;
 * answers the state that kept it out otherwise (module header). The `user.message`
 * carries the turn's text and the files it was admitted with
 * (RunStatus.message_files), as a turn's own message does.
 */
export async function enqueueMessage(deps: SessionQueueDeps, message: MessageToQueue): Promise<EnqueueOutcome> {
  const event = create(SessionEventSchema, {
    event: {
      case: "userMessage",
      value: {
        id: generateId(SESSION_EVENT_ID_PREFIX),
        content: messageContent(message.turn.spec?.message ?? "", message.turn.status?.messageFiles ?? []),
      },
    },
  });
  let refused: HeldQueueState | undefined;
  let idle = false;
  const result = await deps.store.writeSessionQueue(message.sessionId, message.org, SESSION_QUEUE_SCOPE, (session) => {
    const state = queueStateOf(session);
    if (state.kind === "waiting" || state.kind === "paused") {
      refused = state;
      return {};
    }
    idle = state.kind !== "busy";
    return {
      enqueue: {
        draft: draftOf(event),
        entry: { sender: message.sender, turn: toBinary(RunSchema, message.turn) },
      },
      events: sessionEventsForQueue({
        working: session.working.length,
        waiting: 0,
        paused: 0,
        queued: session.queued.length + 1,
        status: latestStatusOf(session),
      }).map(draftOf),
    };
  });
  publish(deps, message.sessionId, message.org, result.enqueued === undefined ? result.events : [result.enqueued, ...result.events]);
  if (refused !== undefined) {
    return { refused };
  }
  return { queued: eventOf(result.enqueued!), idle };
}

/** The session's state for a message, read under its lock; writes nothing. */
export async function readQueueState(store: Store, sessionId: string): Promise<SessionQueueState> {
  return queueStateOf(await readSessionTurns(store, sessionId));
}

/** The session's unfinished turns and its queue, read under its lock; writes nothing. */
export async function readSessionTurns(store: Store, sessionId: string): Promise<SessionQueueContext> {
  let turns: SessionQueueContext | undefined;
  await store.writeSessionQueue(sessionId, "", SESSION_QUEUE_SCOPE, (session) => {
    turns = session;
    return {};
  });
  return turns!;
}

/** Why messages are dropped, when it is not the person's own stop: recorded as a session.error. */
export interface DropReason {
  readonly type: string;
  readonly message: string;
}

/**
 * Drops messages still waiting (all of them, or the ids named), under the
 * session's lock: their side rows go, their events stay, never accepted.
 * With a reason, the session records it as a session.error. The session's
 * status follows (module header). Answers the ids dropped.
 */
export async function dropQueuedMessages(
  deps: SessionQueueDeps,
  sessionId: string,
  org: string,
  options: { readonly eventIds?: ReadonlyArray<string>; readonly reason?: DropReason } = {},
): Promise<ReadonlyArray<string>> {
  const result = await deps.store.writeSessionQueue(sessionId, org, SESSION_QUEUE_SCOPE, (session) => {
    const named = options.eventIds === undefined ? undefined : new Set(options.eventIds);
    const drop = session.queued
      .map((queued) => queued.record.eventId)
      .filter((eventId) => named === undefined || named.has(eventId));
    if (drop.length === 0) {
      return {};
    }
    const errors =
      options.reason === undefined
        ? []
        : [
            create(SessionEventSchema, {
              event: {
                case: "sessionError",
                value: {
                  id: generateId(SESSION_EVENT_ID_PREFIX),
                  error: {
                    type: options.reason.type,
                    message: options.reason.message,
                    retryStatus: { type: "terminal" },
                  },
                },
              },
            }),
          ];
    return {
      drop,
      events: [
        ...errors,
        ...sessionEventsForQueue({
          working: session.working.length,
          waiting: session.waiting.length,
          paused: session.paused.length,
          queued: session.queued.length - drop.length,
          status: latestStatusOf(session),
        }),
      ].map(draftOf),
    };
  });
  publish(deps, sessionId, org, result.events);
  return result.dropped;
}

/** A queued message's turn, decoded from its side row. */
export function queuedTurnOf(queued: QueuedSessionMessage): Run {
  return fromBinary(RunSchema, queued.turn);
}

/**
 * Whose authority a message was sent with, or a turn runs with (module
 * header): the sender's identity id, and the person the turn records, ""
 * for none.
 */
export interface TurnAuthority {
  readonly sender: string;
  readonly person: string;
}

/** A queued message's authority: its sender, and the person its turn recorded as it was admitted. */
export function authorityOfQueued(queued: QueuedSessionMessage): TurnAuthority {
  return { sender: queued.sender, person: queuedTurnOf(queued).status?.credentials?.person ?? "" };
}

/** A run's authority: who created it, and the person it recorded. */
export function authorityOfRun(run: Run): TurnAuthority {
  return {
    sender: run.status?.audit?.specAudit?.createdBy?.id ?? "",
    person: run.status?.credentials?.person ?? "",
  };
}

/** Whether two authorities are one: a sender's message, and a turn that may read it. */
export function sameAuthority(a: TurnAuthority, b: TurnAuthority): boolean {
  return a.sender !== "" && a.sender === b.sender && a.person === b.person;
}

function latestStatusOf(session: SessionQueueContext) {
  return session.latestState === undefined ? undefined : sessionStatusOf(eventOf(session.latestState));
}

function publish(deps: SessionQueueDeps, sessionId: string, org: string, records: ReadonlyArray<Parameters<typeof eventOf>[0]>): void {
  if (records.length > 0) {
    deps.sessionEventBroker.publish(sessionId, org, records.map(eventOf));
  }
}
