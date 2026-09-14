/**
 * V3ProtocolNormalizer — converts raw LangGraph v3 ProtocolEvents
 * into the `TranscriptEvent` union (`harness/transcript/events.ts`).
 *
 * The native harness's translator: the one module that knows LangGraph's
 * wire shape and emits the canonical event the shared builder folds (S4,
 * `T01_0_plan.md` §3). It also answers the loop's one non-transcript
 * question about the wire — {@link usageOf}, the usage a `message-finish`
 * carries (S4 M2 C1) — so the loop never parses a raw event itself. It
 * renders a tool's result to the string the row carries (C2a, C2b; the
 * LangChain envelope and the LangGraph Command are its to unwrap, never the
 * builder's). At later M2 commits it takes over what the builder still knows
 * of the engine — the sub-agent scope resolution, the gate answer — and
 * emits `sub_agent_started/finished/failed` for a `task` call (Q-S4-4).
 *
 * What the wire carries that the transcript does not (C1): `lifecycle` and
 * `provider` events, the standalone `usage` event, and each event's `seq`
 * and `node`. None of it was ever folded; the recorder keeps the raw event
 * for a replay, so nothing is lost by not translating it.
 *
 * Stateless: each event is self-describing per real recordings.
 * Routes by `event.method`, then by `data.event` within channels.
 *
 * Defensive parsing: handles both snake_case and camelCase field names
 * for tool IDs/names (protocol spec uses camelCase but recordings show
 * snake_case). Uses `data.event` as canonical discriminator, with
 * `data.type` as fallback (CP04 finding).
 */

import type { V3ProtocolEvent } from "./v3-event-recorder.js";
import type { TranscriptEvent } from "../../harness/transcript/events.js";

const loggedUnknowns = new Set<string>();

/**
 * The namespace string every emitted event carries: `""` for the root graph,
 * the LangGraph namespace segments joined with `|` for a nested one. The
 * grammar is this translator's (S4 M1, Q-M1-4): the builder reads only the
 * segment count (`namespaceDepth`) and stops reading even that at M2 C4, when
 * scope becomes `subAgentId?` (Q-S4-3).
 */
function formatNamespace(ns: readonly string[]): string {
  return ns.length === 0 ? "" : ns.join("|");
}

export function normalize(event: V3ProtocolEvent): TranscriptEvent[] {
  const method = event.method;

  switch (method) {
    case "messages": return normalizeMessage(event);
    case "tools": return normalizeTool(event);
    default:
      return [];
  }
}

// ── Usage ─────────────────────────────────────────────────────────

/**
 * The token usage as LangChain's v3 protocol delivers it on a
 * `message-finish`. `input_tokens` already INCLUDES the cache buckets (the
 * Anthropic adapter folds them in); the loop prices over the disjoint parts.
 */
export interface V3UsagePayload {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
  readonly input_token_details?: {
    readonly cache_creation?: number;
    readonly cache_read?: number;
  };
}

/**
 * The usage one raw event carries, or `undefined`. Read from `message-finish`
 * ONLY — v3 also emits a standalone `usage` event for the same turn, and
 * reading both would double-count. Every namespace's finish counts: a
 * sub-agent's spend is the execution's spend (S3 M2b, Q-M2b-1), and the cost
 * cap the runtime enforces reads the whole execution.
 *
 * A loop concern, deliberately NOT a `TranscriptEvent` (S4 M2 C1, Q-M2-3):
 * usage is neither a row nor a message, and `translate`'s return type stays
 * the one signature every harness's translator shares. The Cursor loop reads
 * its usage from the SDK's `turn-ended` delta — the same division.
 */
export function usageOf(event: V3ProtocolEvent): V3UsagePayload | undefined {
  if (event.method !== "messages") return undefined;
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data || readEventType(data) !== "message-finish") return undefined;
  return normalizeUsagePayload(data.usage as Record<string, unknown> | undefined);
}

// ── Messages Channel ──────────────────────────────────────────────

function normalizeMessage(event: V3ProtocolEvent): TranscriptEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);
  const base = { namespace: formatNamespace(event.params.namespace) };
  const runId = (data.run_id ?? "") as string;

  switch (eventType) {
    case "message-start":
      return [{ kind: "message_start" as const, ...base, runId }];

    case "content-block-delta":
      return normalizeContentBlockDelta(data, base, runId);

    case "message-finish":
      return [{ kind: "message_finish" as const, ...base, runId }];

    // Carried by the wire, not by the transcript (see the header).
    case "usage":
    case "provider":
    case "content-block-start":
    case "content-block-finish":
      return [];

    default:
      logUnknown("messages", eventType);
      return [];
  }
}

function normalizeContentBlockDelta(
  data: Record<string, unknown>,
  base: { namespace: string },
  runId: string,
): TranscriptEvent[] {
  const delta = data.delta as Record<string, unknown> | undefined;
  if (!delta) return [];

  const deltaType = delta.type as string | undefined;

  if (deltaType === "text-delta") {
    const text = (delta.text ?? "") as string;
    if (!text) return [];
    return [{ kind: "text_delta" as const, ...base, runId, text }];
  }

  if (deltaType === "reasoning-delta") {
    const text = (delta.reasoning ?? "") as string;
    if (!text) return [];
    return [{ kind: "reasoning_delta" as const, ...base, runId, text }];
  }

  if (deltaType === "block-delta") {
    const fields = delta.fields as Record<string, unknown> | undefined;
    if (!fields) return [];
    if (fields.type === "tool_call_chunk") {
      const callId = (fields.id ?? "") as string;
      const argsChunk = (fields.args ?? "") as string;
      if (!argsChunk && !callId) return [];
      return [{ kind: "tool_arg_delta" as const, ...base, callId, argsChunk }];
    }
  }

  return [];
}

