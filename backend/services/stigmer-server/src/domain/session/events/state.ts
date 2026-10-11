/**
 * A session's state, computed from its log on read and never stored: the
 * newest session status event says it. Running gives running, idle gives
 * idle, and a session with no status event yet (none of its runs ever
 * worked, or its runs predate the log) reads idle.
 *
 * The store answers it with one indexed read: the newest event of the two
 * status types (the session_events (session_id, type, seq) index).
 *
 * Proven by __tests__/state.test.ts.
 */
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { Store } from "../../../store/interface.js";
import { SESSION_STATUS_TYPES } from "./catalog.js";
import { eventOf } from "./codec.js";

export type SessionState = "running" | "idle";

/** The state the newest status event among `events` says; idle when there is none. */
export function sessionStateOf(events: ReadonlyArray<SessionEvent>): SessionState {
  let newest: SessionEvent | undefined;
  for (const event of events) {
    const isStatus =
      event.event.case === "sessionStatusRunning" || event.event.case === "sessionStatusIdle";
    if (isStatus && (newest === undefined || event.seq > newest.seq)) {
      newest = event;
    }
  }
  return newest?.event.case === "sessionStatusRunning" ? "running" : "idle";
}

/** A session's state, read from the store. */
export async function readSessionState(store: Store, sessionId: string): Promise<SessionState> {
  const newest = await store.sessionEvents.list(sessionId, {
    order: "desc",
    types: SESSION_STATUS_TYPES,
    limit: 1,
  });
  return sessionStateOf(newest.map(eventOf));
}
