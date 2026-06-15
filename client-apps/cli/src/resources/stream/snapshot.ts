// Historical replay: stored executions → the same StreamEvent sequence the live
// differ produces. The headless analog of Go's snapshotToEvents
// (run_stream_snapshot.go). Resume's completed-session path feeds these events
// to the NDJSON/plaintext renderers so noise suppression, tool lifecycle badges,
// and interleaving all apply identically to a live run.
//
// Unlike the live differ, there is no cross-snapshot state: each execution's
// final state is a complete picture, so we walk messages once and emit a single
// todo snapshot. Only the last execution emits `done` (so the Ink composer
// activates for follow-ups; headless renderers ignore intermediate dones).

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  collectToolCallsFromMessages,
  convertProtoTodos,
  convertToolCall,
  isApprovalNoiseMessage,
  isTerminalToolStatus,
  mapPhaseToString,
  mapToolCallStatus,
  sanitizeSystemContent,
} from "./convert.js";
import type { StreamEvent } from "./events.js";
import { SubAgentTracking } from "./subagent.js";

/**
 * Convert stored executions (chronological, oldest first) into a flat event
 * sequence. Only the final execution emits a `done` event.
 */
export function snapshotToEvents(executions: readonly AgentExecution[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  executions.forEach((exec, i) => {
    emitSnapshotEvents(out, exec, i === executions.length - 1);
  });
  return out;
}

// Project one stored execution's final state into events. Mirrors Go's
// emitSnapshotEvents: spec message → interleaved messages + tools → trailing
// non-message tools → sub-agents → todos → (optional) done.
function emitSnapshotEvents(out: StreamEvent[], exec: AgentExecution, emitDone: boolean): void {
  const status = exec.status;
  const messages = status?.messages ?? [];

  const allToolCalls = collectToolCallsFromMessages(messages);
  const toolCallById = new Map<string, ToolCall>();
  for (const tc of allToolCalls) {
    if (tc.id !== "") toolCallById.set(tc.id, tc);
  }

  const messageToolIds = collectMessageToolIds(messages);
  const nonMsgToolCalls = sortByStartedAt(allToolCalls.filter((tc) => tc.id !== "" && !messageToolIds.has(tc.id)));

  // The user's prompt for this execution (the "execute" placeholder is hidden).
  const specMessage = exec.spec?.message ?? "";
  if (specMessage !== "" && specMessage !== "execute") {
    out.push({ kind: "humanMessage", content: specMessage });
  }

  const emitted = new Set<string>();
  let cursor = 0;

  for (const msg of messages) {
    cursor = emitInterleaved(out, nonMsgToolCalls, cursor, msg.timestamp, emitted);

    switch (msg.type) {
      case MessageType.MESSAGE_HUMAN:
        break; // already emitted via spec.message
      case MessageType.MESSAGE_TOOL:
        emitToolMessage(out, msg, toolCallById, emitted);
        break;
      case MessageType.MESSAGE_AI:
        out.push({ kind: "aiMessage", content: msg.content, toolCalls: [], subAgentId: "" });
        break;
      default:
        emitOtherMessage(out, msg);
    }
  }

  // Non-message tools that started after every message (or had no timestamp).
  for (; cursor < nonMsgToolCalls.length; cursor++) {
    const tc = nonMsgToolCalls[cursor];
    if (!emitted.has(tc.id)) {
      emitToolByStatus(out, tc);
      emitted.add(tc.id);
    }
  }

  const subAgents = status?.subAgentExecutions ?? [];
  if (subAgents.length > 0) out.push(...new SubAgentTracking().emit(subAgents));

  const todos = convertProtoTodos(status?.todos ?? {});
  if (todos.length > 0) out.push({ kind: "todoUpdate", todos });

  if (emitDone) {
    out.push({ kind: "done", phase: mapPhaseToString(status?.phase ?? 0), error: status?.error ?? "" });
  }
}

// Emit non-message tool calls whose started_at is at/before the message's
// timestamp, advancing the cursor. Mirrors Go's emitInterleaved.
function emitInterleaved(
  out: StreamEvent[],
  toolCalls: readonly ToolCall[],
  cursor: number,
  msgTimestamp: string,
  emitted: Set<string>,
): number {
  let i = cursor;
  while (i < toolCalls.length) {
    const tc = toolCalls[i];
    if (tc.startedAt === "") break; // no timestamp — defer to the end
    if (msgTimestamp === "" || tc.startedAt > msgTimestamp) break;
    if (!emitted.has(tc.id)) {
      emitToolByStatus(out, tc);
      emitted.add(tc.id);
    }
    i++;
  }
  return i;
}

// Promote a MESSAGE_TOOL into stateful tool events using the full tool-call
// data. Mirrors Go's emitToolMessageAsStateful (falls back to other-message
// handling when the message carries no tool refs).
function emitToolMessage(
  out: StreamEvent[],
  msg: AgentMessage,
  toolCallById: Map<string, ToolCall>,
  emitted: Set<string>,
): void {
  if (msg.toolCalls.length === 0) {
    emitOtherMessage(out, msg);
    return;
  }
  for (const ref of msg.toolCalls) {
    if (ref.id === "" || emitted.has(ref.id)) continue;
    const full = toolCallById.get(ref.id) ?? ref;
    emitToolByStatus(out, full);
    emitted.add(full.id);
  }
}

// SYSTEM (with noise suppression + sanitize) and any unexpected type. Mirrors
// the SYSTEM/default arms of Go's emitCompleteMessage.
function emitOtherMessage(out: StreamEvent[], msg: AgentMessage): void {
  if (msg.type === MessageType.MESSAGE_SYSTEM) {
    if (isApprovalNoiseMessage(msg.content)) return;
    out.push({ kind: "systemMessage", content: sanitizeSystemContent(msg.content) });
    return;
  }
  out.push({ kind: "systemMessage", content: `Unknown message: ${msg.content}` });
}

// Emit the right tool event for a tool call's final status. Mirrors Go's
// emitToolEventByStatus.
function emitToolByStatus(out: StreamEvent[], tc: ToolCall): void {
  const status = mapToolCallStatus(tc.status);
  const toolCall = convertToolCall(tc);
  if (isTerminalToolStatus(status)) {
    out.push({ kind: "toolCompleted", toolCallId: tc.id, toolCall, subAgentId: "" });
  } else if (status === "waiting_approval") {
    out.push({ kind: "toolWaitingApproval", toolCallId: tc.id, toolCall, subAgentId: "" });
  } else {
    out.push({ kind: "toolRunning", toolCallId: tc.id, toolCall, subAgentId: "" });
  }
}

// Tool-call IDs referenced by MESSAGE_TOOL entries (Go's collectMessageToolIDs).
function collectMessageToolIds(messages: readonly AgentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg.type !== MessageType.MESSAGE_TOOL) continue;
    for (const tc of msg.toolCalls) {
      if (tc.id !== "") ids.add(tc.id);
    }
  }
  return ids;
}

// Sort by started_at ascending; empty timestamps sort to the end. Mirrors the
// sort.Slice predicate in emitSnapshotEvents.
function sortByStartedAt(toolCalls: ToolCall[]): ToolCall[] {
  return [...toolCalls].sort((a, b) => {
    if (a.startedAt === "") return 1;
    if (b.startedAt === "") return -1;
    return a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0;
  });
}
