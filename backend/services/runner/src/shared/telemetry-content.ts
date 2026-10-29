/**
 * The conversation's text as a trace carries it, when the operator switches
 * content on (`otel-export.ts`): never more than Stigmer's own saved
 * conversation shows, and always valid JSON in the conventions' message
 * shape.
 *
 * The rule. A tracing tool is one more place people read conversations, and
 * it must not show what Stigmer's own screens withhold. The saved
 * conversation applies two rules, and this module calls the same functions
 * rather than copies of them:
 *  - every tool call's arguments go through `redactSensitiveArgs`
 *    (`args-preview.ts`): a top-level `password`, `token`, `secret`, ...
 *    argument reads `[REDACTED]`, wherever the arguments appear (a tool
 *    span's own, or a `tool_call` part in a model call's input or output);
 *  - a write to a secret-like path (`.env`, a key, credentials, Terraform
 *    state; `filereview/secret-paths.ts`) shows only `{ path }` and no
 *    result, on its own span and wherever a later model call's input
 *    repeats it, matched by its tool-call id within the request
 *    (`tool-row.ts` `secretLikeFilePath`).
 * What the agent READ is not withheld, as the console does not withhold it:
 * widening that is a change to what the console shows first. The model saw
 * the raw arguments; a trace therefore cannot always replay a call exactly,
 * which is the price of the rule.
 *
 * The shape (the GenAI conventions' input and output message schemas):
 * `{ role, parts }`, with `text`, `reasoning`, `tool_call` and
 * `tool_call_response` parts, an output message's `finish_reason`, and
 * system instructions as a list of `text` parts; each attribute a JSON
 * string. Tool definitions are not exported: they are configuration, large,
 * and repeat on every call. An image the model was shown is a text part
 * naming it, never its bytes.
 *
 * The bounds, each keeping the JSON valid:
 *  - a text keeps its first and last {@link TEXT_KEEP} characters around a
 *    `[cut N characters]` marker (the judge's subject cuts the same way,
 *    `@stigmer/eval-runtime`'s `judge/subject.ts`);
 *  - one span's content attributes together stay under
 *    {@link SPAN_CONTENT_BYTES}: the oldest input messages are dropped first
 *    behind one `{ elided_messages: n }` entry, and what still does not fit
 *    reads `{ elided_bytes: n }` in place of that attribute.
 * With content on, the span processor's batch is sized to these bounds
 * (`otel-export.ts` `CONTENT_BATCH_SIZE`).
 *
 * A failure's text is content too: an error can quote the call that failed
 * (a tool's schema refusal prints its arguments), so with content off a
 * failed span carries its status and `error.type`, never the message or
 * the exception ({@link markFailed}).
 */

import { SpanStatusCode, type Span } from "@opentelemetry/api";

import { ERROR_TYPE } from "../gen-ai-conventions.js";
import { redactSensitiveArgs } from "./args-preview.js";
import { secretLikeFilePath } from "./tool-row.js";
import { toolApprovalCategory } from "./tool-kind.js";

/** The characters a text keeps at each end when it is cut. */
export const TEXT_KEEP = 4_000;

/** The most bytes one span's content attributes carry together. */
export const SPAN_CONTENT_BYTES = 64 * 1024;

// ─── The conventions' message shape ───────────────────────────────────────

export type MessagePart =
  | { readonly type: "text"; readonly content: string }
  | { readonly type: "reasoning"; readonly content: string }
  | { readonly type: "tool_call"; readonly id?: string; readonly name: string; readonly arguments: Record<string, unknown> }
  | { readonly type: "tool_call_response"; readonly id?: string; readonly response: string | null };

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly parts: readonly MessagePart[];
  /** Set on output messages. */
  readonly finish_reason?: string;
}

/** The marker the oldest input messages are dropped behind. */
export interface ElidedMessages {
  readonly elided_messages: number;
}

// ─── Texts ────────────────────────────────────────────────────────────────

