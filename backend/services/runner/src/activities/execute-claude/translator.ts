/**
 * The Claude engine's messages as the runtime's transcript events
 * (`harness/transcript/events.ts`), folded through the one builder.
 *
 * The engine streams each model call as the Messages API does
 * (`includePartialMessages`), and then delivers the call's content again as
 * whole assistant messages, one block at a time. The stream is the live
 * text; the whole messages are what closes it:
 *
 *  - `message_start` opens a segment keyed by the API message id, the
 *    `runId` of every event of that call; `text_delta` and `thinking_delta`
 *    become `text_delta` and `reasoning_delta`; `message_stop` finishes it.
 *  - A `tool_use` block opens its row as soon as it starts (`tool_started`,
 *    no input yet), its `input_json_delta`s fill the row's arguments as they
 *    stream (`tool_arg_delta`), and the whole message's block re-announces
 *    it with the complete input, which the builder reconciles onto the row.
 *    The engine streams a call before its gate decides it, so the row opens
 *    PENDING (`undecided`), and turns RUNNING only once both are in: the
 *    gate let it run, and the whole message gave its complete input
 *    (announced again decided, by {@link ClaudeTranslator.admitted} or by
 *    the whole message, whichever comes second). A RUNNING row is written to
 *    the session's log as it is, so it must never be released with half its
 *    input or before a refusal's stamp. A helper's start is never held
 *    (`gate.ts`), so it opens RUNNING.
 *  - A whole assistant message whose call never streamed (a sub-agent's,
 *    forwarded with `forwardSubagentText`) is folded from its blocks alone.
 *  - A `tool_result` in a user message settles its row: `tool_finished`, or
 *    `tool_error` when the engine marks it an error (a refusal included).
 *    The gate's provenance for the call (`gate.ts`) is stamped first
 *    (`tool_policy`), with the hook that decided, so the row says which
 *    layer let it run or refused it. The hooks' feedback on the call
 *    (`hooks.ts` `HookFeedback`) is appended to its result, as the native
 *    engine's row carries it. A call a person refused on its card is the
 *    runtime's to settle (`harness/approval-decisions.ts`, "Rejected by
 *    user"), so the engine's refusal of it is applied to nothing.
 *  - An `Agent` call opens and closes a sub-agent row around it, the
 *    sub-agent's own messages scoped to it by `parent_tool_use_id`. Its
 *    result, on the call's row and the sub-agent's, is the sub-agent's own
 *    answer, read from the result's structured content (`tool_use_result`):
 *    the text the model reads wraps it in the engine's hand-back frame, with
 *    the sub-agent's id and timing, which no row carries.
 *  - `compact_boundary` marks a compaction (`context_compacted`).
 *
 * Names: the engine's shell is reported under the name its model used,
 * `Bash`; a call the model made to the host's aliased name
 * (`mcp__stigmer__bash`, `host-shell.ts`) is reported as `Bash` too, so the
 * aliased name never reaches a row. An MCP call's row is its tool, by the
 * bare name its server gave it, with the bridged server's slug
 * (`mcp-bridge.ts`), as the native and Cursor engines name it, so every
 * reader of a row (the session's log, the eval trace, the views) reads one
 * spelling; the engine's own `mcp__<slug>__<tool>` never reaches a row.
 * Every other name is a built-in's.
 *
 * Everything else the engine sends (its status, retries, its own init, the
 * result) is the turn loop's (`turn.ts`), not a transcript fact.
 */

