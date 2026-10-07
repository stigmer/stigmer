// `runs logs` — the message stream for a run.
//
// Mirrors Go's execution.AgentLogs (logs_agent.go). A run has no event log,
// only status snapshots (subscribe): follow diffs the message list across
// snapshots (lastMsgCount) and stops on a terminal phase, exactly as Go does;
// non-follow prints the message list from a single Get.
//
// Ctrl-C ends a follow cleanly: the SIGINT aborts the subscription and we treat
// the abort as a normal exit (no stack trace).

import { RunPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";
import type { Stigmer } from "@stigmer/sdk";
import { shouldColorize, styler } from "../output/style.js";
import { formatAgentPhase, isTerminalAgentPhase } from "./runs.js";

const MAX_AGENT_MESSAGE_LEN = 200;

export interface LogsOptions {
  readonly runId: string;
  readonly follow: boolean;
}

/** Where rendered log lines go. */
export interface LineSink {
  write(line: string): void;
}

/** A line sink + a signal that the caller can abort (SIGINT). */
export interface LogsStreams {
  readonly out: LineSink;
  readonly colorize: boolean;
}

/** Stream or print logs for a run. `signal` aborts a follow cleanly. */
export async function streamRunLogs(
  client: Stigmer,
  opts: LogsOptions,
  signal: AbortSignal,
  streams: LogsStreams = defaultStreams(),
): Promise<void> {
  await (opts.follow ? followAgentLogs(client, opts, signal, streams) : printAgentMessages(client, opts, streams));
}

async function printAgentMessages(client: Stigmer, opts: LogsOptions, streams: LogsStreams): Promise<void> {
  const exec = await client.run.get(opts.runId);
  const messages = exec.status?.messages ?? [];
  if (messages.length === 0) {
    streams.out.write("No messages recorded for this run.\n");
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
    for await (const exec of client.run.subscribe(opts.runId, signal)) {
      const messages = exec.status?.messages ?? [];
      for (let i = lastMsgCount; i < messages.length; i++) renderAgentMessage(messages[i], streams);
      lastMsgCount = messages.length;

      const phase = exec.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
      if (isTerminalAgentPhase(phase)) {
        const style = styler(streams.colorize);
        streams.out.write(`\n${style.dim("[end]")} run ${formatAgentPhase(phase)}\n`);
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
