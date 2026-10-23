/**
 * The session event log's storage contract: the types the `sessionEvents`
 * sub-store and `Store.writeResourceAppendingEvents` share, and the
 * driver-neutral rules both drivers apply.
 *
 * A session's events are one ordered list. The store numbers them (`seq`,
 * gap-free per session as appended) and stamps when each was accepted
 * (`processedAt`), both under the session's write serialization, so two
 * writers of one session can never interleave a number or a time. The
 * payload is opaque bytes, as every row is: the domain encodes an event
 * WITHOUT its seq and accepted time, and reads them back from the columns
 * (domain/session/events/codec.ts). That keeps the stored bytes equal to
 * what a writer sent, which is what makes a resent event recognisable.
 *
 * Why the resource write carries events. A run's phase decides whether
 * its session is working, and the session's status events say so. They
 * must commit with the row or a crash between the two leaves the log
 * telling another story than the runs (the status observers run after the
 * commit for that reason, and cannot keep a log). So the one atomic method
 * reads the committed row and the count of the session's OTHER working
 * rows under the session's lock, hands both to a synchronous `write`, and
 * commits the row (or its removal) with the events it returned (a writer
 * that must know which run holds the session's newest event of a type asks
 * for it in its scope, and only then is it read). The count
 * comes from one list key of the kind (`scope.workingKey`, a key a row
 * holds while it works), read from the key table without decoding a row:
 * runs are the fattest rows in the store.
 *
 * Gates. An event can open a gate (a tool use that waits for a person's
 * answer) or close one (the answer, or the call's result), named by the
 * tool use's id. The store keeps both in columns beside the bytes, derived
 * by the declaration the domain hands it at open
 * (`SessionEventGateDeclaration`, domain/session/events/gates.ts), the way
 * list keys are derived (list-index.ts): on every write, and at open for
 * every row stamped with another revision, so a log written before the
 * columns existed gains its gates. A writer that asks (`scope.waitingKey`)
 * is handed the open gates of the session's waiting rows and of the
 * written row, read from the columns without decoding an event; a reader
 * outside a write asks the store for one run's open gates
 * (`SessionEventStore.openGates`) from the same columns. A gate is
 * closed only by an event of the run that opened it. What waits
 * is computed from the log on every read; nothing about it is stored
 * beside the log.
 *
 * A writer that decides from what its run's log already says (a
 * file-review decision, a policy keep's consent) names the types it needs
 * (`scope.runEventTypes`) and is handed the run's events of them, read
 * under the same lock its write commits under, so no decision is made
 * from a log another writer has since added to.
 *
 * The queue. A message sent while a turn of the session works waits in
 * the log as a `user.message` with no run and no accepted time
 * (`processedAt` ""), and in a side row beside it holding what the event
 * does not: who sent it and the turn it would start
 * (`QueuedSessionMessageEntry`). The side row exists while the message
 * waits. Taking a message moves it: the write that takes it names its id
 * (`ResourceEventWrite.takeQueued`), the store deletes the queued row and
 * its side row under the session's lock, and the write's own events carry
 * the message again, stamped with the run that read it, at the head of the
 * log, so it is listed once, where it was read. Dropping a message deletes
 * its side row alone: the event stays, never accepted. Enqueueing and
 * dropping are `Store.writeSessionQueue`, which hands its writer the
 * session's working, waiting and paused rows and its queue under the same
 * lock. A queued row takes a number from the session's head like any
 * event, and leaves the head's accepted time as it was.
 *
 * Lock order, everywhere: the session first, then rows. An append takes
 * the session's lock, then reads the row it is guarded by.
 *
 * Proven by the session event store kit (session-events-contract.ts) on
 * both drivers, and in the cloud over its store.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/** One event as a writer hands it to the store: its identity and its bytes, before the store numbers and stamps it. */
export interface SessionEventDraft {
  /** The event's id, unique in its session. */
  readonly eventId: string;
  /** The run (turn) the event belongs to; "" for none. */
  readonly runId: string;
  /** The thread that produced it; "" for the primary thread. */
  readonly threadId: string;
  /** The event's type string ("agent.message"). */
  readonly type: string;
  /** The encoded event, without its seq or accepted time. */
  readonly data: Uint8Array;
}

