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
 * A script may also be a {@link TurnPlayer}: a function of the whole
 * transcript that returns the one turn to play now. The same rule, with the
 * indexing left to the caller — for a consumer whose plan is not "turn k on
 * round k" but "the first step the conversation does not yet show" (the
 * harness contract kit's native subject, whose one execution spans many
 * kit turns on one sqlite thread, S3 M3).
 *
 * A turn may END the model call instead of finishing the message
 * ({@link TurnEnding}): `fail` throws after its chunks (a provider error
 * mid-stream); `hang` parks on the call's abort signal after its chunks and
 * throws the abort when it fires (a provider stream that stalls and is then
 * cancelled). A hang never parks on a timer: `@langchain/core` hands the
 * graph run's signal to `_streamResponseChunks` as `options.signal`
 * (`_separateRunnableConfigFromCallOptionsCompat`), and LangGraph threads
 * its composite abort signal into every task's config, so the runtime's one
 * stop is what unparks it. The `onPark` hook is how a test learns the engine
 * is silent before it stops the turn from the outside.
 *
 * The model STREAMS. With LangGraph's v3 messages handler attached, LangChain
 * Core streams a model internally when it implements `_streamResponseChunks`
 * and otherwise falls back to a synthesized final-message event sequence
 * (`@langchain/langgraph` `pregel/messages-v2.js` `emitFinalMessage`). The
 * fallback spreads a `tool_call` block's `args` OBJECT into the
 * `tool_call_chunk` fields the runner's normalizer reads as a JSON STRING
 * (`translator.ts` `argsChunk`), which no real provider does.
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
  AIMessageChunk,
  isAIMessage,
  isSystemMessage,
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

/**
 * Token usage a turn reports; fixed round numbers keep `streamingUsage`
 * legible in a golden. The cache buckets ride `input_token_details` the way
 * the Anthropic adapter reports them (`cache_read`, `cache_creation`);
 * `inputTokens` is the total the provider states, cache included.
 */
export interface ScriptedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/**
 * How a turn ends the model call instead of finishing its message.
 *  - `fail`: throw `error` after the turn's chunks — a provider error
 *    mid-stream; the graph propagates it and the adapter classifies it.
 *  - `hang`: after the turn's chunks, park on the call's abort signal and
 *    throw the abort when it fires — a stalled provider stream, cancelled by
 *    the run's one stop. Refused (thrown, diagnosing) when the call carries
 *    no signal: a hang outside an abortable run would park forever.
 */
export type TurnEnding = { readonly kind: "fail"; readonly error: Error } | { readonly kind: "hang" };

/**
 * One assistant turn, rendered in the standard content-block shape a
 * streaming provider produces: an optional leading reasoning block, an
 * optional text block, and one `tool_call` per entry of `toolCalls` (which is
 * also what the graph executes). A turn with neither text nor tool calls is
 * an empty assistant message — legal, and what a script that has said all it
 * has to say looks like. A turn with `ends` never finishes its message: its
 * chunks are streamed, then the ending takes the call.
 */
export interface ScriptedTurn {
  readonly reasoning?: string;
  readonly text?: string;
  readonly toolCalls?: readonly ScriptedToolCall[];
  readonly usage?: ScriptedUsage;
  readonly ends?: TurnEnding;
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
 * What a selector can tell one role from another by. `createDeepAgent` gives
 * a declared sub-agent the SAME tool set as its parent (`task` included), so
 * tool names alone cannot separate them; the system prompt can — it carries
 * the role's own instructions.
 */
export interface ScriptRoleContext {
  /** The transcript's leading system message, or "" when there is none. */
  readonly systemPrompt: string;
}

/**
 * A script as a function of the whole transcript: called on every model turn
 * with the messages the model was asked with, returns the turn to play. The
 * round-indexed `RoleScript` is the common case; this is for a plan whose
 * progress is read off the conversation itself (see the header).
 */
export type TurnPlayer = (transcript: readonly BaseMessage[]) => ScriptedTurn;

/** The three shapes a selector may answer with. */
export type Script = ScriptStep | RoleScript | TurnPlayer;

/**
 * Picks the script for the role being asked. A single-agent test ignores both
 * arguments; a parent/sub-agent test keys the role on a tool unique to one
 * role when there is one (a custom counting tool), or on the role's
 * instructions in `context.systemPrompt` when both roles bind the same tools
 * (the hermetic delegation arm). Called at `_generate` time, never at bind
 * time, so a role that is compiled but never invoked (the default
 * general-purpose sub-agent) needs no script.
 */
export type ScriptSelector = (boundToolNames: string[], context: ScriptRoleContext) => Script;

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
  /**
   * Called the moment a `hang` turn parks on its abort signal — the engine
   * is silent from here until the signal fires. A test that must stop the
   * turn from the outside (the contract kit's `whenHanging`) listens here,
   * so the stop lands in the hang and never in the adapter's setup.
   */
  readonly onPark?: () => void;
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
    next.toolNames = tools.map(boundToolName);
    this.boundTools.length = 0;
    this.boundTools.push(...tools);
    return next as unknown as this;
  }

  /** The turn for this transcript, after the driver hook has run. */
  private async turnFor(messages: BaseMessage[]): Promise<ScriptedTurn> {
    const round = completedToolRounds(messages);
    await this.options.onTurn?.({ boundToolNames: this.toolNames, round });
    const context: ScriptRoleContext = { systemPrompt: systemPromptOf(messages) };
    return resolveTurn(this.select(this.toolNames, context), { round, transcript: messages, toolNames: this.toolNames });
  }

  /**
   * The non-streaming path (`invoke` outside a graph — the runtime's tier-2
   * structured-output extractor is the one caller): the SAME chunks the
   * streaming path yields, merged, which is the `AIMessageChunk` a streaming
   * provider's `invoke` returns. `@langchain/core`'s base `withStructuredOutput`
   * pipeline reads exactly that shape (`AIMessageChunk.isInstance`, then
   * `tool_calls`); a plain `AIMessage` here would fail it with "Input is not
   * an AIMessageChunk" where the real provider succeeds. An ending turn ends
   * this call the same way it ends the stream.
   */
  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    const turn = await this.turnFor(messages);
    if (turn.ends) await this.takeEnding(turn.ends, options.signal);
    const message = renderTurnChunks(turn).reduce((merged, chunk) => merged.concat(chunk));
    return { generations: [{ message, text: turn.text ?? "" }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"] & BaseChatModelCallOptions,
    _runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const turn = await this.turnFor(messages);
    for (const chunk of renderTurnChunks(turn)) {
      yield new ChatGenerationChunk({ message: chunk, text: typeof chunk.content === "string" ? chunk.content : "" });
    }
    if (turn.ends) await this.takeEnding(turn.ends, options.signal);
  }

  /** Never returns: throws the ending's error, or parks on the signal and throws its abort. */
  private async takeEnding(ending: TurnEnding, signal: AbortSignal | undefined): Promise<never> {
    switch (ending.kind) {
      case "fail":
        throw ending.error;
      case "hang": {
        if (!signal) {
          throw new Error(
            "ScriptedModel: a `hang` turn parks on the call's abort signal and this call carried none; " +
              "a hang is only meaningful inside a run that can be aborted",
          );
        }
        this.options.onPark?.();
        if (!signal.aborted) {
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        }
        throw abortErrorOf(signal);
      }
      default: {
        const exhaustive: never = ending;
        throw new Error(`ScriptedModel: unknown turn ending ${String(exhaustive)}`);
      }
    }
  }
}

