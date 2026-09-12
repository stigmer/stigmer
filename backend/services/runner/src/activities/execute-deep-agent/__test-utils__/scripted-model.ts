/**
 * Scripted deep-agent test harness: a deterministic chat model plus the
 * parent-checkpoint interrupt reader.
 *
 * These two helpers are what every "drive a real deepagents/LangGraph graph
 * through the approval gate" test needs. They are shared by the graph-level
 * tests (`__tests__/subagent-approval-propagation.test.ts`,
 * `shell-execute-gate.test.ts`, …), the gateway Contract Test Kit adapter
 * (`gateway-substrate.ts`), and the hermetic activity driver
 * (`hermetic-deep-agent.ts`), which runs the REAL `ExecuteDeepAgent` activity
 * with this model as the only LLM. Keeping one copy means a change to how the
 * runner reads pending interrupts (or how a scripted run is driven) updates
 * every consumer at once.
 *
 * The one rule the model keeps: it is a PURE FUNCTION of (bound tools,
 * transcript). A script is a sequence of turns per role, and the turn to play
 * is chosen by how many tool rounds the transcript already holds (AI messages
 * carrying `tool_calls`), never by a call counter. That is what lets one
 * script serve both checkpointers the runner ships: under `memory` a HITL
 * reinvocation REPLAYS the graph from the first message (the saver is
 * recreated empty per invocation), so the same transcript indices produce the
 * same proposals; under `sqlite` the graph RESUMES after the interrupt and the
 * next call sees one more completed round. A call-counted script would emit
 * the wrong turn on replay.
 *
 * The model STREAMS. With LangGraph's v3 messages handler attached, LangChain
 * Core streams a model internally when it implements `_streamResponseChunks`
 * and otherwise falls back to a synthesized final-message event sequence
 * (`@langchain/langgraph` `pregel/messages-v2.js` `emitFinalMessage`). The
 * fallback spreads a `tool_call` block's `args` OBJECT into the
 * `tool_call_chunk` fields the runner's normalizer reads as a JSON STRING
 * (`v3-protocol-normalizer.ts` `argsChunk`), which no real provider does.
 * Streaming keeps the double on the production event path: `@langchain/core`
 * `language_models/compat.js` `convertChunksToEvents` turns the chunks below
 * into `message-start`, per-block `content-block-start` / `-delta` /
 * `-finish`, and `message-finish` with usage — the same events `ChatAnthropic`
 * produces. The chunk shapes are chosen from that converter: a string chunk
 * opens block 0 and emits a text delta in one step; an array-content part
 * opens its block with NO delta on first sight, so a reasoning block is sent
 * as an empty opener followed by the text; a `tool_call_chunk` always emits a
 * delta carrying the accumulated JSON args; `usage_metadata` rides the LAST
 * chunk so it lands on `message-finish` (the one place the runner reads it),
 * not on `message-start`.
 */