/** One stored event. */
export interface SessionEventRecord extends SessionEventDraft {
  readonly sessionId: string;
  /** The event's place in its session's log. */
  readonly seq: number;
  /** When the store accepted it: fixed-width UTC with milliseconds. */
  readonly processedAt: string;
}

/** One read of a session's log. Every predicate is optional and they AND together. */
export interface SessionEventQuery {
  /** asc reads oldest first. */
  readonly order: "asc" | "desc";
  /** Events strictly after this seq in the order (a continuing page). */
  readonly afterSeq?: number;
  /** Only events of these types; absent or empty reads every type. */
  readonly types?: ReadonlyArray<string>;
  /** Only events of this run; absent reads every run's. */
  readonly runId?: string;
  /**
   * Only the events with these ids (the (session_id, event_id) index);
   * absent reads every id, and an empty list reads none.
   */
  readonly eventIds?: ReadonlyArray<string>;
  /** Bounds on processedAt, each fixed-width UTC text compared as bytes. */
  readonly processedAtGt?: string;
  readonly processedAtGte?: string;
  readonly processedAtLt?: string;
  readonly processedAtLte?: string;
  /** At most this many events; a positive integer. */
  readonly limit: number;
}

/**
 * The row an append is guarded by (a run, for a runner's events): read
 * under the session's lock, decoded and handed to `admit`, which throws to
 * refuse. Absent rows throw ResourceNotFoundError.
 */
export interface SessionEventGuard<Desc extends DescMessage = DescMessage> {
  readonly kind: ApiResourceKind;
  readonly id: string;
  readonly schema: Desc;
  admit(row: MessageShape<Desc>): void;
}

/** The gate an event opens and the gate it closes: a tool use's id each, or "". */
export interface SessionEventGates {
  readonly opens: string;
  readonly closes: string;
}

/** An event with no gate. */
export const NO_SESSION_EVENT_GATES: SessionEventGates = { opens: "", closes: "" };

/**
 * How a store derives each event's gates: the domain's function of an
 * event's type and bytes, the types it can give a gate (every other type
 * has none, read without decoding), and the revision a change to either
 * bumps. A store opened without one derives none.
 */
export interface SessionEventGateDeclaration {
  readonly revision: number;
  readonly types: ReadonlyArray<string>;
  gatesOf(type: string, data: Uint8Array): SessionEventGates;
}

/** The gates of a draft under a declaration; none for a type it does not list. */
export function gatesOfDraft(
  declaration: SessionEventGateDeclaration | undefined,
  draft: Pick<SessionEventDraft, "type" | "data">,
): SessionEventGates {
  if (declaration === undefined || !declaration.types.includes(draft.type)) {
    return NO_SESSION_EVENT_GATES;
  }
  return declaration.gatesOf(draft.type, draft.data);
}

/** One gate still open: the tool use that waits, its row, and its place in the log. */
export interface OpenSessionEventGate {
  readonly runId: string;
  readonly toolUseId: string;
  readonly seq: number;
}

/**
 * The open gates among `opened` (in log order): those no event of the same
 * run closes. `closed` holds each closing event's run and the gate it
 * closes; an event of another run never closes a run's gate, so one turn's
 * writer cannot answer or settle another turn's ask. The one rule both
 * drivers apply to the rows they read.
 */
export function openGatesOf(
  opened: ReadonlyArray<OpenSessionEventGate>,
  closed: ReadonlyArray<{ readonly runId: string; readonly toolUseId: string }>,
): OpenSessionEventGate[] {
  const closedKeys = new Set(closed.map((c) => `${c.runId}\u0000${c.toolUseId}`));
  return opened
    .filter((gate) => !closedKeys.has(`${gate.runId}\u0000${gate.toolUseId}`))
    .sort((a, b) => a.seq - b.seq);
}

