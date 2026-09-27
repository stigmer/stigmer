// Reads what the terminal AgentExecution status carries into a benchmark
// sample: the runner's aggregate usage (tokens, the rate-card cost estimate,
// the model it priced against), the server's own timestamps, and the outcome.
// Domain: conformance benchmark (the status-borne facts).
//
// The open-source edition records no per-call usage; `status.streaming_usage`
// (the runner's UsageAccumulator, one writer) is the only cost and token
// fact on the wire, and its cost is an ESTIMATE from the runner's rate card,
// which every sample says through `cost_source`. `input_tokens` is
// cache-inclusive on both harnesses; the report's ratio divides by it.
// Token counts arrive as int64 (`bigint` in the stubs) and become `number`
// here, the one place that conversion happens, because the report contract
// is a leaf read outside this workspace and carries no `bigint`.
//
// Two further facts come off the execution itself. `status.error` is the
// platform's own account of a failed turn, kept verbatim on the sample. The
// platform-attachment count is derived, because no line or field carries one:
// the runner's `mcp_server_count` counts only the declared servers, and on
// this stack memory is the only attachment the runtime adds beside them,
// offered exactly when the server set `spec.recalled_memories.enabled` at
// create. The other runtime attachments (channel messaging, conversation)
// need a channel or conversation label the benchmark never sets.
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { BenchmarkAxes, SampleOutcome, TokenCounts } from "./report";

const MICROS_PER_USD = 1_000_000;

export interface StatusFacts {
  execution_id: string;
  session_id: string;
  model_reported: string;
  tokens: TokenCounts;
  estimated_cost_micros: number;
  server: { created_at: string; started_at: string; completed_at: string };
  outcome: SampleOutcome;
  /** `status.error`, set by the platform on a failed turn; "" otherwise. */
  error: string;
  /** Runtime attachments beside the declared MCP servers (memory, on this stack). */
  attachment_count: number;
}

/** The status-borne half of a sample, from the terminal execution as the client received it. */
export function statusFacts(execution: AgentExecution): StatusFacts {
  const usage = execution.status?.streamingUsage;
  const input = toNumber(usage?.inputTokens);
  const output = toNumber(usage?.outputTokens);
  return {
    execution_id: execution.metadata?.id ?? "",
    session_id: execution.spec?.sessionId ?? "",
    model_reported: usage?.model ?? "",
    tokens: {
      input,
      output,
      cache_read: toNumber(usage?.cacheReadTokens),
      cache_write: toNumber(usage?.cacheWriteTokens),
      total: usage === undefined ? 0 : toNumber(usage.totalTokens) || input + output,
    },
    estimated_cost_micros: Math.round((usage?.estimatedCostUsd ?? 0) * MICROS_PER_USD),
    server: {
      created_at: createdAt(execution),
      started_at: execution.status?.startedAt ?? "",
      completed_at: execution.status?.completedAt ?? "",
    },
    outcome: outcomeOf(execution.status?.phase),
    error: execution.status?.error ?? "",
    attachment_count: execution.spec?.recalledMemories?.enabled === true ? 1 : 0,
  };
}

/**
 * How a client sees the outcome. TERMINATED is an operator's act on a
 * running turn and reads as `cancelled` here: neither is the harness's fault
 * and neither is a sample. The `timeout` outcome is the watcher's, never the
 * status's (the status has no such phase).
 */
export function outcomeOf(phase: ExecutionPhase | undefined): SampleOutcome {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_FAILED:
      return "failed";
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "cancelled";
    default:
      return "failed";
  }
}

/**
 * Whether a subscribe snapshot shows the user something visible: a ROOT row
 * of type AI or THINKING with content (both stream into the console as
 * tokens, the runner's `turn_phases.first_visible_token_ms` definition), and
 * separately an AI row alone (its `first_text_ms`). Sub-agent rows live under
 * `sub_agent_executions` and are not the thread the user is watching.
 */
export function visibleRows(execution: AgentExecution): { visible: boolean; text: boolean } {
  let visible = false;
  let text = false;
  for (const message of execution.status?.messages ?? []) {
    if (message.content.length === 0) continue;
    if (message.type === MessageType.MESSAGE_AI) {
      visible = true;
      text = true;
    } else if (message.type === MessageType.MESSAGE_THINKING) {
      visible = true;
    }
  }
  return { visible, text };
}

/**
 * The agent's final reply on the turn: the content of the last ROOT AI row
 * with content (sub-agent rows live under `sub_agent_executions`), "" when
 * the turn produced none. What a user reads as the turn's answer.
 */
export function finalReply(execution: AgentExecution): string {
  const messages = execution.status?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message !== undefined && message.type === MessageType.MESSAGE_AI && message.content.length > 0) return message.content;
  }
  return "";
}

/** The axes nothing observed yet: every field `null`, the sample's starting point. */
export function nullAxes(): BenchmarkAxes {
  return {
    end_to_end_ms: null,
    client_first_visible_token_ms: null,
    client_first_text_ms: null,
    before_activity_ms: null,
    ensure_thread_ms: null,
    runner_first_visible_token_ms: null,
    runner_first_text_ms: null,
    execution_setup_ms: null,
    turn_total_ms: null,
    max_gap_ms: null,
    rounds: null,
    tool_calls: null,
    sub_agent_calls: null,
    review_ready_ms: null,
    mcp_connect_ms: null,
    cursor_send_returned_ms: null,
    mcp_server_count: null,
    attachment_count: null,
    skill_count: null,
    workspace_entry_count: null,
  };
}

function createdAt(execution: AgentExecution): string {
  const stamp = execution.status?.audit?.specAudit?.createdAt;
  return stamp === undefined ? "" : timestampDate(stamp).toISOString();
}

function toNumber(value: bigint | undefined): number {
  return value === undefined ? 0 : Number(value);
}
