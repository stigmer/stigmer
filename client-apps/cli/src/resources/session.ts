// `list sessions` support. Sessions, like executions, are runtime resources that
// bypass the resource registry: there is no `get`/`create`/`delete session` in
// the unified verbs, only a list. This module owns the alias predicate and the
// list fetch so the command layer stays declarative.

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ListSessionsRequestSchema, SessionListSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import type { OutputFormat } from "../output/index.js";
import type { ResourceResult } from "./get-bindings.js";
import { obj, renderListMessage, str, type TableShape } from "./render.js";

// Mirrors Go's execution.MaxPageSize — fetch the whole session history in one
// call (sessions don't accumulate enough executions to need pagination here).
const MAX_EXECUTIONS_PAGE_SIZE = 100;

/** Fetch a single session by ID (Go's session.GetFromBackend). */
export async function getSessionById(client: Stigmer, sessionId: string): Promise<Session> {
  return client.session.get(sessionId);
}

/**
 * List a session's executions, newest-first (the backend's order, matching Go's
 * execution.ListBySession). Returns the raw entries for resume to inspect.
 */
export async function listExecutionsBySession(client: Stigmer, sessionId: string): Promise<AgentExecution[]> {
  const list = await client.agentExecution.listBySession(
    create(ListAgentExecutionsBySessionRequestSchema, { sessionId, pageSize: MAX_EXECUTIONS_PAGE_SIZE }),
  );
  return list.entries;
}

/** True for the `session`/`sessions` type-alias family. */
export function isSessionAlias(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "session" || normalized === "sessions";
}

/** List sessions for the current context, paginated by `limit`. */
export async function listSessions(client: Stigmer, limit: number): Promise<ResourceResult> {
  const message = await client.session.list(create(ListSessionsRequestSchema, { pageSize: limit }));
  return { schema: SessionListSchema, message };
}

const SESSION_TABLE: TableShape = {
  resourceName: "sessions",
  headers: ["SESSION ID", "AGENT", "SUBJECT", "CREATED"],
  row: (json) => [
    str(obj(json, "metadata"), "id"),
    dash(str(obj(json, "spec"), "agent_instance_id")),
    dash(str(obj(json, "spec"), "subject")),
    dash(str(obj(json, "metadata"), "created_at")),
  ],
};

/** Render a session list (json/yaml = full envelope; table = grid). */
export function renderSessionList(result: ResourceResult, format: OutputFormat): string {
  return renderListMessage(result.schema, result.message, format, SESSION_TABLE);
}

function dash(value: string): string {
  return value === "" ? "-" : value;
}