/** What a queued message's side row holds beyond its event. */
export interface QueuedSessionMessageEntry {
  /** Who sent it: the identity id of the caller the turn it starts acts as. */
  readonly sender: string;
  /** The turn the message would start, encoded as the domain encodes it. */
  readonly turn: Uint8Array;
  /**
   * The lane it was sent through, as the composition kept it
   * (extensions/queued-sender-lane.ts): empty for a person's, and when
   * absent from a write.
   */
  readonly lane?: Uint8Array;
}

/** A message waiting in a session's queue: its stored `user.message` and its side row. */
export interface QueuedSessionMessage extends QueuedSessionMessageEntry {
  readonly record: SessionEventRecord;
  /** The lane it was sent through; empty for a person's. */
  readonly lane: Uint8Array;
}

/** A taken or dropped queued message that no longer waits: another write took or dropped it first. */
export class QueuedSessionMessageGoneError extends Error {
  constructor(readonly sessionId: string, readonly eventId: string) {
    super(`queued message '${eventId}' in session '${sessionId}' no longer waits`);
    this.name = "QueuedSessionMessageGoneError";
  }
}

/** A resent event id whose bytes differ from the stored event's. */
export class SessionEventConflictError extends Error {
  constructor(readonly sessionId: string, readonly eventId: string) {
    super(`session event '${eventId}' already exists in session '${sessionId}' with other content`);
    this.name = "SessionEventConflictError";
  }
}

/** A page of an organization's events (`SessionEventStore.listByOrg`). */
export interface SessionEventOrgQuery {
  readonly types: ReadonlyArray<string>;
  /** Exclusive: the accepted time and event id of the last event already read. */
  readonly after?: { readonly processedAt: string; readonly eventId: string };
  readonly limit: number;
}

export interface SessionEventStore {
  /** One page of a session's events, by seq in the query's order. */
  list(sessionId: string, query: SessionEventQuery): Promise<SessionEventRecord[]>;

  /**
   * One page of an organization's accepted events of `query.types`, across
   * its sessions, oldest first by accepted time then event id, after
   * `query.after` when given. An event no turn accepted yet (a queued
   * message) is never in it. Read without any session's lock.
   */
  listByOrg(org: string, query: SessionEventOrgQuery): Promise<SessionEventRecord[]>;

  /**
   * The open gates of one run in a session, in log order: the gates its
   * events open that no event of the same run closes, read from the gate
   * columns without decoding an event (the same rule a writer is handed
   * as `SessionEventContext.gates`). Read without the session's lock: a
   * reader that must act on it under the lock reads the gates it is
   * handed there.
   */
  openGates(sessionId: string, runId: string): Promise<OpenSessionEventGate[]>;

  /**
   * Appends events to a session's log, in order, all or none, after the
   * guard admits its row under the session's lock. An event whose id the
   * session already holds with the same bytes is not appended again: the
   * stored record is answered in its place. The same id with other bytes
   * throws SessionEventConflictError and appends nothing.
   */
  append(
    sessionId: string,
    org: string,
    drafts: ReadonlyArray<SessionEventDraft>,
    guard: SessionEventGuard,
  ): Promise<SessionEventAppend>;

  /**
   * The messages waiting in a session's queue, in the order they were
   * sent. Read without the session's lock: a reader that must act on it
   * under the lock reads the queue it is handed there.
   */
  queued(sessionId: string): Promise<QueuedSessionMessage[]>;

  /** Removes every event of a session (its delete), its queue with them; returns the count. */
  deleteBySession(sessionId: string): Promise<number>;

  /** Removes every event of an organization's sessions (its purge's sweep); returns the count. */
  deleteByOrg(org: string): Promise<number>;
}

/** What an append stored. */
export interface SessionEventAppend {
  /** One record per distinct draft id, in draft order: the stored one for a resend. */
  readonly records: ReadonlyArray<SessionEventRecord>;
  /** The records this append added (resends left out), in order. */
  readonly appended: ReadonlyArray<SessionEventRecord>;
}

/**
 * How a resource write finds its session and counts the session's other
 * working rows: two list keys of the kind (store/list-index.ts). The
 * organization each event is kept under is the row's own.
 */
