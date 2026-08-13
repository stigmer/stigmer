// Agent-execution read path: the polling primitive behind get_agent_execution.
//
// Agent executions have no event-log RPC (unlike workflow executions) — the
// platform's contract is: poll get and read status.phase, status.messages[],
// and status.pending_approvals[]. That makes the response shape critical for
// MCP: a long conversation's full protojson (every message, the resolved
// context snapshot, the approval ledger, sub-agent transcripts) can dwarf the
// model's context. The default "compact" view therefore returns a bounded
// message tail and drops the bulky server-side bookkeeping fields; "full" is
// the verbatim protojson for when the model genuinely needs everything.

import { AgentExecutionSchema, type AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/query_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

export type ExecutionView = "compact" | "full";

/** Message-tail size when the caller doesn't specify one. */
export const DEFAULT_MESSAGE_LIMIT = 5;

/**
 * Bulky status fields pruned from the compact view. These are server-side
 * bookkeeping (append-only approval ledger, Temporal callback token) and
 * sub-agent transcripts — none of which the poll loop (phase? messages?
 * approvals?) needs.
 */
const COMPACT_PRUNED_STATUS_FIELDS = [
  "approval_events",
  "callback_token",
  "sub_agent_executions",
] as const;

/** Fetch a single agent execution by ID and shape it for the requested view. */
export async function fetchAgentExecution(
  serverAddress: string,
  token: string,
  executionId: string,
  view: ExecutionView,
  messageLimit: number,
): Promise<string> {
  if (executionId === "") {
    throw new Error("execution_id is required");
  }
  return withClient(
    AgentExecutionQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      let execution: AgentExecution;
      try {
        execution = await client.get({ value: executionId }, callOptions);
      } catch (err) {
        throw rpcError(err, `agent execution "${executionId}"`);
      }
      return view === "full"
        ? toProtoJson(AgentExecutionSchema, execution)
        : compactExecutionJson(execution, messageLimit);
    },
  );
}

/** The compact projection plus the pre-truncation message count. */
export interface CompactExecution {
  readonly totalMessages: number;
  readonly data: Record<string, unknown>;
}

/**
 * Build the compact projection: full protojson minus the pruned status
 * fields, with status.messages sliced to the last `messageLimit` entries.
 * Exposed at the data level so wrappers (cancel_execution's already_terminal
 * envelope) can compose it without double-nesting.
 *
 * Shared by the write tools that return an AgentExecution (approve, cancel):
 * their responses embed the same potentially-huge status.
 */
export function compactExecution(execution: AgentExecution, messageLimit: number): CompactExecution {
  const data = JSON.parse(toProtoJson(AgentExecutionSchema, execution)) as Record<string, unknown>;
  let totalMessages = 0;

  const status = data.status as Record<string, unknown> | undefined;
  if (status !== undefined) {
    const messages: unknown[] = Array.isArray(status.messages) ? status.messages : [];
    totalMessages = messages.length;
    if (messages.length > messageLimit) {
      status.messages = messages.slice(-messageLimit);
    }
    for (const field of COMPACT_PRUNED_STATUS_FIELDS) {
      delete status[field];
    }
  }

  return { totalMessages, data };
}

/**
 * The compact view as returned by tools: a wrapper carrying total_messages so
 * the model can tell when the message tail is a window (and re-request with a
 * larger message_limit or view=full).
 */
export function compactExecutionJson(execution: AgentExecution, messageLimit: number): string {
  const { totalMessages, data } = compactExecution(execution, messageLimit);
  return JSON.stringify(
    { view: "compact", total_messages: totalMessages, execution: data },
    null,
    2,
  );
}
