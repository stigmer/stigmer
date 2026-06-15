// NDJSON headless renderer: StreamEvent → Go's run --json wire taxonomy.
//
// Mirrors run_stream_json.go's handleJSONEvent one case at a time — the event
// `type` strings and payload keys are a parity contract (DD-005). The envelope
// + payload cleaning live in output/ndjson.ts; this module only maps events to
// `{type, payload}` and applies the headless approval policy.

import { ndjsonEnvelope, writeNdjson } from "../../output/ndjson.js";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCallInfo, ApprovalNeededEvent, StreamEvent } from "./events.js";
import type { HeadlessRenderer } from "./headless.js";

/** A minimal output sink (process.stdout/stderr or a test buffer). */
export interface LineWriter {
  write(chunk: string): unknown;
}

export interface NdjsonRendererOptions {
  /** NDJSON event lines (stdout). */
  readonly data: LineWriter;
  /** Fatal/auto-skip diagnostics (stderr). */
  readonly status: LineWriter;
  /** Approval default; UNSPECIFIED means auto-skip with a warning. */
  readonly defaultAction: ApprovalAction;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => string;
}

/** Writes one `{type, ts, payload}` line per event; auto-resolves approvals. */
export class NdjsonRenderer implements HeadlessRenderer {
  constructor(private readonly opts: NdjsonRendererOptions) {}

  render(event: StreamEvent): void {
    const mapped = mapToNdjson(event);
    if (mapped !== undefined) {
      writeNdjson(this.opts.data, ndjsonEnvelope(mapped.type, mapped.payload, this.opts.now));
    }
  }

  // JSON mode has no interactive prompt: honor --approve-default, else skip with
  // a warning to stderr. Mirrors run_stream_json.go's resolveJSONApproval.
  resolveApproval(event: ApprovalNeededEvent): ApprovalAction {
    if (this.opts.defaultAction === ApprovalAction.UNSPECIFIED) {
      this.opts.status.write(`⚠ No --approve-default set; auto-skipping approval for ${event.toolName}\n`);
      return ApprovalAction.SKIP;
    }
    return this.opts.defaultAction;
  }
}

interface MappedEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

// Map one event to its NDJSON type + raw payload (cleaned later). The arms are
// 1:1 with handleJSONEvent so the wire output stays byte-faithful.
function mapToNdjson(event: StreamEvent): MappedEvent | undefined {
  switch (event.kind) {
    case "aiStreamStart":
      return { type: "ai_stream_start", payload: { content: event.content, sub_agent_id: event.subAgentId } };
    case "aiStreamDelta":
      return { type: "ai_stream_delta", payload: { content: event.content, sub_agent_id: event.subAgentId } };
    case "aiStreamEnd":
      return {
        type: "ai_stream_end",
        payload: { content: event.content, tool_calls: toolCallsToJson(event.toolCalls), sub_agent_id: event.subAgentId },
      };
    case "aiMessage":
      return {
        type: "ai_message",
        payload: { content: event.content, tool_calls: toolCallsToJson(event.toolCalls), sub_agent_id: event.subAgentId },
      };
    case "humanMessage":
      return { type: "human_message", payload: { content: event.content } };
    case "toolRunning":
      return { type: "tool_running", payload: toolEventPayload(event.toolCallId, event.toolCall, event.subAgentId) };
    case "toolCompleted":
      return { type: "tool_completed", payload: toolEventPayload(event.toolCallId, event.toolCall, event.subAgentId) };
    case "toolWaitingApproval":
      return {
        type: "tool_waiting_approval",
        payload: toolEventPayload(event.toolCallId, event.toolCall, event.subAgentId),
      };
    case "toolStreamDelta":
      return {
        type: "tool_stream_delta",
        payload: {
          tool_call_id: event.toolCallId,
          tool_name: event.toolCall.name,
          content: event.content,
          sub_agent_id: event.subAgentId,
        },
      };
    case "systemMessage":
      return { type: "system_message", payload: { content: event.content } };
    case "phaseChange":
      return { type: "phase_change", payload: { phase: event.phase, previous: event.previous } };
    case "approvalNeeded":
      return {
        type: "approval_needed",
        payload: {
          tool_call_id: event.toolCallId,
          tool_name: event.toolName,
          args_preview: event.argsPreview,
          message: event.message,
          from_sub_agent: event.fromSubAgent,
          sub_agent_name: event.subAgentName,
        },
      };
    case "todoUpdate":
      return {
        type: "todo_update",
        payload: { todos: event.todos.map((t) => ({ id: t.id, content: t.content, status: t.status })) },
      };
    case "contextCompacted":
      return {
        type: "context_compacted",
        payload: {
          source: event.source,
          tokens_before: event.tokensBefore,
          tokens_after: event.tokensAfter,
          compression_ratio: event.compressionRatio,
          duration_ms: event.durationMs,
          messages_before: event.messagesBefore,
          messages_after: event.messagesAfter,
        },
      };
    case "subAgentStarted":
      return {
        type: "sub_agent_started",
        payload: { id: event.id, name: event.name, description: event.description },
      };
    case "subAgentCompleted":
      return {
        type: "sub_agent_completed",
        payload: { id: event.id, status: event.status, tool_count: event.toolCount, output: event.output },
      };
    case "done":
      return { type: "done", payload: { phase: event.phase, error: event.error } };
    case "streamError":
      return { type: "stream_error", payload: { error: event.error } };
  }
}

// The shared payload for tool-lifecycle events. Mirrors Go's toolEventPayload:
// args/result/error/duration are only present when meaningful. Empty strings are
// stripped later by cleanNdjsonPayload.
function toolEventPayload(toolCallId: string, tc: ToolCallInfo, subAgentId: string): Record<string, unknown> {
  return {
    tool_call_id: toolCallId,
    tool_name: tc.name,
    status: tc.status,
    sub_agent_id: subAgentId,
    args: tc.args,
    result: tc.result,
    error: tc.error,
    duration_ms: tc.durationMs > 0 ? tc.durationMs : undefined,
  };
}

// Convert a tool-call list to JSON maps, returning undefined for an empty list
// (so the field is dropped). Inner maps keep name+status; the rest are omitted
// when empty. Mirrors Go's toolCallsToJSON.
function toolCallsToJson(tcs: readonly ToolCallInfo[]): Array<Record<string, unknown>> | undefined {
  if (tcs.length === 0) return undefined;
  return tcs.map((tc) => {
    const m: Record<string, unknown> = { name: tc.name, status: tc.status };
    if (tc.id !== "") m.id = tc.id;
    if (tc.args !== undefined) m.args = tc.args;
    if (tc.result !== "") m.result = tc.result;
    if (tc.error !== "") m.error = tc.error;
    if (tc.durationMs > 0) m.duration_ms = tc.durationMs;
    return m;
  });
}