export interface SessionEventScope {
  /** The kind's list key valued with the row's session; the store reads a stored row's session through it. */
  readonly sessionKey: string;
  /** The kind's list key a row holds, valued with its session, while it is working. */
  readonly workingKey: string;
  /**
   * The event types that state the session's state; the writer is handed
   * the newest of them (`SessionEventContext.latestStateType`).
   */
  readonly stateEventTypes: ReadonlyArray<string>;
  /**
   * An event type whose newest event's run the writer needs
   * (`SessionEventContext.runOfNewestType`): "is this run still the
   * conversation's newest turn" is the run of the newest `user.message`.
   * Opt-in, so a write that does not ask pays no read.
   */
  readonly runOfNewestType?: string;
  /**
   * The kind's list key a row holds, valued with its session, while it
   * waits for a person's answer. When set, the writer is handed the other
   * waiting rows (`SessionEventContext.othersWaiting`) and the open gates
   * of those rows and of the written row (`SessionEventContext.gates`).
   */
  readonly waitingKey?: string;
  /**
   * The session of a row not yet stored (a create), which has no key to
   * read it from. A written row whose session differs is refused.
   */
  readonly sessionId?: string;
  /**
   * Event types of the written row's own run (events whose run is the
   * row's id) the writer is handed, in log order
   * (`SessionEventContext.runEvents`): a writer that decides from what
   * the run's log already says (a file-review decision, the consent a
   * policy keep verifies) reads it under the same lock it writes under.
   * Opt-in, so a write that does not ask pays no read.
   */
  readonly runEventTypes?: ReadonlyArray<string>;
  /**
   * The kind's list key a row holds, valued with its session, while it is
   * paused. When set, the writer is handed the other paused rows
   * (`SessionEventContext.othersPaused`).
   */
  readonly pausedKey?: string;
  /**
   * The writer is handed the session's queue
   * (`SessionEventContext.queued`), whose messages it may take
   * (`ResourceEventWrite.takeQueued`). Opt-in, so a write that does not
   * ask pays no read; every write is handed the queue's length.
   */
  readonly queued?: boolean;
}

/** What a resource write that carries events persists. */
export type ResourceEventWrite<Desc extends DescMessage> =
  | {
      /** The row to persist. */
      readonly put: MessageShape<Desc>;
      readonly events: ReadonlyArray<SessionEventDraft>;
      /**
       * Queued messages the write takes, by event id: each must still wait
       * (QueuedSessionMessageGoneError otherwise, and nothing is written).
       * Its queued row and side row are removed before `events` append, and
       * `events` carry it again, stamped with the run that read it.
       */
      readonly takeQueued?: ReadonlyArray<string>;
    }
  | {
      /**
       * The row is removed, and with it its own events except those of
       * these types (the ones that describe the session, not the row).
       */
      readonly remove: { readonly keepEventTypes: ReadonlyArray<string> };
      readonly events: ReadonlyArray<SessionEventDraft>;
    };

/** What a resource write that carries events committed. */
export interface ResourceEventWriteResult<Desc extends DescMessage> {
  /** The committed row before the write; undefined when there was none. */
  readonly previous: MessageShape<Desc> | undefined;
  /** The persisted row; undefined when it was removed. */
  readonly row: MessageShape<Desc> | undefined;
  /** The events appended, numbered and stamped. */
  readonly events: ReadonlyArray<SessionEventRecord>;
}

/** What a resource write's writer is told about its session, as committed, under the session's lock. */
export interface SessionEventContext {
  /** The session's other rows holding the working key. */
  readonly othersWorking: number;
  /** The type of the session's newest event among `scope.stateEventTypes`; undefined when it has none. */
  readonly latestStateType: string | undefined;
  /** That newest event itself; undefined when the session has none. */
  readonly latestState: SessionEventRecord | undefined;
  /** The session's other rows holding `scope.waitingKey`; empty when the scope does not ask. */
  readonly othersWaiting: ReadonlyArray<string>;
  /**
   * The open gates of the rows in `othersWaiting` and of the written row,
   * in log order; empty when the scope does not ask.
   */
  readonly gates: ReadonlyArray<OpenSessionEventGate>;
  /**
   * The run of the session's newest event of `scope.runOfNewestType`;
   * undefined when the scope does not ask, or the session has no such event.
   */
  readonly runOfNewestType: string | undefined;
  /**
   * The written row's own events of `scope.runEventTypes`, in log order;
   * empty when the scope does not ask, or the row is in no session.
   */
  readonly runEvents: ReadonlyArray<SessionEventRecord>;
  /** The session's other rows holding `scope.pausedKey`; empty when the scope does not ask. */
  readonly othersPaused: ReadonlyArray<string>;
  /** How many messages wait in the session's queue. */
  readonly queuedCount: number;
  /** The session's queue, in the order sent; empty when the scope does not ask (`scope.queued`). */
  readonly queued: ReadonlyArray<QueuedSessionMessage>;
}

