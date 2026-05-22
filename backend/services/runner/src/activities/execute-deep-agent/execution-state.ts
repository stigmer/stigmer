/**
 * Mutable execution state for the StatusBuilder.
 *
 * Holds the AgentExecutionStatus proto being progressively built and
 * O(1) lookup indexes into its repeated fields. Mutations to indexed
 * references (ToolCall, AgentMessage) propagate directly to the proto
 * because they share the same object reference.
 *
 * Phase 3b-i scope: core indexes for main-agent streaming.
 * Sub-agent routing maps and approval tracking are added in Phase 3c.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

export class ExecutionState {
  /** The protobuf projection being built. */
  readonly proto: AgentExecutionStatus;

  /**
   * tool_call_id -> live ToolCall reference inside a message's repeated
   * field. Mutations propagate directly to the proto.
   */
  readonly toolCalls: Map<string, ToolCall> = new Map();

  /**
   * LLM run_id -> the AgentMessage that run is streaming into.
   * Prevents token interleaving when the model produces multiple runs.
   */
  readonly messagesByRun: Map<string, AgentMessage> = new Map();

  /**
   * Namespace -> most recently created AI message in that execution
   * context. Tool calls are appended to this message's toolCalls field.
   * Empty string key represents the main agent.
   */
  readonly currentAiMessage: Map<string, AgentMessage> = new Map();

  /**
   * Namespace -> latest LLM run_id for turn-boundary detection.
   * When a new run_id appears in the same namespace, a new AgentMessage
   * is created rather than appending to the existing one.
   */
  readonly lastLlmRunId: Map<string, string> = new Map();

  /**
   * Tool run_id -> monotonic start time (ms) for duration calculation.
   * Set on on_tool_start, consumed and removed on on_tool_end.
   */
  readonly toolStartTimes: Map<string, number> = new Map();

  constructor(proto: AgentExecutionStatus) {
    this.proto = proto;
  }

  /**
   * Reset all ephemeral indexes. The proto itself is not cleared —
   * this is used when resuming from a persisted status where the proto
   * already has messages and tool calls, but runtime tracking state
   * (run_id maps, timing) must start fresh.
   */
  resetEphemeralState(): void {
    this.messagesByRun.clear();
    this.currentAiMessage.clear();
    this.lastLlmRunId.clear();
    this.toolStartTimes.clear();
  }

  /**
   * Rebuild the toolCalls index from the proto's messages.
   *
   * Used on the resume path where the StatusBuilder is initialized
   * with a persisted AgentExecutionStatus that already contains
   * messages and tool calls. Only proto-derivable indexes are rebuilt;
   * ephemeral runtime state starts fresh.
   */
  rebuildToolCallIndex(): void {
    this.toolCalls.clear();
    for (const message of this.proto.messages) {
      for (const tc of message.toolCalls) {
        if (tc.id) {
          this.toolCalls.set(tc.id, tc);
        }
      }
    }
  }
}
