/**
 * V3ProtocolNormalizer — converts raw LangGraph v3 ProtocolEvents
 * into the `TranscriptEvent` union (`harness/transcript/events.ts`).
 *
 * The native harness's translator: the one module that knows LangGraph's
 * wire shape and emits the canonical event the shared builder folds (S4,
 * `T01_0_plan.md` §3). It also answers the loop's one non-transcript
 * question about the wire — {@link usageOf}, the usage a `message-finish`
 * carries (S4 M2 C1) — so the loop never parses a raw event itself. At
 * later M2 commits it takes over what the builder still knows of the
 * engine — `extractToolResultV3` and the Command unwrap (Q-S4-3, Q-S4-21),
 * the sub-agent scope resolution, the gate answer — and emits
 * `sub_agent_started/finished/failed` for a `task` call (Q-S4-4).
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
      return [{ kind: "tool_finished" as const, ...base, callId, output: data.output }];
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