import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import {
  AIMessage,
  AIMessageChunk,
  isAIMessage,
  type BaseMessage,
  type ContentBlock,
  type UsageMetadata,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";

/** A single tool call the scripted model proposes on a turn. */
export interface ScriptedToolCall {
  name: string;
  args: Record<string, unknown>;
  id: string;
}

/** Token usage a turn reports; fixed round numbers keep `streamingUsage` legible in a golden. */
export interface ScriptedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * One assistant turn, rendered in the standard content-block shape a
 * streaming provider produces: an optional leading reasoning block, an
 * optional text block, and one `tool_call` per entry of `toolCalls` (which is
 * also what the graph executes). A turn with neither text nor tool calls is
 * an empty assistant message — legal, and what a script that has said all it
 * has to say looks like.
 */
export interface ScriptedTurn {
  readonly reasoning?: string;
  readonly text?: string;
  readonly toolCalls?: readonly ScriptedToolCall[];
  readonly usage?: ScriptedUsage;
}

/**
 * A role's script: `turns[k]` is played when the transcript already holds `k`
 * completed tool rounds. Running past the end throws (a script that runs out
 * is a test bug) unless `repeatLast` is set, in which case the final turn
 * plays again — the shape of a model that keeps calling a tool until the
 * graph's recursion limit stops it.
 */
export interface RoleScript {
  readonly turns: readonly ScriptedTurn[];
  readonly repeatLast?: boolean;
}

/**
 * The two-turn sugar most graph-level tests use: propose `toolCalls` on the
 * first round, then say `done` on every round after. Exactly
 * `{ turns: [{ toolCalls }, { text: done }], repeatLast: true }`.
 */
export interface ScriptStep {
  toolCalls: ScriptedToolCall[];
  done: string;
}

/**
 * Picks the script for the currently-bound tool set. A single-agent test
 * ignores the argument; a parent/sub-agent test keys the role on a tool unique
 * to one role (e.g. the sub-agent's gated tool), because `createDeepAgent`
 * injects the `task` tool into both the parent and its sub-agents. Called at
 * `_generate` time, never at bind time, so a role that is compiled but never
 * invoked (the default general-purpose sub-agent) needs no script.
 */
export type ScriptSelector = (boundToolNames: string[]) => ScriptStep | RoleScript;

/** What the driver learns before a turn is rendered: which role, which round. */
export interface ScriptedTurnInfo {
  readonly boundToolNames: readonly string[];
  readonly round: number;
}

export interface ScriptedModelOptions {
  /**
   * Called once per model turn, before it is rendered. The hermetic driver
   * ticks its clock here and runs a scenario's scheduled effect (a user pause,
   * a worker shutdown) — from a model turn, never from a timer, so the
   * interruption lands at the same instant every run.
   */
  readonly onTurn?: (info: ScriptedTurnInfo) => void | Promise<void>;
}

/**
 * A deterministic chat model driven by a per-role script. No LLM, no network.
 * The role is keyed on the bound tool names so the same instance drives a
 * parent and its sub-agents.
 */
export class ScriptedModel extends BaseChatModel {
  toolNames: string[] = [];
  /**
   * The tool objects from the most recent `bindTools` call, exactly as the
   * agent bound them (post-middleware). Lets tests assert on the bound
   * SCHEMAS — e.g. the tool-intent middleware's bind-time shell clone — not
   * just the names. The array is shared across the clones `bindTools`
   * returns, so the instance the test holds always sees the latest bind.
   */
  readonly boundTools: unknown[];
  private readonly select: ScriptSelector;
  private readonly options: ScriptedModelOptions;

  constructor(select: ScriptSelector, boundTools: unknown[] = [], options: ScriptedModelOptions = {}) {
    super({});
    this.select = select;
    this.boundTools = boundTools;
    this.options = options;
  }

  _llmType(): string {
    return "scripted";
  }

  bindTools(tools: unknown[]): this {
    const next = new ScriptedModel(this.select, this.boundTools, this.options);
    next.toolNames = (tools as Array<{ name?: string }>).map((t) => t?.name ?? "");
    this.boundTools.length = 0;
    this.boundTools.push(...tools);
    return next as unknown as this;
  }

  /** The turn for this transcript, after the driver hook has run. */
  private async turnFor(messages: BaseMessage[]): Promise<ScriptedTurn> {
    const round = completedToolRounds(messages);
    await this.options.onTurn?.({ boundToolNames: this.toolNames, round });
    return resolveTurn(normalizeScript(this.select(this.toolNames)), round, this.toolNames);
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const turn = await this.turnFor(messages);
    const message = renderTurn(turn);
    const text = typeof message.content === "string" ? message.content : (turn.text ?? "");
    return { generations: [{ message, text }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    _options: this["ParsedCallOptions"] & BaseChatModelCallOptions,
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const turn = await this.turnFor(messages);
    for (const chunk of renderTurnChunks(turn)) {
      yield new ChatGenerationChunk({ message: chunk, text: typeof chunk.content === "string" ? chunk.content : "" });
    }
  }
}

// ---------------------------------------------------------------------------
// Script resolution
// ---------------------------------------------------------------------------

function normalizeScript(script: ScriptStep | RoleScript): RoleScript {
  if ("done" in script) {
    return { turns: [{ toolCalls: script.toolCalls }, { text: script.done }], repeatLast: true };
  }
  return script;
}

/** Tool rounds the transcript already holds: AI messages that proposed at least one tool call. */
export function completedToolRounds(messages: readonly BaseMessage[]): number {
  let rounds = 0;
  for (const m of messages) {
    if (isAIMessage(m) && (m.tool_calls?.length ?? 0) > 0) rounds += 1;
  }
  return rounds;
}

function resolveTurn(script: RoleScript, round: number, toolNames: readonly string[]): ScriptedTurn {
  if (round < script.turns.length) return script.turns[round];
  if (script.repeatLast && script.turns.length > 0) return script.turns[script.turns.length - 1];
  throw new Error(
    `ScriptedModel: the script for role [${toolNames.join(", ")}] has ${script.turns.length} turn(s) ` +
      `but the transcript already holds ${round} completed tool round(s); ` +
      "add a turn or set repeatLast.",
  );
}

// ---------------------------------------------------------------------------
// Rendering: one AIMessage (invoke) or the chunk sequence (stream)
// ---------------------------------------------------------------------------

function usageMetadataOf(usage: ScriptedUsage | undefined): UsageMetadata | undefined {
  if (!usage) return undefined;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
  };
}

function reasoningBlock(reasoning: string, index?: number): ContentBlock.Reasoning {
  return { type: "reasoning", reasoning, ...(index !== undefined ? { index } : {}) };
}

function textBlock(text: string, index?: number): ContentBlock.Text {
  return { type: "text", text, ...(index !== undefined ? { index } : {}) };
}

function toolCallsOf(turn: ScriptedTurn): AIMessage["tool_calls"] {
  return (turn.toolCalls ?? []).map((tc) => ({ ...tc, type: "tool_call" as const }));
}

/**
 * The aggregated message: string content for a plain-text or tool-only turn
 * (the shape every provider gives), content blocks when a reasoning block
 * precedes the text (the shape Anthropic gives with thinking on).
 */
function renderTurn(turn: ScriptedTurn): AIMessage {
  const content: string | ContentBlock[] = turn.reasoning
    ? [reasoningBlock(turn.reasoning), ...(turn.text ? [textBlock(turn.text)] : [])]
    : (turn.text ?? "");
  const usage = usageMetadataOf(turn.usage);
  return new AIMessage({
    content,
    tool_calls: toolCallsOf(turn),
    ...(usage ? { usage_metadata: usage } : {}),
  });
}

/** The chunk sequence `convertChunksToEvents` turns into the production event stream (see the header). */
function renderTurnChunks(turn: ScriptedTurn): AIMessageChunk[] {
  const chunks: AIMessageChunk[] = [];
  let nextIndex = 0;

  if (turn.reasoning) {
    const index = nextIndex++;
    chunks.push(new AIMessageChunk({ content: [reasoningBlock("", index)] }));
    chunks.push(new AIMessageChunk({ content: [reasoningBlock(turn.reasoning, index)] }));
  }

  if (turn.text) {
    if (turn.reasoning) {
      const index = nextIndex++;
      chunks.push(new AIMessageChunk({ content: [textBlock("", index)] }));
      chunks.push(new AIMessageChunk({ content: [textBlock(turn.text, index)] }));
    } else {
      nextIndex++;
      chunks.push(new AIMessageChunk({ content: turn.text }));
    }
  }

  for (const tc of turn.toolCalls ?? []) {
    const index = nextIndex++;
    chunks.push(
      new AIMessageChunk({
        content: "",
        tool_call_chunks: [{ type: "tool_call_chunk", id: tc.id, name: tc.name, args: JSON.stringify(tc.args), index }],
      }),
    );
  }

  const usage = usageMetadataOf(turn.usage);
  // The closing chunk: carries usage onto message-finish, and guarantees at
  // least one chunk so an empty turn is still a message.
  chunks.push(new AIMessageChunk({ content: "", ...(usage ? { usage_metadata: usage } : {}) }));
  return chunks;
}

// ---------------------------------------------------------------------------
// Pending interrupts
// ---------------------------------------------------------------------------

/** A pending approval interrupt surfaced at the parent checkpoint. */
export interface PendingInterrupt {
  taskId: string;
  interruptId: string;
  toolCallId: string;
  toolName: string;
  message: string;
  /**
   * Authorization provenance the gate attached to the interrupt
   * (approval-gate.ts `policy_source`) — the PolicySource union string, or "" for
   * legacy. Lets the gateway contract assert every gated side effect is
   * provenance-tagged.
   */
  policySource: string;
}

/**
 * Read the pending approval interrupts from a graph state, exactly as the
 * production resume path does (`hitl.ts` / `index.ts`): scan the parent's
 * top-level `tasks[].interrupts`, skipping any already carrying a resume value.
 *
 * Crucially `interruptId` is the interrupt's OWN id (`interrupts[].id`), not the
 * owning `task.id` — for a nested sub-agent interrupt the two differ, and only
 * the interrupt id routes a `Command(resume=...)` value back into the nested
 * `interrupt()`.
 */
export function readPendingInterrupts(state: {
  tasks?: ReadonlyArray<{
    id: string;
    interrupts?: ReadonlyArray<{ id?: string; value?: unknown; resumeValue?: unknown }>;
  }>;
}): PendingInterrupt[] {
  const out: PendingInterrupt[] = [];
  for (const task of state.tasks ?? []) {
    for (const intr of task.interrupts ?? []) {
      if (intr.resumeValue !== undefined) continue;
      const v = (intr.value ?? {}) as Record<string, unknown>;
      out.push({
        taskId: task.id,
        interruptId: (intr.id as string) ?? task.id,
        toolCallId: (v.tool_call_id as string) ?? "",
        toolName: (v.tool_name as string) ?? "",
        message: (v.message as string) ?? "",
        policySource: (v.policy_source as string) ?? "",
      });
    }
  }
  return out;
}
