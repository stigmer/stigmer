// Tool-call state-transition tracking for the snapshot differ.
//
// Ports the Go CLI's trackToolCallStates (run_stream_events.go:597-695). Each
// snapshot carries the full tool-call list; this tracker diffs it against the
// last-known per-tool status/result to emit only the *transitions* (running,
// completed, waiting-approval, streaming delta). One tracker instance per scope:
// the top-level execution gets one, each sub-agent gets its own (matching Go's
// per-sub-agent tracker maps).

import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { convertToolCall, isTerminalToolStatus, mapToolCallStatus } from "./convert.js";
import type { StreamEvent } from "./events.js";

/**
 * Stateful tracker that converts successive tool-call snapshots into discrete
 * lifecycle events. The state (last status + last streamed result per tool ID)
 * persists across calls, so only genuine transitions produce events.
 */
export class ToolStateTracker {
  // toolCallID -> last known status string.
  private readonly states = new Map<string, string>();
  // toolCallID -> last known result content, for streaming-delta detection.
  private readonly results = new Map<string, string>();

  /**
   * Diff `toolCalls` against tracked state and return the resulting events.
   * `subAgentId` scopes the events for nested rendering ("" for top-level).
   * Mirrors Go's trackToolCallStates branch-for-branch.
   */
  track(toolCalls: readonly ToolCall[], subAgentId: string): StreamEvent[] {
    const pending: StreamEvent[] = [];

    for (const tc of toolCalls) {
      if (tc.id === "") continue;

      const current = mapToolCallStatus(tc.status);
      const seen = this.states.has(tc.id);
      const prev = this.states.get(tc.id);

      // First sight, already running: open a running block.
      if (!seen && current === "running") {
        pending.push(this.running(tc, subAgentId));
        this.states.set(tc.id, current);
        this.results.set(tc.id, tc.result);
        continue;
      }

      // First sight, awaiting approval: open a waiting block.
      if (!seen && current === "waiting_approval") {
        pending.push(this.waiting(tc, subAgentId));
        this.states.set(tc.id, current);
        continue;
      }

      // First sight, already terminal (e.g. re-attach): synthesize completion so
      // the block exists — otherwise its MESSAGE_TOOL is suppressed and it vanishes.
      if (!seen && isTerminalToolStatus(current)) {
        pending.push(this.terminal(tc, current, subAgentId));
        this.states.set(tc.id, current);
        continue;
      }

      // running/waiting -> terminal: close the block.
      if (seen && (prev === "running" || prev === "waiting_approval") && isTerminalToolStatus(current)) {
        pending.push(this.terminal(tc, current, subAgentId));
        this.states.set(tc.id, current);
        this.results.delete(tc.id);
        continue;
      }

      // Any other status change: open running/waiting as appropriate.
      if (current !== prev) {
        if (current === "running") {
          pending.push(this.running(tc, subAgentId));
          this.results.set(tc.id, tc.result);
        } else if (current === "waiting_approval") {
          pending.push(this.waiting(tc, subAgentId));
        }
        this.states.set(tc.id, current);
        continue;
      }

      // Streaming content changed on a running tool: emit a delta.
      if (current === "running" && tc.isStreaming && tc.result !== this.results.get(tc.id)) {
        pending.push({
          kind: "toolStreamDelta",
          toolCallId: tc.id,
          toolCall: convertToolCall(tc),
          content: tc.result,
          subAgentId,
        });
        this.results.set(tc.id, tc.result);
      }
    }

    return pending;
  }

  /**
   * True if `id` has a tracked state, i.e. a stateful block already exists for
   * it. Used to suppress a duplicate ToolResultEvent for a MESSAGE_TOOL the
   * tracker already owns. Mirrors the membership check in Go's isTrackedToolMessage.
   */
  has(id: string): boolean {
    return this.states.has(id);
  }

  private running(tc: ToolCall, subAgentId: string): StreamEvent {
    return { kind: "toolRunning", toolCallId: tc.id, toolCall: convertToolCall(tc), subAgentId };
  }

  private waiting(tc: ToolCall, subAgentId: string): StreamEvent {
    return { kind: "toolWaitingApproval", toolCallId: tc.id, toolCall: convertToolCall(tc), subAgentId };
  }

  // The terminal-close event for a settled status: interrupted gets its own
  // kind (issue #207) so renderers never print a checkmark for a tool the
  // platform cut short; every other terminal status closes as completed.
  private terminal(tc: ToolCall, status: string, subAgentId: string): StreamEvent {
    return {
      kind: status === "interrupted" ? "toolInterrupted" : "toolCompleted",
      toolCallId: tc.id,
      toolCall: convertToolCall(tc),
      subAgentId,
    };
  }
}

/** The tool-call ID carried by a tool-lifecycle event, or "" otherwise. Mirrors Go's toolEventID. */
export function toolEventId(event: StreamEvent): string {
  switch (event.kind) {
    case "toolRunning":
    case "toolCompleted":
    case "toolInterrupted":
    case "toolWaitingApproval":
    case "toolStreamDelta":
      return event.toolCallId;
    default:
      return "";
  }
}

/** Index tool events by tool-call ID for chronological interleaving. Mirrors Go's buildToolEventMap. */
export function buildToolEventMap(events: readonly StreamEvent[]): Map<string, StreamEvent> {
  const m = new Map<string, StreamEvent>();
  for (const ev of events) {
    const id = toolEventId(ev);
    if (id !== "") m.set(id, ev);
  }
  return m;
}
