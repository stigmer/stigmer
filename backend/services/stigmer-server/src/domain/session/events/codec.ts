/**
 * Between a SessionEvent and the store's record of it
 * (store/session-events.ts).
 *
 * A draft's bytes are the event as its writer produced it, WITHOUT the
 * fields the store assigns: its place in the log (`seq`), its session and
 * the time the store accepted it (the inner event's `processed_at`). The
 * store keeps those in columns, and a read puts them back. So a runner's
 * resent event encodes to exactly the bytes stored the first time, which
 * is how the store recognises a resend (equal bytes: accepted again; other
 * bytes under the same id: refused).
 *
 * Proven by __tests__/codec.test.ts.
 */
import { clone, fromBinary, toBinary } from "@bufbuild/protobuf";

import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { SessionEventDraft, SessionEventRecord } from "../../../store/session-events.js";
import { eventIdOf, eventTypeOf } from "./catalog.js";

/** The store draft of an event: its identity, and its bytes without seq, session or accepted time. */
export function draftOf(event: SessionEvent): SessionEventDraft {
  const bare = clone(SessionEventSchema, event);
  bare.seq = 0n;
  bare.sessionId = "";
  if (bare.event.case !== undefined) {
    bare.event.value.processedAt = "";
  }
  return {
    eventId: eventIdOf(event),
    runId: event.runId,
    threadId: event.threadId,
    type: eventTypeOf(event),
    data: toBinary(SessionEventSchema, bare),
  };
}

/** A stored record as the event a reader gets: decoded, with its seq, session and accepted time. */
export function eventOf(record: SessionEventRecord): SessionEvent {
  const event = fromBinary(SessionEventSchema, record.data);
  event.seq = BigInt(record.seq);
  event.sessionId = record.sessionId;
  if (event.event.case !== undefined) {
    event.event.value.processedAt = record.processedAt;
  }
  return event;
}
