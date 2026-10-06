// `runs trace` — tool-call structure and timing for a run.
//
// Mirrors Go's execution.Trace (trace.go + trace_agent.go): for table output
// render a compact structure view, the agent's tool-call timeline. For
// yaml/json, defer to the standard proto renderers so `trace -o json` and
// `get -o json` produce the identical envelope.

import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { renderProtoJson, renderProtoYaml } from "../output/index.js";
import { shouldColorize, styler } from "../output/style.js";
import { calculateDuration, truncateWithEllipsis } from "./run-format.js";
import { formatAgentPhase } from "./runs.js";

/** Output format for trace: a compact structure table, or the full proto envelope. */
export type TraceFormat = "table" | "yaml" | "json";

export interface TraceStreams {
  write(text: string): void;
  readonly colorize: boolean;
}

/** Fetch and render a run's structure. */
export async function traceRun(
  client: Stigmer,
  runId: string,
  format: TraceFormat,
  streams: TraceStreams = defaultStreams(),
): Promise<void> {
  const exec = await client.agentRun.get(runId);
  if (format === "yaml") {
    streams.write(renderProtoYaml(AgentRunSchema, exec));
    return;
  }
  if (format === "json") {
    streams.write(renderProtoJson(AgentRunSchema, exec));
    return;
  }
  renderAgentTrace(exec, streams);
}

function renderAgentTrace(exec: AgentRun, streams: TraceStreams): void {
  const style = styler(streams.colorize);
  const name = exec.metadata?.name || exec.metadata?.id || "";
  const phase = formatAgentPhase(exec.status?.phase ?? 0);
  const duration = calculateDuration(exec.status?.startedAt ?? "", exec.status?.completedAt ?? "");

  streams.write(`\nAgent: ${name} (${phase}, ${duration})\n\n`);

  const messages = exec.status?.messages ?? [];
  if (messages.length === 0) {
    streams.write("  (no messages recorded)\n\n");
    return;
  }

  const toolCalls = extractToolCallSummaries(exec);
  if (toolCalls.length === 0) {
    streams.write(`  ${messages.length} message(s), no tool calls\n\n`);
    return;
  }
  for (const call of toolCalls) {
    streams.write(`  ${style.green("[done]")} ${pad(truncateWithEllipsis(call.name, 25), 25)}  ${style.dim(truncateWithEllipsis(call.summary, 40))}\n`);
  }
  streams.write("\n");
}

interface ToolCallSummary {
  readonly name: string;
  readonly summary: string;
}

// Mirrors Go's extractToolCallSummary: tool calls on AI messages, with results
// truncated to 40 chars.
function extractToolCallSummaries(exec: AgentRun): ToolCallSummary[] {
  const calls: ToolCallSummary[] = [];
  for (const message of exec.status?.messages ?? []) {
    if (message.type !== MessageType.MESSAGE_AI) continue;
    for (const tc of message.toolCalls) {
      calls.push({ name: tc.name || "tool_call", summary: truncateWithEllipsis(tc.result, 40) });
    }
  }
  return calls;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function defaultStreams(): TraceStreams {
  return { write: (text: string) => void process.stdout.write(text), colorize: shouldColorize(process.stdout) };
}