// ── Tools Channel ─────────────────────────────────────────────────

function normalizeTool(event: V3ProtocolEvent): TranscriptEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);
  const base = { namespace: formatNamespace(event.params.namespace) };

  switch (eventType) {
    case "tool-started": {
      const callId = readToolCallId(data);
      const name = readToolName(data);
      const input = parseToolInput(data.input);
      return [{ kind: "tool_started" as const, ...base, callId, name, input }];
    }

    case "tool-finished": {
      const callId = readToolCallId(data);
      return [{ kind: "tool_finished" as const, ...base, callId, result: extractToolResult(data.output) }];
    }

    case "tool-error": {
      const callId = readToolCallId(data);
      const message = (data.message ?? data.error ?? "") as string;
      return [{ kind: "tool_error" as const, ...base, callId, message }];
    }

    case "tool-output-delta": {
      const callId = readToolCallId(data);
      const delta = (data.delta ?? "") as string;
      return [{ kind: "tool_output_delta" as const, ...base, callId, delta: String(delta) }];
    }

    default:
      logUnknown("tools", eventType);
      return [];
  }
}

// ── Tool Result ───────────────────────────────────────────────────

/**
 * Serialize a LangChain message `content` field into the canonical tool-result
 * string.
 *
 * Text-only content is a plain string and passes through unchanged. Multimodal
 * content (image, or mixed text+image — e.g. a computer-use screenshot) is an
 * array of content blocks; we serialize the blocks array ITSELF, not the
 * surrounding message envelope, so the result lands in the exact top-level-array
 * shape the persist-time offload (`detectImagePayload`/`contentBlocks` in
 * status-offload.ts) consumes to lift the image out into a renderable
 * `ToolCallOutputRef`. Serializing the envelope instead would bury the base64
 * one level deeper and defeat that detection.
 *
 * Returns undefined when `content` is neither a string nor an array, letting the
 * caller fall back to serializing whatever else it holds.
 */
function serializeToolContent(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return JSON.stringify(content);
  return undefined;
}

/**
 * The `result: string` a `tool_finished` carries, from the v3 `tool-finished`
 * output — engine knowledge that stays on this side of the union (S4 M2 C2a,
 * Q-S4-3; it was `extractToolResultV3` in `harness/transcript/tool-result.ts`
 * between M1 and M2). v3 wraps a LangChain `ToolMessage` in a constructor
 * envelope, `{ lc, type, id, kwargs: { content, status, ... } }`; the content
 * is what the row shows. Anything else is serialized as it came.
 *
 * A state-mutating tool returns a LangGraph `Command` instead —
 * `{ lg_name: "Command", update: { ..., messages: [ToolMessage] }, goto }` —
 * with its ToolMessage nested in the update (deepagents' `write_todos` and
 * `task` both do). The row shows that ToolMessage's content, not the whole
 * Command (S4 M2 C2b, Q-S4-21; until then the row carried the serialized
 * Command, the todos array twice over — M0 finding F-M0-2).
 */
function extractToolResult(output: unknown): string {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    const commandMessage = toolMessageOfCommand(obj);
    if (commandMessage !== undefined) return extractToolResult(commandMessage);
    const kwargs = obj.kwargs as Record<string, unknown> | undefined;
    if (kwargs) {
      const fromKwargs = serializeToolContent(kwargs.content);
      if (fromKwargs !== undefined) return fromKwargs;
    }
    const fromContent = serializeToolContent(obj.content);
    if (fromContent !== undefined) return fromContent;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return "[serialization error]";
  }
}

/**
 * The ToolMessage a LangGraph `Command` carries in `update.messages`, or
 * `undefined` when the object is not a Command or carries none. The LAST
 * message is the tool's own reply (a Command may prepend others); a Command
 * with no message falls through to plain serialization, so nothing is lost.
 */
function toolMessageOfCommand(obj: Record<string, unknown>): unknown {
  if (obj.lg_name !== "Command") return undefined;
  const update = obj.update as Record<string, unknown> | undefined;
  const messages = update?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  return messages[messages.length - 1];
}

// ── Defensive Field Parsers ───────────────────────────────────────

function readEventType(data: Record<string, unknown>): string {
  return ((data.event ?? data.type) as string) ?? "";
}

function readToolCallId(data: Record<string, unknown>): string {
  return ((data.tool_call_id ?? data.toolCallId) as string) ?? "";
}

function readToolName(data: Record<string, unknown>): string {
  return ((data.tool_name ?? data.toolName ?? data.name) as string) ?? "unknown_tool";
}

function parseToolInput(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try { return JSON.parse(raw) as Record<string, unknown>; }
    catch { return {}; }
  }
  return {};
}

function normalizeUsagePayload(raw: Record<string, unknown> | undefined): V3UsagePayload | undefined {
  if (!raw) return undefined;
  const details = raw.input_token_details as Record<string, unknown> | undefined;
  return {
    input_tokens: raw.input_tokens as number | undefined,
    output_tokens: raw.output_tokens as number | undefined,
    total_tokens: raw.total_tokens as number | undefined,
    input_token_details: details ? {
      cache_creation: details.cache_creation as number | undefined,
      cache_read: details.cache_read as number | undefined,
    } : undefined,
  };
}

function logUnknown(method: string, eventType: string): void {
  const key = `${method}:${eventType}`;
  if (loggedUnknowns.has(key)) return;
  loggedUnknowns.add(key);
  console.debug(`[V3Normalizer] Unknown event: method=${method} event=${eventType}`);
}
