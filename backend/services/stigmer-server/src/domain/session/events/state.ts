/**
 * A session's state, computed from its log on read and never stored: the
 * newest session status event says it. Running gives running, idle gives
 * idle, and a session with no status event yet (none of its runs ever
 * worked, or its runs predate the log) reads idle.
 *
 * The store answers it with one indexed read: the newest event of the two
 * status types (the session_events (session_id, type, seq) index).
 *
 * Every session a read answers carries it on `status.state`
 * (SessionStatus.state), set by the read chains' StampSessionState step
 * after the load (session get, list, listByAgent, listByChannel), one
 * read per session. It is never written: a create clears the status a
 * client sends (BuildNewState) and an update keeps the stored status in
 * place of the client's (BuildUpdateState), so a state a client echoes
 * back from a read never reaches the row.
 *
 * Proven by __tests__/state.test.ts and the session conformance suite.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";

import type { PipelineStep } from "../../../pipeline/pipeline.js";
import type { RequestContext } from "../../../pipeline/request-context.js";
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

/** Sets each session's state on its status, read from the store; the sessions are answered, never written. */
export async function stampSessionStates(
  store: Store,
  sessions: ReadonlyArray<Session>,
): Promise<void> {
  await Promise.all(
    sessions.map(async (session) => {
      const state = await readSessionState(store, session.metadata?.id ?? "");
      (session.status ??= create(SessionStatusSchema)).state = state;
    }),
  );
}

/**
 * StampSessionState: a read chain's last step, after its load. `sessionsOf`
 * names the sessions the chain answers in its context; a store fault is
 * rethrown, for the executor to answer as Internal.
 */
export function newStampSessionStateStep<Desc extends DescMessage>(
  store: Store,
  sessionsOf: (ctx: RequestContext<Desc>) => ReadonlyArray<Session>,
): PipelineStep<Desc> {
  return {
    name: "StampSessionState",
    async execute(ctx) {
      await stampSessionStates(store, sessionsOf(ctx));
    },
  };
}
