// Read helpers for the dedicated `stigmer session` command surface (resume
// and friends). Session LIST is a first-class registry verb served by
// LIST_HANDLERS in resources/list.ts — stigmer/stigmer#469 promoted it there
// from a bespoke pre-gate route in commands/list.ts. get/delete stay
// deliberately unpromised in the verb matrix (stigmer/stigmer#354);
// resume-style flows read sessions through these helpers instead.

import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ListAgentExecutionsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";

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