/** `text` with its middle cut when it is longer than both kept ends; never splits a character. */
export function cutText(text: string): string {
  if (text.length <= 2 * TEXT_KEEP) return text;
  let head = TEXT_KEEP;
  if (isHighSurrogate(text.charCodeAt(head - 1))) head -= 1;
  let tail = text.length - TEXT_KEEP;
  if (isLowSurrogate(text.charCodeAt(tail))) tail += 1;
  return `${text.slice(0, head)}[cut ${tail - head} characters]${text.slice(tail)}`;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Every string inside `value` cut, the structure kept. */
function cutStrings(value: unknown): unknown {
  if (typeof value === "string") return cutText(value);
  if (Array.isArray(value)) return value.map(cutStrings);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, cutStrings(inner)]));
  }
  return value;
}

// ─── A tool call's arguments and result ───────────────────────────────────

/** A tool call's arguments as a trace may show them, and whether the call's content is withheld. */
export interface ExportedArguments {
  readonly arguments: Record<string, unknown>;
  /** A write to a secret-like path: its result is withheld too. */
  readonly withheld: boolean;
}

/** The saved conversation's two rules over one tool call's arguments (the module header). */
export function exportedArguments(name: string, args: Record<string, unknown>): ExportedArguments {
  if (toolApprovalCategory(name) === "write") {
    const path = secretLikeFilePath(args);
    if (path !== null) return { arguments: path ? { path } : {}, withheld: true };
  }
  return { arguments: cutStrings(redactSensitiveArgs(args)) as Record<string, unknown>, withheld: false };
}

/** A tool call's result as a trace may show it: `null` when its arguments are withheld. */
export function exportedResult(result: string, withheld: boolean): string | null {
  return withheld ? null : cutText(result);
}

/** The `gen_ai.tool.call.*` attributes of one tool call, bounded. */
export function toolCallContent(name: string, args: Record<string, unknown>): { readonly arguments: string; readonly withheld: boolean } {
  const exported = exportedArguments(name, args);
  return { arguments: boundedJson(exported.arguments, SPAN_CONTENT_BYTES / 2), withheld: exported.withheld };
}

// ─── LangChain messages, as the Stigmer harness's model calls carry them ────

interface LangChainToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** The fields of a LangChain message this module reads, structurally. */
interface LangChainMessage {
  readonly type?: unknown;
  readonly content?: unknown;
  readonly tool_calls?: readonly LangChainToolCall[];
  readonly tool_call_id?: unknown;
}

const ROLE_OF: Readonly<Record<string, ChatMessage["role"]>> = {
  human: "user",
  ai: "assistant",
  tool: "tool",
  system: "system",
};

/** A message's content as text and reasoning parts; an image is named, never carried. */
function contentParts(content: unknown): MessagePart[] {
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", content: cutText(content) }];
  if (!Array.isArray(content)) return [];
  const parts: MessagePart[] = [];
  for (const block of content as unknown[]) {
    if (typeof block === "string") {
      parts.push({ type: "text", content: cutText(block) });
      continue;
    }
    if (typeof block !== "object" || block === null) continue;
    const { type, text, thinking } = block as { type?: unknown; text?: unknown; thinking?: unknown };
    if (type === "text" && typeof text === "string") parts.push({ type: "text", content: cutText(text) });
    else if (type === "thinking" && typeof thinking === "string") parts.push({ type: "reasoning", content: cutText(thinking) });
    else if (type === "image" || type === "image_url") parts.push({ type: "text", content: "[image]" });
    // A provider's raw tool_use block repeats the message's tool_calls, read below.
  }
  return parts;
}

/** The plain text of a tool message's content. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  return contentParts(content)
    .map((part) => ("content" in part && typeof part.content === "string" ? part.content : ""))
    .join("");
}

/**
 * The conventions' messages for a list of LangChain messages, with the
 * saved conversation's rules applied across them: a withheld write's later
 * tool response is withheld by its call id.
 */
export function renderMessages(messages: readonly unknown[]): ChatMessage[] {
  const withheldCalls = new Set<string>();
  const out: ChatMessage[] = [];
  for (const raw of messages) {
    if (typeof raw !== "object" || raw === null) continue;
    const message = raw as LangChainMessage;
    const role = typeof message.type === "string" ? ROLE_OF[message.type] : undefined;
    if (role === undefined) continue;
    if (role === "tool") {
      const id = typeof message.tool_call_id === "string" ? message.tool_call_id : undefined;
      const withheld = id !== undefined && withheldCalls.has(id);
      out.push({ role, parts: [{ type: "tool_call_response", ...(id ? { id } : {}), response: exportedResult(contentText(message.content), withheld) }] });
      continue;
    }
    const parts = contentParts(message.content);
    for (const call of message.tool_calls ?? []) {
      const exported = exportedArguments(call.name, call.args ?? {});
      if (exported.withheld && call.id) withheldCalls.add(call.id);
      parts.push({ type: "tool_call", ...(call.id ? { id: call.id } : {}), name: call.name, arguments: exported.arguments });
    }
    out.push({ role, parts });
  }
  return out;
}

