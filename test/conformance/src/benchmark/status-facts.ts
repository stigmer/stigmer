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
// is a leaf shared with the site and carries no `bigint`.
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
  };
}

function createdAt(execution: AgentExecution): string {
  const stamp = execution.status?.audit?.specAudit?.createdAt;
  return stamp === undefined ? "" : timestampDate(stamp).toISOString();
}

function toNumber(value: bigint | undefined): number {
  return value === undefined ? 0 : Number(value);
}
