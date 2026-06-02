/**
 * V3ProtocolNormalizer — converts raw LangGraph v3 ProtocolEvents
 * into the StigmerRunEvent discriminated union.
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
import type { StigmerRunEvent, V3UsagePayload } from "./v3-events.js";
import { formatNamespace } from "./v3-events.js";

const loggedUnknowns = new Set<string>();

export function normalize(event: V3ProtocolEvent): StigmerRunEvent[] {
  const method = event.method;

  switch (method) {
    case "messages": return normalizeMessage(event);
    case "tools": return normalizeTool(event);
    case "lifecycle": return normalizeLifecycle(event);
    default:
      return [];
  }
}

// ── Messages Channel ──────────────────────────────────────────────

function normalizeMessage(event: V3ProtocolEvent): StigmerRunEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);
  const base = {
    seq: event.seq,
    namespace: formatNamespace(event.params.namespace),
    node: event.params.node,
  };
  const runId = (data.run_id ?? "") as string;

  switch (eventType) {
    case "message-start":
      return [{
        kind: "message_start" as const,
        ...base,
        runId,
        messageId: data.id as string | undefined,
      }];

    case "content-block-delta":
      return normalizeContentBlockDelta(event, data, base, runId);

    case "message-finish":
      return [{
        kind: "message_finish" as const,
        ...base,
        runId,
        usage: normalizeUsagePayload(data.usage as Record<string, unknown> | undefined),
        reason: data.reason as string | undefined,
      }];

    case "usage":
      return [{
        kind: "usage" as const,
        ...base,
        runId,
        usage: normalizeUsagePayload(data.usage as Record<string, unknown> | undefined)!,
      }];

    case "provider":
      return [{
        kind: "provider" as const,
        ...base,
        provider: (data.provider ?? "") as string,
        model: extractModel(data),
      }];

    case "content-block-start":
    case "content-block-finish":
      return [];

    default:
      logUnknown("messages", eventType);
      return [];
  }
}

function normalizeContentBlockDelta(
  event: V3ProtocolEvent,
  data: Record<string, unknown>,
  base: { seq: number; namespace: string; node?: string },
  runId: string,
): StigmerRunEvent[] {
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
      return [{
        kind: "tool_call_arg_delta" as const,
        ...base,
        callId,
        argsChunk,
      }];
    }
  }

  return [];
}

// ── Tools Channel ─────────────────────────────────────────────────

function normalizeTool(event: V3ProtocolEvent): StigmerRunEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  const eventType = readEventType(data);
  const base = {
    seq: event.seq,
    namespace: formatNamespace(event.params.namespace),
    node: event.params.node,
  };

  switch (eventType) {
    case "tool-started": {
      const callId = readToolCallId(data);
      const name = readToolName(data);
      const input = parseToolInput(data.input);
      return [{
        kind: "tool_started" as const,
        ...base,
        callId,
        name,
        input,
      }];
    }

    case "tool-finished": {
      const callId = readToolCallId(data);
      return [{
        kind: "tool_finished" as const,
        ...base,
        callId,
        output: data.output,
      }];
    }

    case "tool-error": {
      const callId = readToolCallId(data);
      const message = (data.message ?? data.error ?? "") as string;
      return [{
        kind: "tool_error" as const,
        ...base,
        callId,
        message,
      }];
    }

    case "tool-output-delta": {
      const callId = readToolCallId(data);
      const delta = (data.delta ?? "") as string;
      return [{
        kind: "tool_output_delta" as const,
        ...base,
        callId,
        delta: String(delta),
      }];
    }

    default:
      logUnknown("tools", eventType);
      return [];
  }
}

// ── Lifecycle Channel ─────────────────────────────────────────────

function normalizeLifecycle(event: V3ProtocolEvent): StigmerRunEvent[] {
  const data = event.params.data as Record<string, unknown> | undefined;
  if (!data) return [];

  return [{
    kind: "lifecycle" as const,
    seq: event.seq,
    namespace: formatNamespace(event.params.namespace),
    node: event.params.node,
    event: readEventType(data),
    graphName: (data.graph_name ?? data.graphName) as string | undefined,
  }];
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

function extractModel(data: Record<string, unknown>): string | undefined {
  const payload = data.payload as Record<string, unknown> | undefined;
  return payload?.model as string | undefined;
}

function logUnknown(method: string, eventType: string): void {
  const key = `${method}:${eventType}`;
  if (loggedUnknowns.has(key)) return;
  loggedUnknowns.add(key);
  console.debug(`[V3Normalizer] Unknown event: method=${method} event=${eventType}`);
}