import type { SDKAssistantMessage, SDKMessage, SDKPartialAssistantMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { StreamFact } from "../../harness/transcript/events.js";
import type { GateVerdict } from "./gate.js";
import { HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";

/** The engine's name for its sub-agent tool. */
const AGENT_TOOL = "Agent";

/** What the translator reads beside the stream. */
export interface ClaudeTranslatorDeps {
  /** The bridged server an engine tool name belongs to; undefined for a built-in. */
  readonly serverOf: (toolName: string) => { readonly slug: string; readonly tool: string } | undefined;
  /** The gate's decision for a call, once made. */
  readonly verdictOf: (toolUseId: string) => GateVerdict | undefined;
  /** The hooks' feedback section for a call, once its result is in; undefined for none. */
  readonly feedbackOf?: (toolUseId: string) => string | undefined;
}

/** One translator per turn: it remembers which calls streamed and which rows it opened. */
export class ClaudeTranslator {
  /** The API message each scope's stream is in, by scope (`""`: the root). */
  private readonly streaming = new Map<string, string>();
  /** API message ids whose content streamed, so their whole messages only reconcile. */
  private readonly streamed = new Set<string>();
  /** The tool call each streamed content block opened, by `messageId:index`. */
  private readonly blockCalls = new Map<string, string>();
  /** `Agent` calls whose sub-agent row is open. */
  private readonly agentCalls = new Set<string>();
  /** The name each call was opened under, for its settle. */
  private readonly callNames = new Map<string, string>();
  /** The scope and bridged server each call was opened in, for its admission. */
  private readonly callPlaces = new Map<string, { readonly scope: Scope; readonly mcpServerSlug: string }>();
  /** Calls whose whole message has given their complete input. */
  private readonly wholeCalls = new Set<string>();

  constructor(private readonly deps: ClaudeTranslatorDeps) {}

  /** The transcript events one engine message makes. */
  translate(message: SDKMessage): StreamFact[] {
    switch (message.type) {
      case "stream_event":
        return this.streamEvent(message);
      case "assistant":
        return this.assistant(message);
      case "user":
        return "isReplay" in message ? [] : this.user(message);
      case "system":
        return message.subtype === "compact_boundary" ? [{ kind: "context_compacted" }] : [];
      default:
        return [];
    }
  }

  private streamEvent(message: SDKPartialAssistantMessage): StreamFact[] {
    const scope = scopeOf(message.parent_tool_use_id);
    const key = message.parent_tool_use_id ?? "";
    const event = message.event;
    switch (event.type) {
      case "message_start":
        this.streaming.set(key, event.message.id);
        this.streamed.add(event.message.id);
        return [{ kind: "message_start", runId: event.message.id, ...scope }];
      case "content_block_start": {
        const runId = this.streaming.get(key);
        const block = event.content_block;
        if (runId === undefined || block.type !== "tool_use") return [];
        this.blockCalls.set(`${runId}:${event.index}`, block.id);
        return this.toolStarted(block.id, block.name, {}, scope);
      }
      case "content_block_delta": {
        const runId = this.streaming.get(key);
        if (runId === undefined) return [];
        const delta = event.delta;
        if (delta.type === "text_delta") return [{ kind: "text_delta", runId, text: delta.text, ...scope }];
        if (delta.type === "thinking_delta") return [{ kind: "reasoning_delta", runId, text: delta.thinking, ...scope }];
        if (delta.type === "input_json_delta") {
          const callId = this.blockCalls.get(`${runId}:${event.index}`);
          return callId === undefined ? [] : [{ kind: "tool_arg_delta", callId, argsChunk: delta.partial_json, ...scope }];
        }
        return [];
      }
      case "message_stop": {
        const runId = this.streaming.get(key);
        if (runId === undefined) return [];
        this.streaming.delete(key);
        return [{ kind: "message_finish", runId, ...scope }];
      }
      default:
        return [];
    }
  }

  private assistant(message: SDKAssistantMessage): StreamFact[] {
    const scope = scopeOf(message.parent_tool_use_id);
    const runId = message.message.id;
    const out: StreamFact[] = [];
    const streamed = this.streamed.has(runId);
    let opened = false;
    for (const block of message.message.content) {
      if (block.type === "tool_use") {
        this.wholeCalls.add(block.id);
        out.push(...this.toolStarted(block.id, block.name, toolInputOf(block.input), scope));
        continue;
      }
      if (streamed) continue;
      if (block.type === "text" || block.type === "thinking") {
        if (!opened) out.push({ kind: "message_start", runId, ...scope });
        opened = true;
        out.push(
          block.type === "text"
            ? { kind: "text_delta", runId, text: block.text, ...scope }
            : { kind: "reasoning_delta", runId, text: block.thinking, ...scope },
        );
      }
    }
    if (opened) out.push({ kind: "message_finish", runId, ...scope });
    return out;
  }

  private user(message: SDKUserMessage): StreamFact[] {
    const content = message.message.content;
    if (typeof content === "string") return [];
    const scope = scopeOf(message.parent_tool_use_id);
    const out: StreamFact[] = [];
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const callId = block.tool_use_id;
      const verdict = this.deps.verdictOf(callId);
      if (verdict?.kind === "refuse" && verdict.byPerson) continue;
      if (verdict?.source !== undefined) out.push({ kind: "tool_policy", callId, provenance: verdict.source, policyHook: verdict.hook ?? "", ...scope });
      const answer = this.agentCalls.has(callId) && block.is_error !== true ? agentAnswerOf(message.tool_use_result) : undefined;
      const text = answer ?? resultText(block.content);
      const feedback = this.deps.feedbackOf?.(callId);
      const rowText = feedback === undefined ? text : `${text}\n\n${feedback}`;
      out.push(block.is_error === true ? { kind: "tool_error", callId, message: rowText, ...scope } : { kind: "tool_finished", callId, result: rowText, ...scope });
      if (this.agentCalls.delete(callId)) {
        out.push(block.is_error === true ? { kind: "sub_agent_failed", subAgentId: callId, error: text } : { kind: "sub_agent_finished", subAgentId: callId, output: text });
      }
    }
    return out;
  }

  /**
   * The start that makes a call's row RUNNING once its gate let it run (the
   * header); nothing for a call whose whole message is not in yet, which
   * {@link toolStarted} announces decided when the verdict is already in.
   */
  admitted(callId: string): StreamFact[] {
    const name = this.callNames.get(callId);
    const place = this.callPlaces.get(callId);
    if (name === undefined || place === undefined || !this.wholeCalls.has(callId)) return [];
    return [{ kind: "tool_started", callId, name, input: {}, mcpServerSlug: place.mcpServerSlug, ...place.scope }];
  }

  /** A call's row opened (or reconciled, when it is already open), with the sub-agent row an `Agent` call opens before it. */
  private toolStarted(callId: string, engineName: string, input: Record<string, unknown>, scope: Scope): StreamFact[] {
    const server = isHostShell(engineName) ? undefined : this.deps.serverOf(engineName);
    const name = isHostShell(engineName) ? HOST_SHELL_TOOL.engineName : (server?.tool ?? engineName);
    const known = this.callNames.has(callId);
    this.callNames.set(callId, name);
    this.callPlaces.set(callId, { scope, mcpServerSlug: server?.slug ?? "" });
    const decided = name === AGENT_TOOL || (this.wholeCalls.has(callId) && this.deps.verdictOf(callId)?.kind === "allow");
    const out: StreamFact[] = [];
    if (name === AGENT_TOOL && !this.agentCalls.has(callId) && Object.keys(input).length > 0) {
      this.agentCalls.add(callId);
      out.push({
        kind: "sub_agent_started",
        subAgentId: callId,
        name: stringOf(input.subagent_type),
        subject: stringOf(input.description),
        input: stringOf(input.prompt),
      });
    }
    if (known && Object.keys(input).length === 0) return out;
    out.push({
      kind: "tool_started",
      callId,
      name,
      input,
      mcpServerSlug: server?.slug ?? "",
      ...(decided ? {} : { undecided: true as const }),
      ...scope,
    });
    return out;
  }
}

type Scope = { readonly subAgentId?: string };

function scopeOf(parentToolUseId: string | null): Scope {
  return parentToolUseId === null ? {} : { subAgentId: parentToolUseId };
}

function toolInputOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A sub-agent's own answer from an `Agent` call's structured result (the header); undefined when it carries none. */
export function agentAnswerOf(toolUseResult: unknown): string | undefined {
  const content = (toolUseResult as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const texts = content.flatMap((block: unknown) => {
    const b = block as { type?: unknown; text?: unknown };
    return b.type === "text" && typeof b.text === "string" ? [b.text] : [];
  });
  return texts.length === 0 ? undefined : texts.join("\n");
}

/**
 * A tool result's content as the row carries it: its text, the tools a tool
 * search loaded by name, any other block (an image, a document) by its kind.
 */
export function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => {
      const b = block as { type?: unknown; text?: unknown; tool_name?: unknown };
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "tool_reference" && typeof b.tool_name === "string") return b.tool_name;
      return `[${String(b.type)}]`;
    })
    .join("\n");
}
