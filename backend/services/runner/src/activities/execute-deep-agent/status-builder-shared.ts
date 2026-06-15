/**
 * Shared utilities for both v2 StatusBuilder and V3StatusBuilder.
 *
 * Extracted from status-builder.ts so both builders share identical
 * token accumulation, tool result parsing, and approval arg sanitization
 * without duplication.
 */

import { create } from "@bufbuild/protobuf";
import { StreamingUsageSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type { StreamingUsageSummary } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { utcTimestamp } from "../../shared/status.js";

// ── Usage Accumulator ──────────────────────────────────────────────

export interface UsageSnapshot {
  inputTokens: bigint;
  outputTokens: bigint;
  cacheReadTokens: bigint;
  cacheWriteTokens: bigint;
  totalTokens: bigint;
  turnCount: number;
  observedAt: string;
}

export class UsageAccumulator {
  private inputTokens = 0n;
  private outputTokens = 0n;
  private cacheReadTokens = 0n;
  private cacheWriteTokens = 0n;
  private turnCount = 0;
  private lastObservedAt = "";

  accumulate(meta: Record<string, unknown>): void {
    this.inputTokens += toBigInt(meta.input_tokens);
    this.outputTokens += toBigInt(meta.output_tokens);
    this.cacheReadTokens += toBigInt(meta.cache_read_input_tokens);
    this.cacheWriteTokens += toBigInt(meta.cache_creation_input_tokens);
    this.turnCount++;
    this.lastObservedAt = utcTimestamp();
  }

  snapshot(): UsageSnapshot {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cacheReadTokens: this.cacheReadTokens,
      cacheWriteTokens: this.cacheWriteTokens,
      totalTokens: this.inputTokens + this.outputTokens +
        this.cacheReadTokens + this.cacheWriteTokens,
      turnCount: this.turnCount,
      observedAt: this.lastObservedAt,
    };
  }

  /** Create a protobuf StreamingUsageSummary from the current snapshot. */
  toProto(): StreamingUsageSummary {
    return create(StreamingUsageSummarySchema, this.snapshot());
  }
}

// ── BigInt Coercion ────────────────────────────────────────────────

export function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.floor(value));
  return 0n;
}

// ── Tool Result Extraction ─────────────────────────────────────────

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

export function extractToolResult(data: Record<string, unknown>): string {
  const output = data.output;
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const fromContent = serializeToolContent((output as Record<string, unknown>).content);
    if (fromContent !== undefined) return fromContent;
  }
  try {
    return JSON.stringify(output ?? data);
  } catch {
    return "[serialization error]";
  }
}

/**
 * Extract tool result from v3 tool-finished output.
 * v3 output wraps LangChain ToolMessage in a constructor envelope:
 * `{ lc, type, id, kwargs: { content, status, ... } }`
 */
export function extractToolResultV3(output: unknown): string {
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
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

// ── Approval Args Sanitization ─────────────────────────────────────

const SENSITIVE_ARG_KEYS = new Set([
  "password", "token", "secret", "api_key", "apikey",
  "credentials", "auth", "authorization",
]);

const MAX_ARGS_PREVIEW_LENGTH = 500;

export function sanitizeArgsPreview(args: Record<string, unknown>): string {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_ARG_KEYS.has(key.toLowerCase())) {
      sanitized[key] = "[REDACTED]";
    } else {
      sanitized[key] = value;
    }
  }
  try {
    const json = JSON.stringify(sanitized);
    return json.length > MAX_ARGS_PREVIEW_LENGTH
      ? json.slice(0, MAX_ARGS_PREVIEW_LENGTH) + "…"
      : json;
  } catch {
    return "";
  }
}
