/**
 * Size-bounding guard for the persisted AgentExecutionStatus payload.
 *
 * Tool outputs (an MCP screenshot's base64 image, a giant accessibility-tree
 * dump, a multi-MB shell log, a huge file write) are stored inline in
 * `ToolCall.result`/`args_preview`, which live in `status.messages` and are
 * re-serialized whole on every `persistStatus` -> `updateStatus` gRPC call.
 * Left unchecked, a single large result pushes the message past the server's
 * 4 MiB gRPC receive cap; the call fails with `resource_exhausted`, progress
 * stops persisting, and the live UI freezes mid-execution.
 *
 * This module enforces, at the single persist boundary, that the payload stays
 * under the limit:
 *
 *   1. offloadOversizedToolOutputs — per-tool-call, SIZE-DRIVEN (not keyed on
 *      tool type): any result over the byte threshold is spilled to artifact
 *      storage and replaced with a short head plus a typed ToolCallOutputRef.
 *      Images are uploaded as their decoded bytes (so the UI can render an
 *      <img>); other large output is uploaded as text with a preview head.
 *      Idempotent and content-hash-deduped so the throttled, repeated persists
 *      (and result re-inflation by mergeToolCallEvent) upload each blob once.
 *
 *   2. enforceStatusSizeLimit — an aggregate, type-agnostic backstop that runs
 *      even when no artifact storage is available: if the encoded status still
 *      exceeds a soft cap (comfortably under 4 MiB), it elides the largest
 *      remaining inline fields in place until the payload fits.
 *
 * Both operate ONLY on what is persisted/streamed; the agent's working context
 * is managed by the harness/SDK separately, so reasoning is unaffected.
 */

import { createHash } from "node:crypto";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ToolCallOutputRefSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ArtifactStorage } from "./artifact-storage.js";

/**
 * A single tool output (result or args_preview) larger than this many bytes is
 * offloaded to artifact storage instead of inlined into the persisted status.
 * 256 KiB is generous for ordinary tool output yet far below the 4 MiB cap, so
 * even a handful of large-but-sub-threshold results cannot aggregate past it.
 */
export const INLINE_TOOL_OUTPUT_MAX_BYTES = 256 * 1024;

/** Head of an offloaded text result kept inline for an at-a-glance preview. */
export const TEXT_PREVIEW_HEAD_CHARS = 4_000;

/**
 * Soft cap for the whole encoded status. Kept comfortably under the 4 MiB gRPC
 * receive limit so the aggregate backstop trims before the server ever rejects.
 */
export const STATUS_PAYLOAD_SOFT_LIMIT_BYTES = 3 * 1024 * 1024;

/**
 * Tighter cap used only after the server has already rejected a payload as too
 * large, to maximize the chance the retry succeeds.
 */
export const STATUS_PAYLOAD_HARD_LIMIT_BYTES = 2 * 1024 * 1024;

/** Marker left in place of an aggregate-elided inline field. */
const ELISION_MARKER = "[output elided to keep status under the size limit]";

/** Below this size an inline field is not worth eliding (the marker is ~50B). */
const ELISION_MIN_BYTES = 1_024;

export interface ToolOutputOffloadContext {
  readonly artifactStorage: ArtifactStorage;
  readonly executionId: string;
  /** Override the per-result byte threshold (tests use a small value). */
  readonly maxInlineBytes?: number;
}

interface ImagePayload {
  readonly base64: string;
  readonly mimeType: string;
}

function byteLen(s: string | undefined): number {
  return s ? Buffer.byteLength(s, "utf8") : 0;
}

function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function headChars(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

function extFromMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    default: return "bin";
  }
}

function matchDataUrl(s: string): ImagePayload | null {
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2].replace(/\s+/g, "") };
}

function contentBlocks(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const c = (parsed as Record<string, unknown>).content;
    if (Array.isArray(c)) return c;
  }
  return [];
}

/**
 * Best-effort extraction of an inline base64 image from a tool result string.
 * Handles a raw data URL, MCP image content blocks ({type:"image", data,
 * mimeType}) and OpenAI-style image_url blocks. Returns null for non-image or
 * unparseable results so the caller falls back to text offload.
 */
export function detectImagePayload(result: string): ImagePayload | null {
  const direct = matchDataUrl(result.trim());
  if (direct) return direct;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }

  for (const block of contentBlocks(parsed)) {
    if (!block || typeof block !== "object") continue;
    const obj = block as Record<string, unknown>;
    const type = typeof obj.type === "string" ? obj.type : "";
    if (type !== "image" && type !== "image_url") continue;

    const raw =
      typeof obj.data === "string" ? obj.data :
      typeof obj.image === "string" ? obj.image :
      undefined;
    if (raw) {
      const asUrl = matchDataUrl(raw);
      if (asUrl) return asUrl;
      const mimeType =
        typeof obj.mimeType === "string" ? obj.mimeType :
        typeof obj.mime_type === "string" ? obj.mime_type :
        "image/png";
      return { mimeType, base64: raw.replace(/\s+/g, "") };
    }

    const imageUrl = obj.image_url;
    if (imageUrl && typeof imageUrl === "object") {
      const url = (imageUrl as Record<string, unknown>).url;
      if (typeof url === "string") {
        const asUrl = matchDataUrl(url);
        if (asUrl) return asUrl;
      }
    }
  }
  return null;
}

function collapsedResultFor(ref: { isImage: boolean; sizeBytes: bigint; truncatedPreview: string }): string {
  if (ref.isImage) {
    return `[image output — ${formatBytes(Number(ref.sizeBytes))}, view inline]`;
  }
  const tail = `\n\n[output truncated — ${formatBytes(Number(ref.sizeBytes))} total; view full output]`;
  return ref.truncatedPreview + tail;
}

