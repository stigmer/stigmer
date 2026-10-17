/**
 * `GET /v1/sessions/{id}/events`: one page of a session's events as
 * Managed Agents' list answers it, `{data, next_page}`.
 *
 * Only Managed Agents types leave through this lane. A request that names
 * no types asks the native list for exactly the contract's Managed Agents
 * types, so the store does the filtering and every page is full; a request
 * naming a Stigmer type was refused by the query parser. The native page
 * token is bound to its query, and the SDK repeats every parameter on the
 * next page, so the token travels as `page` unchanged.
 *
 * An unknown session is a 404, as Managed Agents answers it. The native
 * list reads only the log, and where no authorization check looks the
 * session up (an install without sign-in) an unknown session's log is
 * just empty; so an empty first page asks the session itself
 * (SessionQueryController.get, the same can_view), whose refusal is the
 * answer. A session with events costs no extra read.
 *
 * Proven by __tests__/lane-composed.test.ts and the
 * session-events-managed-agents conformance suites.
 */
import { create } from "@bufbuild/protobuf";

import { ListSessionEventsRequestSchema, SessionIdSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { SESSION_EVENT_TYPES, isStigmerEventType, toManagedAgentsJson } from "@stigmer/session-log";

import type { LaneResponse } from "../lanes.js";
import type { LaneCall } from "./call.js";
import type { ListQuery } from "./query.js";
import { writeJson } from "./respond.js";

/** Every Managed Agents type the contract carries: what an unfiltered list asks for. */
export const MANAGED_AGENTS_EVENT_TYPES: readonly string[] = SESSION_EVENT_TYPES.filter(
  (type) => !isStigmerEventType(type),
);

/** Answers one page; a native refusal throws for the lane to write. */
export async function serveList(call: LaneCall, query: ListQuery, response: LaneResponse): Promise<number> {
  const page = await call.clients.sessionQuery.listEvents(
    create(ListSessionEventsRequestSchema, {
      sessionId: call.sessionId,
      pageSize: query.limit,
      pageToken: query.page,
      order: query.order,
      types: query.types.length === 0 ? [...MANAGED_AGENTS_EVENT_TYPES] : [...query.types],
      createdAtGt: query.createdAtGt,
      createdAtGte: query.createdAtGte,
      createdAtLt: query.createdAtLt,
      createdAtLte: query.createdAtLte,
    }),
    call.options,
  );
  if (page.events.length === 0 && query.page === "") {
    await requireSession(call);
  }
  writeJson(response, 200, call.requestId, {
    data: page.events.map(toManagedAgentsJson),
    next_page: page.nextPageToken === "" ? null : page.nextPageToken,
  });
  return 200;
}

/** Refuses an unknown session with the native get's own refusal (module header). */
export async function requireSession(call: LaneCall): Promise<void> {
  await call.clients.sessionQuery.get(create(SessionIdSchema, { value: call.sessionId }), call.options);
}
