/**
 * TranscriptState — the AgentExecutionStatus proto `TranscriptBuilder` is
 * building into, and the O(1) indexes over its repeated fields the builder
 * folds through.
 *
 * Indexes, not copies: every map value is the live proto object (a ToolCall
 * inside a message's repeated field, an AgentMessage inside `messages`), so
 * a mutation through the index IS the mutation of the proto, and nothing here
 * can drift from what is persisted. The name says what it holds — the
 * transcript's bookkeeping, not the execution's state, which is the turn
 * runtime's (`harness/turn-context.ts`); it was `ExecutionState` in the
 * native adapter and was renamed with the move (S4 M1, Q-M1-3). Sub-agent
 * transcripts are `SubAgentTracker`'s, keyed by namespace beside this state,
 * until M2 folds them into one scoped set (Q-S4-4).
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

export class TranscriptState {
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
  }

  /**
   * Rebuild the toolCalls index from the proto's messages.
   *
   * Used on the resume path where the TranscriptBuilder is initialized
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
