/**
 * TranscriptState — the AgentExecutionStatus proto `TranscriptBuilder` is
 * building into, held as one {@link Transcript} per scope: the root's over
 * `status.messages`, and one per sub-agent over its row's `messages`.
 *
 * Indexes, not copies: every map value is the live proto object (a ToolCall
 * inside a message's repeated field, an AgentMessage inside a `messages`
 * array), so a mutation through the index IS the mutation of the proto, and
 * nothing here can drift from what is persisted. The arrays themselves are
 * the status's own, pushed into and never replaced, so a caller that seeded
 * them from the persisted transcript (the turn runtime's
 * `seedFromPersistedStatus`) and every wrapper of the status keep seeing
 * every row.
 *
 * One shape for every scope (S4 M2 C4, Q-S4-4; plan finding F-M2-15): until
 * C4 the root's indexes lived here keyed by LangGraph namespace and the
 * sub-agents' in a second module with its own copies of the same maps and
 * handlers (`subagent-tracker.ts`, deleted at C4). Scope is `subAgentId?`
 * now and the namespace key collapsed — the tracker already resolved every
 * local namespace to `""` — so a transcript's "current AI message" and
 * "last run" are single values.
 *
 * The name says what it holds — the transcript's bookkeeping, not the
 * execution's state, which is the turn runtime's (`harness/turn-context.ts`);
 * it was `ExecutionState` in the native adapter (renamed at S4 M1, Q-M1-3).
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";

/**
 * One scope's transcript: the `messages[]` it folds into (by reference) and
 * the live indexes over it. Seeded rows are indexed at construction so a
 * re-emitted event reconciles onto the existing row instead of duplicating
 * it (the durable-checkpoint resume; the memory-checkpointer replay).
 */
export class Transcript {
  /** tool_call_id → the live ToolCall inside one of this transcript's messages. */
  readonly toolCalls = new Map<string, ToolCall>();

  /**
   * runId → the AgentMessage that run streams into (a THINKING row under
   * its own key), so two runs' tokens never interleave.
   */
  readonly messagesByRun = new Map<string, AgentMessage>();

  /**
   * The AI message a tool row attaches to — the latest message with text in
   * this scope (Q-S4-5). Over a seeded transcript it starts as the seed's
   * last AI message (Q-M2-2): the message that proposed a call is still the
   * one that proposed it across a turn boundary, which is also Cursor's
   * shape (`findOrCreateLastAiMessage`).
   */
  currentAiMessage: AgentMessage | undefined;

  /** The latest LLM run in this scope, for closing the previous message's streaming flag when a new run starts. */
  lastRunId: string | undefined;

  /** Progressive tool-call argument JSON, accumulated per callId until it parses. */
  readonly argBuffers = new Map<string, string>();

  constructor(readonly messages: AgentMessage[]) {
    for (const message of messages) {
      for (const tc of message.toolCalls) {
        if (tc.id) this.toolCalls.set(tc.id, tc);
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === MessageType.MESSAGE_AI) {
        this.currentAiMessage = messages[i];
        break;
      }
    }
  }
}

/** A sub-agent's row and the transcript folded into it. */
export interface SubAgentScope {
  readonly row: SubAgentExecution;
  readonly transcript: Transcript;
}

export class TranscriptState {
  /** The protobuf projection being built. */
  readonly proto: AgentExecutionStatus;

  /** The root transcript, over `proto.messages`. */
  readonly root: Transcript;

  private readonly subAgentsById = new Map<string, SubAgentScope>();

  /**
   * Indexes the status as handed: the root's messages and every seeded
   * sub-agent row (a reinvocation's seed carries prior turns' rows, whose
   * events may be re-driven).
   */
  constructor(proto: AgentExecutionStatus) {
    this.proto = proto;
    this.root = new Transcript(proto.messages);
    for (const row of proto.subAgentExecutions) {
      this.subAgentsById.set(row.id, { row, transcript: new Transcript(row.messages) });
    }
  }

  /** The transcript an event folds into: the root's for no `subAgentId`, a sub-agent's for a known one, `undefined` for an unknown one. */
  scope(subAgentId: string | undefined): Transcript | undefined {
    if (subAgentId === undefined) return this.root;
    return this.subAgentsById.get(subAgentId)?.transcript;
  }

  subAgent(subAgentId: string): SubAgentScope | undefined {
    return this.subAgentsById.get(subAgentId);
  }

  /** Push a new sub-agent row onto the status and open its transcript. The caller checks the id is new. */
  openSubAgent(row: SubAgentExecution): SubAgentScope {
    this.proto.subAgentExecutions.push(row);
    const scope = { row, transcript: new Transcript(row.messages) };
    this.subAgentsById.set(row.id, scope);
    return scope;
  }

  /** Every transcript, the root's first — for the rules that sweep them all (`finalize`). */
  *transcripts(): IterableIterator<Transcript> {
    yield this.root;
    for (const { transcript } of this.subAgentsById.values()) yield transcript;
  }
}
