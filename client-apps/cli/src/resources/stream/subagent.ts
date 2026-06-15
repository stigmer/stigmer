// Sub-agent activity tracking for the snapshot differ.
//
// Ports the Go CLI's run_stream_subagent.go. Each sub-agent execution has its
// own message cursor and tool-state tracker (its data arrays grow independently
// of the top-level status), so this module keeps a per-sub-agent tracker keyed
// by sub-agent ID and emits started/message/tool/completed events with the
// sub-agent ID set for nested rendering.

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  collectToolCallsFromMessages,
  isTerminalSubAgentStatus,
  subAgentStatusName,
} from "./convert.js";
import type { StreamEvent } from "./events.js";
import { ToolStateTracker } from "./tool-state.js";

// Per-sub-agent cursor state. Mirrors Go's subAgentTracker.
interface SubAgentCursor {
  displayedMsgCount: number;
  inStream: boolean;
  readonly tools: ToolStateTracker;
  completed: boolean;
}

/**
 * Tracks every sub-agent across snapshots, emitting started/message/tool/
 * completed events. Holds one cursor per sub-agent ID, persisting across calls.
 */
export class SubAgentTracking {
  private readonly cursors = new Map<string, SubAgentCursor>();

  /** Process all sub-agent executions in a snapshot. Mirrors Go's emitSubAgentEvents. */
  emit(subAgents: readonly SubAgentExecution[]): StreamEvent[] {
    const out: StreamEvent[] = [];

    for (const sa of subAgents) {
      if (sa.id === "") continue;

      let cursor = this.cursors.get(sa.id);
      if (cursor === undefined) {
        cursor = { displayedMsgCount: 0, inStream: false, tools: new ToolStateTracker(), completed: false };
        this.cursors.set(sa.id, cursor);
        out.push({ kind: "subAgentStarted", id: sa.id, name: sa.name, description: sa.subject, input: sa.input });
      }

      const toolEvents = cursor.tools.track(collectToolCallsFromMessages(sa.messages), sa.id);
      emitSubAgentMessages(out, sa.id, sa.messages, cursor);
      out.push(...toolEvents);

      if (!cursor.completed && isTerminalSubAgentStatus(sa.status)) {
        cursor.completed = true;
        out.push({
          kind: "subAgentCompleted",
          id: sa.id,
          status: subAgentStatusName(sa.status),
          toolCount: collectToolCallsFromMessages(sa.messages).length,
          output: sa.output,
        });
      }
    }

    return out;
  }
}

// Emit new sub-agent messages, streaming AI messages incrementally. Tool results
// are owned by the tool-state tracker, so MESSAGE_TOOL entries are skipped, and
// AI tool-call lists are omitted to avoid duplicating the stateful tool blocks.
// Mirrors Go's emitSubAgentMessageEvents.
function emitSubAgentMessages(
  out: StreamEvent[],
  subAgentId: string,
  messages: readonly AgentMessage[],
  cursor: SubAgentCursor,
): void {
  // Phase 1: an in-progress streaming AI message.
  if (cursor.inStream && cursor.displayedMsgCount < messages.length) {
    const msg = messages[cursor.displayedMsgCount];
    if (msg.isStreaming) {
      out.push({ kind: "aiStreamDelta", content: msg.content, subAgentId });
      return;
    }
    out.push({ kind: "aiStreamEnd", content: msg.content, toolCalls: [], subAgentId });
    cursor.displayedMsgCount++;
    cursor.inStream = false;
  }

  // Phase 2: complete messages, detecting a new streaming start.
  while (cursor.displayedMsgCount < messages.length) {
    const msg = messages[cursor.displayedMsgCount];
    if (msg.isStreaming && msg.type === MessageType.MESSAGE_AI) {
      out.push({ kind: "aiStreamStart", content: msg.content, subAgentId });
      cursor.inStream = true;
      return;
    }
    if (msg.type === MessageType.MESSAGE_AI && msg.content !== "") {
      out.push({ kind: "aiMessage", content: msg.content, toolCalls: [], subAgentId });
    }
    cursor.displayedMsgCount++;
  }
}
