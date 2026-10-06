// Agent-run read path: the polling primitive behind get_agent_run.
//
// Agent runs have no event-log RPC (unlike workflow runs) — the
// platform's contract is: poll get and read status.phase, status.messages[],
// and status.pending_approvals[]. That makes the response shape critical for
// MCP: a long conversation's full protojson (every message, the resolved
// context snapshot, the approval ledger, sub-agent transcripts) can dwarf the
// model's context. The default "compact" view therefore returns a bounded
// message tail and drops the bulky server-side bookkeeping fields; "full" is
// the verbatim protojson for when the model genuinely needs everything.

import { AgentRunSchema, type AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/query_pb";

import { withClient } from "../client.js";
import { toProtoJson } from "../marshal.js";
import { rpcError } from "../rpcerr.js";

export type RunView = "compact" | "full";

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
  "sub_agent_runs",
] as const;

/** Fetch a single agent run by ID and shape it for the requested view. */
export async function fetchAgentRun(
  serverAddress: string,
  token: string,
  runId: string,
  view: RunView,
  messageLimit: number,
): Promise<string> {
  if (runId === "") {
    throw new Error("run_id is required");
  }
  return withClient(
    AgentRunQueryController,
    serverAddress,
    token,
    async (client, callOptions) => {
      let run: AgentRun;
      try {
        run = await client.get({ value: runId }, callOptions);
      } catch (err) {
        throw rpcError(err, `agent run "${runId}"`);
      }
      return view === "full"
        ? toProtoJson(AgentRunSchema, run)
        : compactRunJson(run, messageLimit);
    },
  );
}

/** The compact projection plus the pre-truncation message count. */
export interface CompactRun {
  readonly totalMessages: number;
  readonly data: Record<string, unknown>;
}

/**
 * Build the compact projection: full protojson minus the pruned status
 * fields, with status.messages sliced to the last `messageLimit` entries.
 * Exposed at the data level so wrappers (cancel_run's already_terminal
 * envelope) can compose it without double-nesting.
 *
 * Shared by the write tools that return an AgentRun (approve, cancel):
 * their responses embed the same potentially-huge status.
 */
export function compactRun(run: AgentRun, messageLimit: number): CompactRun {
  const data = JSON.parse(toProtoJson(AgentRunSchema, run)) as Record<string, unknown>;
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
export function compactRunJson(run: AgentRun, messageLimit: number): string {
  const { totalMessages, data } = compactRun(run, messageLimit);
  return JSON.stringify(
    { view: "compact", total_messages: totalMessages, run: data },
    null,
    2,
  );
}
