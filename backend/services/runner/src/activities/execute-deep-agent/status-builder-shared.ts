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
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { utcTimestamp } from "../../shared/status.js";
import {
  POLICY_ENGINE_VERSION,
  resolveApprovalProvenance,
  toProtoPolicySource,
  type MergedToolPolicy,
} from "../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";

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

// ── Authorization Provenance ───────────────────────────────────────

/**
 * The policy inputs the StatusBuilders need to attribute a tool call's approval
 * provenance. The full {@link ApprovalPolicyProvider} (status-builder.ts) is
 * structurally this — defined here so the shared stamper has no import cycle back
 * into the builders.
 */
export interface ApprovalProvenanceInputs {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  /**
   * Built-in categories with a run-lifetime lease, so a leased built-in is
   * attributed to its lease (approval_lease) rather than the plain category gate.
   * Optional (mirroring {@link ApprovalGateConfig.leasedCategories}); absent =
   * no lease active.
   */
  readonly leasedCategories?: ReadonlySet<ToolApprovalCategory>;
  /** Pre-armed spec.auto_approve_all — the one whole-run global bypass. */
  readonly globalBypass: boolean;
}

/** Shared empty set so a provider without leases allocates nothing per call. */
const NO_LEASED_CATEGORIES: ReadonlySet<ToolApprovalCategory> = new Set();

/**
 * Stamp a tool call's authorization provenance — which policy layer governs it —
 * alongside `tool_kind`, in exactly the spot both builders classify the tool.
 *
 * This is the read-side companion to the gate: it records WHY a tool is gated or
 * auto-approved for every observed tool call, so the persisted record is
 * auditable and the UI can explain the gate. Built-ins that no layer governs (a
 * read-only built-in) and the no-provider path both leave the field at
 * UNSPECIFIED, like an unclassified tool_kind.
 */
export function stampApprovalProvenance(
  tc: ToolCall,
  provider: ApprovalProvenanceInputs | null,
): void {
  if (!provider) return;
  const serverSlug = tc.mcpServerSlug || provider.toolServerMap.get(tc.name) || "";
  const source = resolveApprovalProvenance(
    tc.name,
    serverSlug,
    provider.policies,
    provider.leasedCategories ?? NO_LEASED_CATEGORIES,
    provider.globalBypass,
  );
  tc.approvalPolicySource = toProtoPolicySource(source);
  if (source) tc.policyEngineVersion = POLICY_ENGINE_VERSION;
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
