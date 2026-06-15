// `execution logs` — event/message stream for an execution (agent or workflow).
//
// Mirrors Go's execution.WorkflowLogs + AgentLogs (logs_workflow.go /
// logs_agent.go). The two execution families consume different primitives, and
// that asymmetry is intentional:
//
//   - Workflows have a canonical, sequenced event log. Non-follow reads it via
//     getEventLog (paginated); follow tails it via subscribeEvents. Both render
//     through the shared workflow event renderer, so `logs` and `run workflow`
//     speak the same vocabulary.
//   - Agents have no event stream — only status snapshots (subscribe). So agent
//     follow diffs the message list across snapshots (lastMsgCount) and stops on
//     a terminal phase, exactly as Go does; non-follow prints the message list
//     from a single Get.
//
// Ctrl-C ends a follow cleanly: the SIGINT aborts the subscription and we treat
// the abort as a normal exit (no stack trace).

import { create } from "@bufbuild/protobuf";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  GetEventLogRequestSchema,
  SubscribeEventsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { shouldColorize, styler } from "../output/style.js";
import { formatAgentPhase, isTerminalAgentPhase, resolveExecutionType } from "./execution.js";
import { type LineSink, renderWorkflowEventPlaintext } from "./stream/workflow-render-plaintext.js";

const EVENT_LOG_PAGE_SIZE = 50;
const MAX_AGENT_MESSAGE_LEN = 200;

export interface LogsOptions {
  readonly executionId: string;
  readonly follow: boolean;
  /** Workflow-only: filter events by task name. */
  readonly task?: string;
}

/** A line sink + a signal that the caller can abort (SIGINT). */
export interface LogsStreams {
  readonly out: LineSink;
  readonly colorize: boolean;
}

/** Stream or print logs for an execution. `signal` aborts a follow cleanly. */
export async function streamExecutionLogs(
  client: Stigmer,
  opts: LogsOptions,
  signal: AbortSignal,
  streams: LogsStreams = defaultStreams(),
): Promise<void> {
  const type = resolveExecutionType(opts.executionId);
  if (type === "workflow") {
    await (opts.follow ? followWorkflowLogs(client, opts, signal, streams) : printWorkflowLog(client, opts, streams));
    return;
  }
  await (opts.follow ? followAgentLogs(client, opts, signal, streams) : printAgentMessages(client, opts, streams));
}

async function printWorkflowLog(client: Stigmer, opts: LogsOptions, streams: LogsStreams): Promise<void> {
  const resp = await client.workflowExecution.getEventLog(
    create(GetEventLogRequestSchema, {
      executionId: opts.executionId,
      pageSize: EVENT_LOG_PAGE_SIZE,
      ...(opts.task ? { taskName: opts.task } : {}),
    }),
  );
  if (resp.events.length === 0) {
    streams.out.write("No events recorded for this execution.\n");
    return;
  }
  for (const event of resp.events) renderWorkflowEventPlaintext(event, streams.out, streams.colorize);
  if (resp.hasMore) {
    streams.out.write(`\n... more events available (showing first ${resp.events.length})\n`);
  }
}

async function followWorkflowLogs(
  client: Stigmer,
  opts: LogsOptions,
  signal: AbortSignal,
  streams: LogsStreams,
): Promise<void> {
  const stream = client.workflowExecution.subscribeEvents(
    create(SubscribeEventsRequestSchema, { executionId: opts.executionId }),
    signal,
  );
  try {
    for await (const event of stream) {
      // Client-side task filter, matching Go's streamWorkflowEvents.
      if (opts.task !== undefined && opts.task !== "" && event.taskName !== opts.task) continue;
      renderWorkflowEventPlaintext(event, streams.out, streams.colorize);
    }
    streams.out.write("\n--- stream ended ---\n");
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}

async function printAgentMessages(client: Stigmer, opts: LogsOptions, streams: LogsStreams): Promise<void> {
  const exec = await client.agentExecution.get(opts.executionId);
  const messages = exec.status?.messages ?? [];
  if (messages.length === 0) {
    streams.out.write("No messages recorded for this execution.\n");
    return;
  }
  for (const message of messages) renderAgentMessage(message, streams);
}

async function followAgentLogs(
  client: Stigmer,
  opts: LogsOptions,
  signal: AbortSignal,
  streams: LogsStreams,
): Promise<void> {
  let lastMsgCount = 0;
  try {
    for await (const exec of client.agentExecution.subscribe(opts.executionId, signal)) {
      const messages = exec.status?.messages ?? [];
      for (let i = lastMsgCount; i < messages.length; i++) renderAgentMessage(messages[i], streams);
      lastMsgCount = messages.length;

      const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      if (isTerminalAgentPhase(phase)) {
        const style = styler(streams.colorize);
        streams.out.write(`\n${style.dim("[end]")} execution ${formatAgentPhase(phase)}\n`);
        return;
      }
    }
    streams.out.write("\n--- stream ended ---\n");
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
}

// Port of Go's renderAgentMessage: a colored type label + truncated content.
function renderAgentMessage(message: AgentMessage, streams: LogsStreams): void {
  const style = styler(streams.colorize);
  const { label, tint } = agentMessageLabel(message.type, style);
  const content = truncate(message.content, MAX_AGENT_MESSAGE_LEN);
  streams.out.write(`[${tint(label)}] ${content}\n`);
}

function agentMessageLabel(
  type: MessageType,
  style: ReturnType<typeof styler>,
): { label: string; tint: (text: string) => string } {
  switch (type) {
    case MessageType.MESSAGE_HUMAN:
      return { label: "human", tint: style.cyan };
    case MessageType.MESSAGE_AI:
      return { label: "ai", tint: style.green };
    case MessageType.MESSAGE_TOOL:
      return { label: "tool", tint: style.cyan };
    case MessageType.MESSAGE_SYSTEM:
      return { label: "system", tint: style.yellow };
    default:
      return { label: "unknown", tint: style.dim };
  }
}

// Mirrors Go's 200-char content cap (197 + "...").
function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
}

function defaultStreams(): LogsStreams {
  return {
    out: { write: (line: string) => void process.stdout.write(line) },
    colorize: shouldColorize(process.stdout),
  };
}
