// Read helpers for the dedicated `stigmer session` command surface (resume
// and friends). Session LIST is a first-class registry verb served by
// LIST_HANDLERS in resources/list.ts — stigmer/stigmer#469 promoted it there
// from a bespoke pre-gate route in commands/list.ts; `get session` reads one
// through GET_BINDINGS and lists its runs through `listRunsBySession` here
// (resources/views/session.ts). delete stays deliberately unpromised in the
// verb matrix (stigmer/stigmer#354); resume-style flows read sessions
// through these helpers.
//
// A conversation's content is its session's event log: a session's events,
// or one run's, are listed oldest first, every page read, and a run is
// traced to its session by the run's own target.

import { create } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ListRunsBySessionRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ListSessionEventsRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { Stigmer } from "@stigmer/client";
import { CliExitError, ExitCode } from "../errors/index.js";
import { readCursorPages } from "./cursor-pages.js";

/** Fetch a single session by ID. */
export async function getSessionById(client: Stigmer, sessionId: string): Promise<Session> {
  return client.session.get(sessionId);
}

/**
 * List a session's runs, newest-first (the backend's order). The RPC
 * answers a page at a time, so every page is read: the result is the
 * complete set. Returns the raw entries for resume to inspect.
 */
export async function listRunsBySession(client: Stigmer, sessionId: string): Promise<Run[]> {
  return readCursorPages(0, (pageSize, pageToken) =>
    client.run.listBySession(create(ListRunsBySessionRequestSchema, { sessionId, pageSize, pageToken })),
  );
}


// The most events one page asks for: the most the server returns.
const EVENT_PAGE_SIZE = 1000;

/**
 * List a session's events oldest first, every page; with `runId`, only that
 * run's (turn's) events.
 */
export async function listSessionEvents(client: Stigmer, sessionId: string, runId = ""): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  let pageToken = "";
  do {
    const page = await client.session.listEvents(
      create(ListSessionEventsRequestSchema, { sessionId, runId, pageSize: EVENT_PAGE_SIZE, pageToken }),
    );
    events.push(...page.events);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return events;
}

/** The session a run is a turn of; refuses a run that names none. */
export function sessionOfRun(run: Run): string {
  const target = run.spec?.target;
  if (target?.case === "sessionId" && target.value !== "") return target.value;
  throw new CliExitError(`run ${run.metadata?.id ?? ""} names no session`, ExitCode.General);
}
