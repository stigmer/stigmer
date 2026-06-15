// `execution trace` — task/tool structure and timing for an execution.
//
// Mirrors Go's execution.Trace (trace.go + trace_workflow.go + trace_agent.go):
// auto-detect the type, and for table output render a compact structure view —
// workflow task rows (status icon, name, duration, type, error) or the agent's
// tool-call timeline. For yaml/json, defer to the standard proto renderers so
// `trace -o json` and `get -o json` produce the identical envelope.

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { WorkflowExecution, WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { renderProtoJson, renderProtoYaml } from "../output/index.js";
import { type Styler, shouldColorize, styler } from "../output/style.js";
import { calculateDuration, formatWorkflowTaskType, truncateWithEllipsis } from "./execution-format.js";
import { formatAgentPhase, formatWorkflowPhase, resolveExecutionType } from "./execution.js";

/** Output format for trace: a compact structure table, or the full proto envelope. */
export type TraceFormat = "table" | "yaml" | "json";

export interface TraceStreams {
  write(text: string): void;
  readonly colorize: boolean;
}

/** Fetch and render an execution's structure. */
export async function traceExecution(
  client: Stigmer,
  executionId: string,
  format: TraceFormat,
  streams: TraceStreams = defaultStreams(),
): Promise<void> {
  if (resolveExecutionType(executionId) === "workflow") {
    const exec = await client.workflowExecution.get(executionId);
    if (format === "yaml") {
      streams.write(renderProtoYaml(WorkflowExecutionSchema, exec));
      return;
    }
    if (format === "json") {
      streams.write(renderProtoJson(WorkflowExecutionSchema, exec));
      return;
    }
    renderWorkflowTrace(exec, streams);
    return;
  }

  const exec = await client.agentExecution.get(executionId);
  if (format === "yaml") {
    streams.write(renderProtoYaml(AgentExecutionSchema, exec));
    return;
  }
  if (format === "json") {
    streams.write(renderProtoJson(AgentExecutionSchema, exec));
    return;
  }
  renderAgentTrace(exec, streams);
}

function renderWorkflowTrace(exec: WorkflowExecution, streams: TraceStreams): void {
  const style = styler(streams.colorize);
  const name = exec.metadata?.name || exec.metadata?.id || "";
  const phase = formatWorkflowPhase(exec.status?.phase ?? 0);
  const duration = calculateDuration(exec.status?.startedAt ?? "", exec.status?.completedAt ?? "");

  streams.write(`\nWorkflow: ${name} (${phase}, ${duration})\n\n`);

  const tasks = exec.status?.tasks ?? [];
  if (tasks.length === 0) {
    streams.write("  (no tasks recorded)\n\n");
    return;
  }
  for (const task of tasks) renderWorkflowTraceTask(task, style, streams);
  streams.write("\n");
}

function renderWorkflowTraceTask(task: WorkflowTask, style: Styler, streams: TraceStreams): void {
  const icon = workflowTaskStatusIcon(task.status, style);
  const taskName = task.taskName || task.taskId;
  const duration = calculateDuration(task.startedAt, task.completedAt);
  const taskType = style.dim(formatWorkflowTaskType(task.taskType));

  streams.write(`  ${icon} ${pad(truncateWithEllipsis(taskName, 25), 25)}  ${pad(duration, 8)}  ${taskType}\n`);
  if (task.error !== "") {
    streams.write(`       ${style.red(truncateWithEllipsis(task.error, 70))}\n`);
  }
}

function workflowTaskStatusIcon(status: WorkflowTaskStatus, style: Styler): string {
  switch (status) {
    case WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED:
      return style.green("[done]");
    case WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS:
      return style.cyan("[run ]");
    case WorkflowTaskStatus.WORKFLOW_TASK_PENDING:
      return style.dim("[    ]");
    case WorkflowTaskStatus.WORKFLOW_TASK_FAILED:
      return style.red("[fail]");
    case WorkflowTaskStatus.WORKFLOW_TASK_SKIPPED:
      return style.dim("[skip]");
    case WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL:
      return style.yellow("[wait]");
    default:
      return "[ ?? ]";
  }
}

function renderAgentTrace(exec: AgentExecution, streams: TraceStreams): void {
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
function extractToolCallSummaries(exec: AgentExecution): ToolCallSummary[] {
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
