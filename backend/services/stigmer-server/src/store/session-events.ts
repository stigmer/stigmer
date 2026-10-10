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
 * commits the row (or its removal) with the events it returned. The count
 * comes from one list key of the kind (`scope.workingKey`, a key a row
 * holds while it works), read from the key table without decoding a row:
 * runs are the fattest rows in the store.
 *
 * Lock order, everywhere: the session first, then rows. An append takes
 * the session's lock, then reads the row it is guarded by.
 *
 * Proven by the session event store kit (session-events-contract.ts) on
 * both drivers, and in the cloud over its store.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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

/** A resent event id whose bytes differ from the stored event's. */
export class SessionEventConflictError extends Error {
  constructor(readonly sessionId: string, readonly eventId: string) {
    super(`session event '${eventId}' already exists in session '${sessionId}' with other content`);
    this.name = "SessionEventConflictError";
  }
}

export interface SessionEventStore {
  /** One page of a session's events, by seq in the query's order. */
  list(sessionId: string, query: SessionEventQuery): Promise<SessionEventRecord[]>;

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

  /** Removes every event of a session (its delete); returns the count. */
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
   * The session of a row not yet stored (a create), which has no key to
   * read it from. A written row whose session differs is refused.
   */
  readonly sessionId?: string;
}

/** What a resource write that carries events persists. */
export type ResourceEventWrite<Desc extends DescMessage> =
  | {
      /** The row to persist. */
      readonly put: MessageShape<Desc>;
      readonly events: ReadonlyArray<SessionEventDraft>;
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

/**
 * The synchronous half of a resource write that carries events. `previous`
 * is the committed row read under the locks (undefined when absent);
 * `othersWorking` counts the session's other rows holding the working key.
 * Throwing writes nothing and propagates.
 */
export type ResourceEventWriter<Desc extends DescMessage> = (
  previous: MessageShape<Desc> | undefined,
  othersWorking: number,
) => ResourceEventWrite<Desc>;

/** The instant the store stamps: fixed-width UTC with milliseconds, never before the session's newest event. */
export function sessionEventInstant(nowMillis: number, newest: string | undefined): string {
  const now = new Date(nowMillis).toISOString();
  return newest !== undefined && newest > now ? newest : now;
}

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
