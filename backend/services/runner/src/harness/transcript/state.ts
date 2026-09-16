/**
 * TranscriptState — the AgentExecutionStatus proto `TranscriptBuilder` is
 * building into, held as one {@link Transcript} per scope: the root's over
 * `status.messages`, and one per sub-agent over its row's `messages`.
 *
 * Indexes, not copies: every map value is the live proto object (a ToolCall
 * inside a message's repeated field, an AgentMessage inside a `messages`
 * array), so a mutation through the index IS the mutation of the proto, and
 * nothing here can drift from what is persisted. The arrays themselves are
 * the status's own, pushed into and never replaced, so every wrapper of the
 * status (the runtime's persist chokepoint, the settle modules that amend
 * rows by identity) keeps seeing every row. A reinvocation's prior rows
 * arrive through {@link TranscriptState.seed} — the turn runtime's
 * `seedFromPersistedStatus` hands them here — so they are indexed by the
 * same routine that indexes a status handed to the constructor.
 *
 * One shape for every scope (since #1097): until then the root's indexes
 * lived here keyed by LangGraph namespace and the
 * sub-agents' in a second module with its own copies of the same maps and
 * handlers (`subagent-tracker.ts`, deleted in #1097). Scope is `subAgentId?`
 * now and the namespace key collapsed — the tracker already resolved every
 * local namespace to `""` — so a transcript's "current AI message" and
 * "last run" are single values.
 *
 * The name says what it holds — the transcript's bookkeeping, not the
 * execution's state, which is the turn runtime's (`harness/turn-context.ts`);
 * it was `ExecutionState` in the native adapter (renamed in #1097).
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
   * this scope. Over a seeded transcript it starts as the seed's
   * last AI message: the message that proposed a call is still the
   * one that proposed it across a turn boundary, which is also Cursor's
   * shape (`findOrCreateLastAiMessage`).
   */
  currentAiMessage: AgentMessage | undefined;

  /** The latest LLM run in this scope, for closing the previous message's streaming flag when a new run starts. */
  lastRunId: string | undefined;

  /** Progressive tool-call argument JSON, accumulated per callId until it parses. */
  readonly argBuffers = new Map<string, string>();

  constructor(readonly messages: AgentMessage[]) {
    for (const message of messages) this.index(message);
  }

  /**
   * Take a message that is already on (or is being appended to) this
   * transcript into the indexes: every row by id, and the message as the
   * current AI message when it is one — the seed's last AI message is the
   * one a resumed turn's first row joins. The one routine behind
   * both ways rows arrive before the stream — the status as handed to the
   * constructor, and the runtime's seed of a reinvocation's prior rows
   * ({@link TranscriptState.seed}) — so neither can index differently.
   */
  index(message: AgentMessage): void {
    for (const tc of message.toolCalls) {
      if (tc.id) this.toolCalls.set(tc.id, tc);
    }
    if (message.type === MessageType.MESSAGE_AI) this.currentAiMessage = message;
  }
}

/** The transcript half of a persisted status: what a reinvocation seeds through the builder. */
export type TranscriptSeed = Pick<AgentExecutionStatus, "messages" | "subAgentExecutions" | "artifacts" | "workspaceWriteBacks" | "todos">;

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

  /**
   * Append a persisted transcript's rows to the status AND index them — the
   * runtime's seed of a reinvocation (`harness/turn-context.ts`
   * `seedFromPersistedStatus` says why every collection is seeded: the
   * server replaces each list wholesale, so a resumed turn's write must be a
   * superset). Every collection is pushed into, never reassigned, so the
   * status's arrays stay the ones every wrapper of the status holds. A
   * sub-agent row already known by id is skipped (a seed is applied once).
   * The rows arrive through the same {@link Transcript.index} the
   * constructor uses, so a builder that seeds after it is born indexes
   * exactly as one born over the seeded status would.
   */
  seed(persisted: TranscriptSeed): void {
    for (const message of persisted.messages) {
      this.proto.messages.push(message);
      this.root.index(message);
    }
    for (const row of persisted.subAgentExecutions) {
      if (this.subAgentsById.has(row.id)) continue;
      this.openSubAgent(row);
    }
    this.proto.artifacts.push(...persisted.artifacts);
    this.proto.workspaceWriteBacks.push(...persisted.workspaceWriteBacks);
    for (const [id, todo] of Object.entries(persisted.todos)) this.proto.todos[id] = todo;
  }

  /** Every transcript, the root's first — for the rules that sweep them all (`finalize`). */
  *transcripts(): IterableIterator<Transcript> {
    yield this.root;
    for (const { transcript } of this.subAgentsById.values()) yield transcript;
  }
}
