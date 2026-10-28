/**
 * TranscriptState — the turn's rows (`TurnRows`, the runner's own proto)
 * `TranscriptBuilder` is building into, held as one {@link Transcript} per
 * scope: the root's over `rows.messages`, and one per sub-agent over its
 * row's `messages`. Beside them the run's status, where the builder
 * registers the turn's write-backs.
 *
 * Indexes, not copies: every map value is the live proto object (a ToolCall
 * inside a message's repeated field, an AgentMessage inside a `messages`
 * array), so a mutation through the index IS the mutation of the proto, and
 * nothing here can drift from what the emitter reads. The arrays themselves
 * are the rows' own, pushed into and never replaced, so every holder of the
 * rows (the runtime's persist chokepoint, the settle modules that amend
 * rows by identity) keeps seeing every row. A reinvocation's asks arrive
 * through {@link TranscriptState.seed} — the turn runtime's seed from the
 * session's log (`harness/transcript/resume-seed.ts`) hands them here — so they are
 * indexed by the same routine that indexes rows handed to the constructor.
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

import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { AgentMessage, ToolCall, SubAgentRun, TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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
   * one that proposed it across a turn boundary.
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

/** What a reinvocation seeds through the builder: the asks its engine resumes onto, by scope. */
export type TranscriptSeed = Pick<TurnRows, "messages" | "subAgentRuns">;

/** A sub-agent's row and the transcript folded into it. */
export interface SubAgentScope {
  readonly row: SubAgentRun;
  readonly transcript: Transcript;
}

export class TranscriptState {
  /** The rows being built. */
  readonly rows: TurnRows;

  /** The run's status: the builder registers write-backs on it. */
  readonly status: RunStatus;

  /** The root transcript, over `rows.messages`. */
  readonly root: Transcript;

  private readonly subAgentsById = new Map<string, SubAgentScope>();

  /**
   * Indexes the rows as handed: the root's messages and every sub-agent
   * row already on them.
   */
  constructor(rows: TurnRows, status: RunStatus) {
    this.rows = rows;
    this.status = status;
    this.root = new Transcript(rows.messages);
    for (const row of rows.subAgentRuns) {
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

  /** Push a new sub-agent row onto the rows and open its transcript. The caller checks the id is new. */
  openSubAgent(row: SubAgentRun): SubAgentScope {
    this.rows.subAgentRuns.push(row);
    const scope = { row, transcript: new Transcript(row.messages) };
    this.subAgentsById.set(row.id, scope);
    return scope;
  }

  /**
   * Append a reinvocation's seeded asks to the rows AND index them — the
   * runtime's seed from the session's log (`harness/transcript/resume-seed.ts`), the
   * calls a resumed engine re-issues and the threads that hold them. Every
   * collection is pushed into, never reassigned, so the rows' arrays stay
   * the ones every holder of the rows holds. A sub-agent row already known
   * by id is skipped (a seed is applied once). The rows arrive through the
   * same {@link Transcript.index} the constructor uses, so a builder that
   * seeds after it is born indexes exactly as one born over the seeded rows
   * would.
   */
  seed(seeded: TranscriptSeed): void {
    for (const message of seeded.messages) {
      this.rows.messages.push(message);
      this.root.index(message);
    }
    for (const row of seeded.subAgentRuns) {
      if (this.subAgentsById.has(row.id)) continue;
      this.openSubAgent(row);
    }
  }

  /** Every transcript, the root's first — for the rules that sweep them all (`finalize`). */
  *transcripts(): IterableIterator<Transcript> {
    yield this.root;
    for (const { transcript } of this.subAgentsById.values()) yield transcript;
  }
}