async function maybeOffloadToolCall(
  tc: ToolCall,
  ctx: ToolOutputOffloadContext,
  maxBytes: number,
): Promise<void> {
  const result = tc.result;
  if (!result || byteLen(result) <= maxBytes) return;

  const hash = sha256(result);

  // Idempotent: the same content was already offloaded on a prior persist (or
  // mergeToolCallEvent re-inflated `result` with identical bytes). Re-collapse
  // the inline copy without re-uploading.
  if (tc.outputRef && tc.outputRef.contentHash === hash) {
    tc.result = collapsedResultFor(tc.outputRef);
    return;
  }

  const image = detectImagePayload(result);
  if (image) {
    const bytes = Buffer.from(image.base64, "base64");
    const key = `artifacts/${ctx.executionId}/toolcalls/${tc.id}.${extFromMime(image.mimeType)}`;
    await ctx.artifactStorage.upload(key, bytes, image.mimeType);
    const downloadUrl = await ctx.artifactStorage.getDownloadUrl(key);
    tc.outputRef = create(ToolCallOutputRefSchema, {
      storageKey: key,
      downloadUrl,
      sizeBytes: BigInt(bytes.length),
      contentHash: hash,
      mimeType: image.mimeType,
      isImage: true,
      truncatedPreview: "",
    });
    tc.result = collapsedResultFor(tc.outputRef);
    return;
  }

  const content = Buffer.from(result, "utf8");
  const key = `artifacts/${ctx.executionId}/toolcalls/${tc.id}.txt`;
  await ctx.artifactStorage.upload(key, content, "text/plain");
  const downloadUrl = await ctx.artifactStorage.getDownloadUrl(key);
  tc.outputRef = create(ToolCallOutputRefSchema, {
    storageKey: key,
    downloadUrl,
    sizeBytes: BigInt(content.length),
    contentHash: hash,
    mimeType: "text/plain",
    isImage: false,
    truncatedPreview: headChars(result, TEXT_PREVIEW_HEAD_CHARS),
  });
  tc.result = collapsedResultFor(tc.outputRef);
}

/**
 * Offload every oversized tool result in the status to artifact storage,
 * replacing the inline value with a short head + ToolCallOutputRef. Per-tool
 * failures fall back to an inline truncation (a bounded result beats a failed
 * persist) and never throw, so a storage hiccup cannot fail the execution.
 */
export async function offloadOversizedToolOutputs(
  status: AgentExecutionStatus,
  ctx: ToolOutputOffloadContext,
): Promise<void> {
  const maxBytes = ctx.maxInlineBytes ?? INLINE_TOOL_OUTPUT_MAX_BYTES;
  for (const msg of status.messages) {
    for (const tc of msg.toolCalls) {
      try {
        await maybeOffloadToolCall(tc, ctx, maxBytes);
      } catch (err) {
        const original = tc.result ?? "";
        tc.result =
          headChars(original, TEXT_PREVIEW_HEAD_CHARS) +
          `\n\n[output truncated — offload failed: ${err instanceof Error ? err.message : String(err)}]`;
        console.warn(
          `[status-offload] execution=${ctx.executionId} tool=${tc.name} ` +
          `offload failed (non-fatal); truncated inline`,
        );
      }
    }
  }
}

function encodedSize(status: AgentExecutionStatus): number {
  return toBinary(AgentExecutionStatusSchema, status).length;
}

/**
 * Aggregate, type-agnostic backstop. If the encoded status exceeds
 * `softLimitBytes`, elide the largest inline tool fields (and, as a last
 * resort, message content) in place until it fits. Returns true if anything
 * was elided. This guarantees a bounded payload even without artifact storage
 * (e.g. offload disabled) or when many medium results sum past the limit.
 */
export function enforceStatusSizeLimit(
  status: AgentExecutionStatus,
  softLimitBytes: number = STATUS_PAYLOAD_SOFT_LIMIT_BYTES,
): boolean {
  if (encodedSize(status) <= softLimitBytes) return false;

  const toolCalls: ToolCall[] = [];
  for (const msg of status.messages) {
    for (const tc of msg.toolCalls) toolCalls.push(tc);
  }
  // Largest inline footprint first so we shed the most bytes per elision.
  toolCalls.sort(
    (a, b) =>
      byteLen(b.result) + byteLen(b.argsPreview) -
      (byteLen(a.result) + byteLen(a.argsPreview)),
  );

  let elidedAny = false;
  for (const tc of toolCalls) {
    if (encodedSize(status) <= softLimitBytes) return elidedAny;
    if (byteLen(tc.result) > ELISION_MIN_BYTES) {
      tc.result = ELISION_MARKER;
      elidedAny = true;
    }
    if (byteLen(tc.argsPreview) > ELISION_MIN_BYTES) {
      tc.argsPreview = ELISION_MARKER;
      elidedAny = true;
    }
    if (tc.args !== undefined) {
      tc.args = undefined;
      elidedAny = true;
    }
  }

  // Last resort: oversized message content (e.g. a huge AI response).
  if (encodedSize(status) > softLimitBytes) {
    const byContent = [...status.messages].sort(
      (a, b) => byteLen(b.content) - byteLen(a.content),
    );
    for (const msg of byContent) {
      if (encodedSize(status) <= softLimitBytes) break;
      if (byteLen(msg.content) > ELISION_MIN_BYTES) {
        msg.content = headChars(msg.content, TEXT_PREVIEW_HEAD_CHARS) + `\n\n${ELISION_MARKER}`;
        elidedAny = true;
      }
    }
  }

  return elidedAny;
}
