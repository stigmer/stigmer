// Read helpers for the dedicated `stigmer session` command surface (resume
// and friends). Session LIST is a first-class registry verb served by
// LIST_HANDLERS in resources/list.ts — stigmer/stigmer#469 promoted it there
// from a bespoke pre-gate route in commands/list.ts. get/delete stay
// deliberately unpromised in the verb matrix (stigmer/stigmer#354);
// resume-style flows read sessions through these helpers instead.

import { create } from "@bufbuild/protobuf";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ListAgentRunsBySessionRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";

/** Fetch a single session by ID (Go's session.GetFromBackend). */
export async function getSessionById(client: Stigmer, sessionId: string): Promise<Session> {
  return client.session.get(sessionId);
}

/**
 * List a session's executions, newest-first (the backend's order). The RPC
 * returns a session's executions whole, so one call is the complete set.
 * Returns the raw entries for resume to inspect.
 */
export async function listExecutionsBySession(client: Stigmer, sessionId: string): Promise<AgentRun[]> {
  const list = await client.agentRun.listBySession(create(ListAgentRunsBySessionRequestSchema, { sessionId }));
  return list.entries;
}