/** One model call's content: what it was told, what it was sent, what it answered. */
export interface ChatContent {
  readonly systemInstructions: string | undefined;
  readonly inputMessages: string;
  readonly outputMessages: string;
}

/**
 * The three content attributes of a `chat` span, bounded together to
 * {@link SPAN_CONTENT_BYTES}: the oldest input messages go first.
 */
export function chatContent(args: {
  readonly system: string | undefined;
  readonly messages: readonly unknown[];
  readonly response: unknown;
  readonly finishReason: string | undefined;
}): ChatContent {
  const system = args.system ? JSON.stringify([{ type: "text", content: cutText(args.system) }]) : undefined;
  const output = renderMessages([args.response]).map((message) => ({ ...message, finish_reason: args.finishReason ?? "stop" }));
  const outputJson = boundedJson(output, SPAN_CONTENT_BYTES / 4);
  const systemJson = system === undefined ? undefined : Buffer.byteLength(system) <= SPAN_CONTENT_BYTES / 4 ? system : elidedBytes(system);
  const left = SPAN_CONTENT_BYTES - Buffer.byteLength(outputJson) - (systemJson === undefined ? 0 : Buffer.byteLength(systemJson));
  return { systemInstructions: systemJson, inputMessages: elideOldest(renderMessages(args.messages), left), outputMessages: outputJson };
}

/** The `invoke_agent` span's content: the turn's request, and its answer once there is one. */
export function turnContent(request: string, answer: string | undefined): { readonly input: string; readonly output: string | undefined } {
  const input = boundedJson([{ role: "user", parts: [{ type: "text", content: cutText(request) }] }], SPAN_CONTENT_BYTES / 2);
  const output =
    answer === undefined
      ? undefined
      : boundedJson([{ role: "assistant", parts: [{ type: "text", content: cutText(answer) }], finish_reason: "stop" }], SPAN_CONTENT_BYTES / 2);
  return { input, output };
}

// ─── Bounds ───────────────────────────────────────────────────────────────

/** `messages` as JSON within `budget` bytes, the oldest dropped first behind one marker. */
function elideOldest(messages: readonly ChatMessage[], budget: number): string {
  const whole = JSON.stringify(messages);
  if (Buffer.byteLength(whole) <= budget) return whole;
  // Keep the newest messages that fit beside the marker, walking back from the end.
  const sizes = messages.map((message) => Buffer.byteLength(JSON.stringify(message)) + 1);
  let used = Buffer.byteLength(JSON.stringify([{ elided_messages: messages.length }]));
  let kept = 0;
  for (let i = messages.length - 1; i >= 0 && used + sizes[i]! <= budget; i -= 1) {
    used += sizes[i]!;
    kept += 1;
  }
  const marker: ElidedMessages = { elided_messages: messages.length - kept };
  const document = JSON.stringify([marker, ...messages.slice(messages.length - kept)]);
  return Buffer.byteLength(document) <= budget ? document : elidedBytes(whole);
}

/** `value` as JSON when it fits in `budget` bytes; otherwise a marker naming its size. */
function boundedJson(value: unknown, budget: number): string {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json) <= budget ? json : elidedBytes(json);
}

/** The marker an attribute too large to carry reads in its place. */
function elidedBytes(json: string): string {
  return JSON.stringify({ elided_bytes: Buffer.byteLength(json) });
}

/**
 * Mark `span` failed: ERROR and `error.type` always; the failure's text
 * (cut) and the exception only with content on, because an error can quote
 * what the call was given.
 */
export function markFailed(span: Span, errorType: string, failure: { readonly message: string; readonly error?: Error }, content: boolean): void {
  span.setAttribute(ERROR_TYPE, errorType);
  if (!content) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    return;
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message: cutText(failure.message) });
  if (failure.error !== undefined) span.recordException(failure.error);
}