/**
 * How a queue write counts the session's rows: three list keys of one
 * kind (runs), each valued with the session while a row is working,
 * waiting for an answer or paused, and the event types that state the
 * session's state.
 */
export interface SessionQueueScope {
  readonly kind: ApiResourceKind;
  readonly workingKey: string;
  readonly waitingKey: string;
  readonly pausedKey: string;
  readonly stateEventTypes: ReadonlyArray<string>;
}

/** What a queue write's writer is told about its session, under the session's lock. */
export interface SessionQueueContext {
  /** The session's rows holding each key, by id. */
  readonly working: ReadonlyArray<string>;
  readonly waiting: ReadonlyArray<string>;
  readonly paused: ReadonlyArray<string>;
  /** The session's queue, in the order sent. */
  readonly queued: ReadonlyArray<QueuedSessionMessage>;
  /** The session's newest event among `scope.stateEventTypes`; undefined when it has none. */
  readonly latestState: SessionEventRecord | undefined;
}

/** What a queue write commits. */
export interface SessionQueueWrite {
  /** A message to queue: its `user.message` (stored with no accepted time) and its side row. */
  readonly enqueue?: { readonly draft: SessionEventDraft; readonly entry: QueuedSessionMessageEntry };
  /** Queued messages to drop, by event id: their side rows go, their events stay. */
  readonly drop?: ReadonlyArray<string>;
  /** Events to append after the queued one. */
  readonly events?: ReadonlyArray<SessionEventDraft>;
}

/** What a queue write committed. */
export interface SessionQueueWriteResult {
  /** The queued message's record; undefined when nothing was queued. */
  readonly enqueued: SessionEventRecord | undefined;
  /** The ids dropped, those that still waited. */
  readonly dropped: ReadonlyArray<string>;
  /** The events appended, numbered and stamped. */
  readonly events: ReadonlyArray<SessionEventRecord>;
}

/**
 * The synchronous half of a queue write. Throwing writes nothing and
 * propagates.
 */
export type SessionQueueWriter = (session: SessionQueueContext) => SessionQueueWrite;

/**
 * The synchronous half of a resource write that carries events. `previous`
 * is the committed row read under the locks (undefined when absent).
 * Throwing writes nothing and propagates.
 */
export type ResourceEventWriter<Desc extends DescMessage> = (
  previous: MessageShape<Desc> | undefined,
  session: SessionEventContext,
) => ResourceEventWrite<Desc>;

/** Refuses a limit a caller cannot mean: zero, negative or fractional. */
export function assertSessionEventLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`session event limit must be a positive integer, got ${limit}`);
  }
}

/** Refuses a draft batch a store must never append: an empty id or type, or one id twice with other bytes. */
export function dedupeSessionEventDrafts(
  sessionId: string,
  drafts: ReadonlyArray<SessionEventDraft>,
): SessionEventDraft[] {
  const byId = new Map<string, SessionEventDraft>();
  const ordered: SessionEventDraft[] = [];
  for (const draft of drafts) {
    if (draft.eventId === "" || draft.type === "") {
      throw new Error("a session event needs an id and a type");
    }
    const seen = byId.get(draft.eventId);
    if (seen === undefined) {
      byId.set(draft.eventId, draft);
      ordered.push(draft);
    } else if (!sameBytes(seen.data, draft.data)) {
      throw new SessionEventConflictError(sessionId, draft.eventId);
    }
  }
  return ordered;
}

/** Byte equality of two payloads. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}