/** What a provider SDK throws when its in-flight request is aborted: the signal's own reason, or an `AbortError` naming it. */
function abortErrorOf(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const err = new Error(`ScriptedModel: the hang was aborted (${String(signal.reason)})`);
  err.name = "AbortError";
  return err;
}

// ---------------------------------------------------------------------------
// Script resolution
// ---------------------------------------------------------------------------

/**
 * The name a bound tool answers to: a LangChain tool's `name`, or an
 * OpenAI-style function definition's `function.name` (how langchain binds the
 * structured-output schema tool of `toolStrategy`). A real provider client
 * accepts both shapes; so does this double.
 */
function boundToolName(tool: unknown): string {
  const t = tool as { name?: unknown; function?: { name?: unknown } } | null | undefined;
  if (typeof t?.name === "string") return t.name;
  if (typeof t?.function?.name === "string") return t.function.name;
  return "";
}

function systemPromptOf(messages: readonly BaseMessage[]): string {
  const system = messages.find((m) => isSystemMessage(m));
  if (!system) return "";
  return typeof system.content === "string" ? system.content : system.text;
}

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

/** What one model call knows when it picks its turn. */
interface TurnRequest {
  readonly round: number;
  readonly transcript: readonly BaseMessage[];
  readonly toolNames: readonly string[];
}

function resolveTurn(script: Script, request: TurnRequest): ScriptedTurn {
  if (typeof script === "function") return script(request.transcript);
  const role = normalizeScript(script);
  const { round, toolNames } = request;
  if (round < role.turns.length) return role.turns[round];
  if (role.repeatLast && role.turns.length > 0) return role.turns[role.turns.length - 1];
  throw new Error(
    `ScriptedModel: the script for role [${toolNames.join(", ")}] has ${role.turns.length} turn(s) ` +
      `but the transcript already holds ${round} completed tool round(s); ` +
      "add a turn or set repeatLast.",
  );
}

// ---------------------------------------------------------------------------
// Rendering: the chunk sequence (stream), merged into one message for invoke
// ---------------------------------------------------------------------------

function usageMetadataOf(usage: ScriptedUsage | undefined): UsageMetadata | undefined {
  if (!usage) return undefined;
  const hasCacheBuckets = usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined;
  return {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    ...(hasCacheBuckets
      ? { input_token_details: { cache_read: usage.cacheReadTokens ?? 0, cache_creation: usage.cacheWriteTokens ?? 0 } }
      : {}),
  };
}

function reasoningBlock(reasoning: string, index?: number): ContentBlock.Reasoning {
  return { type: "reasoning", reasoning, ...(index !== undefined ? { index } : {}) };
}

function textBlock(text: string, index?: number): ContentBlock.Text {
  return { type: "text", text, ...(index !== undefined ? { index } : {}) };
}

/**
 * The chunk sequence `convertChunksToEvents` turns into the production event
 * stream (see the header). An ending turn gets NO closing chunk: its message
 * never finishes — the ending takes the call after these chunks.
 */
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

  if (turn.ends) return chunks;

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
