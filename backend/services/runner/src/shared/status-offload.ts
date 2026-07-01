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
 *   2. offloadCandidateChangesToFit — an aggregate, storage-backed step for the
 *      file-review ledger: if the status still exceeds the soft cap after (1),
 *      it offloads the largest still-inline captured before/after bodies to
 *      retrievable refs (biggest-first) until it fits, so a captured file stays
 *      REVIEWABLE (the UI lazily fetches the ref) instead of being dropped. The
 *      persisted body is a display projection — reconcile sources bytes from the
 *      git refs / CAS manifest, never this body — so this is correctness-neutral.
 *
 *   3. enforceStatusSizeLimit — an aggregate, type-agnostic backstop that runs
 *      even when no artifact storage is available: if the encoded status still
 *      exceeds a soft cap (comfortably under 4 MiB), it elides the largest
 *      remaining inline fields in place until the payload fits. For file-review
 *      bodies this is the LAST resort (no storage, or (2) could not free enough):
 *      the body is dropped and the file marked SIZE_ELIDED / incomplete.
 *
 * All operate ONLY on what is persisted/streamed; the agent's working context
 * is managed by the harness/SDK separately, so reasoning is unaffected.
 */

import { createHash } from "node:crypto";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ToolCallOutputRefSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileChange, FileContent, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileReviewBlockReason } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ArtifactStorage } from "./artifact-storage.js";
import { deriveDiffCompleteness } from "./filereview/events.js";

/**
 * A single tool output (result or args_preview) larger than this many bytes is
 * offloaded to artifact storage instead of inlined into the persisted status.
 * 256 KiB is generous for ordinary tool output yet far below the 4 MiB cap, so
 * even a handful of large-but-sub-threshold results cannot aggregate past it.
 */
export const INLINE_TOOL_OUTPUT_MAX_BYTES = 256 * 1024;

/**
 * A single FileChange before/after body larger than this is offloaded to
 * artifact storage. Smaller than the 256 KiB tool-output cap because a file
 * change can carry two bodies (before + after) per change and several changes
 * per tool call, so the aggregate would otherwise climb quickly.
 */
export const INLINE_FILE_CONTENT_MAX_BYTES = 128 * 1024;

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

/**
 * Marker left in place of an aggregate-elided inline field. Exported so the
 * resume-time exact-apply resolver can recognize (and refuse to write) an elided
 * body rather than corrupting a file with the marker text — the lossy elision is
 * the one case where the exact approved bytes are unrecoverable and exact-apply
 * must fall back. The two sides cannot drift because they share this constant.
 */
export const ELISION_MARKER = "[output elided to keep status under the size limit]";

/** Below this size an inline field is not worth eliding (the marker is ~50B). */
const ELISION_MIN_BYTES = 1_024;

export interface ToolOutputOffloadContext {
  readonly artifactStorage: ArtifactStorage;
  readonly executionId: string;
  /** Override the per-result byte threshold (tests use a small value). */
  readonly maxInlineBytes?: number;
  /** Override the per-file-content-body byte threshold (tests use a small value). */
  readonly maxInlineFileBytes?: number;
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

/** Match an exact `data:image/...;base64,...` URL (the whole string). */
function matchDataUrl(s: string): ImagePayload | null {
  const m = s.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2].replace(/\s+/g, "") };
}

/**
 * Find a `data:image/...;base64,...` URL anywhere in a string — whether it IS
 * the whole result or is embedded in surrounding text/JSON. A data URL is an
 * unambiguous image signal, so scanning is safe (no false positives on ordinary
 * text). The base64 run is bounded by the first non-base64 character (e.g. a
 * closing JSON quote), so an embedded URL is extracted cleanly.
 */
function findDataUrlInString(s: string): ImagePayload | null {
  const m = s.match(/data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/);
  if (!m) return null;
  return { mimeType: m[1], base64: m[2].replace(/\s+/g, "") };
}

/**
 * Build an ImagePayload from a block's `data` + optional mime hint. Accepts the
 * shapes the Cursor SDK actually delivers for an image block's `data`:
 *   - Node Buffer-JSON ({ type:"Buffer", data:number[] }) — the runtime shape
 *     confirmed from a real cursor-harness get_app_state result. (The SDK's .d.ts
 *     types `data` as a string, but at runtime image bytes serialize as
 *     Buffer-JSON, so both must be handled.)
 *   - a `data:` URL string, or
 *   - a bare base64 string.
 * Anything else (a file path, a number) yields null, so only an explicit image
 * signal ever matches. The mime hint defaults to image/png when absent — Cursor
 * MCP image blocks frequently omit mimeType.
 */
function imageFromData(data: unknown, mime: unknown): ImagePayload | null {
  const mimeType = typeof mime === "string" && mime.length > 0 ? mime : "image/png";

  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (d.type === "Buffer" && Array.isArray(d.data)) {
      try {
        const base64 = Buffer.from(d.data as number[]).toString("base64");
        return base64.length > 0 ? { mimeType, base64 } : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  if (typeof data !== "string" || data.length === 0) return null;
  const asUrl = matchDataUrl(data);
  if (asUrl) return asUrl;
  return { mimeType, base64: data.replace(/\s+/g, "") };
}

/**
 * Extract an image from a single object IF it is a recognized image block.
 * Recognized shapes, all of which carry an explicit image marker (so an
 * arbitrary object never matches):
 *   - Cursor SDK MCP block:      { image: { data: <base64|dataUrl>, mimeType? } }
 *   - Anthropic/MCP-style block: { type: "image", data: <base64>, mimeType? }
 *   - OpenAI-style block:        { type: "image_url", image_url: { url: <dataUrl> } }
 *     (also tolerates { type: "image", image: <base64> })
 *
 * Returns null when no image marker is present, leaving the recursive walk to
 * keep searching siblings/children.
 */
function imageFromBlock(obj: Record<string, unknown>): ImagePayload | null {
  // Cursor SDK shape: the image rides under a nested `image` object. This is the
  // exact shape @cursor/sdk uses for MCP image content (see conversation-types),
  // which canonicalizeImageResult normalizes — but only when the result reaches
  // it as an object. A result delivered already-serialized (a string) bypasses
  // that, so detection must recognize this shape directly.
  if (obj.image && typeof obj.image === "object") {
    const img = obj.image as Record<string, unknown>;
    const payload = imageFromData(img.data, img.mimeType ?? img.mime_type);
    if (payload) return payload;
  }

  const type = typeof obj.type === "string" ? obj.type : "";
  if (type === "image" || type === "image_url") {
    const inline = imageFromData(
      typeof obj.data === "string" ? obj.data
        : typeof obj.image === "string" ? obj.image
        : undefined,
      obj.mimeType ?? obj.mime_type,
    );
    if (inline) return inline;

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

/**
 * Walk a parsed JSON value depth-first, returning the first recognized image
 * block. Recursing (rather than only checking the top level or a `content`
 * array) is what makes detection robust to HOW a harness wraps the image: a
 * multimodal MCP result may arrive as a top-level array, under `value.content`,
 * under `kwargs.content`, or nested deeper still. Because imageFromBlock
 * requires an explicit image marker, the walk never misclassifies ordinary
 * nested data as an image.
 */
function findImageInValue(value: unknown): ImagePayload | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageInValue(item);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const direct = imageFromBlock(obj);
    if (direct) return direct;
    for (const child of Object.values(obj)) {
      const found = findImageInValue(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Best-effort extraction of an inline image from a tool result string.
 *
 * An MCP tool that returns an image (e.g. a computer-use screenshot) must be
 * lifted into a renderable `ToolCallOutputRef`; otherwise it persists as text
 * and the UI shows raw JSON / "view full output" instead of the picture. The
 * image can arrive in many wrappers depending on the harness and whether the
 * result was pre-serialized, so detection looks for an UNAMBIGUOUS image signal
 * rather than a fixed envelope position:
 *
 *   1. a `data:image/*;base64,...` URL anywhere in the string, then
 *   2. a recognized image block at any depth of a JSON result
 *      (see {@link imageFromBlock}).
 *
 * Returns null for non-image or unparseable results so the caller falls back to
 * text offload. It deliberately does NOT treat a bare base64 string with no
 * image marker as an image — that would misclassify legitimate large text
 * (logs, base64-encoded files) as pictures.
 */
export function detectImagePayload(result: string): ImagePayload | null {
  const embeddedUrl = findDataUrlInString(result);
  if (embeddedUrl) return embeddedUrl;

  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    return null;
  }
  return findImageInValue(parsed);
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
  if (!result) return;

  const hash = sha256(result);

  // Idempotent: the same content was already offloaded on a prior persist (or
  // mergeToolCallEvent re-inflated `result` with identical bytes). Re-collapse
  // the inline copy without re-uploading.
  if (tc.outputRef && tc.outputRef.contentHash === hash) {
    tc.result = collapsedResultFor(tc.outputRef);
    return;
  }

  // Images are offloaded regardless of size, BEFORE the size gate below: a
  // `ToolCallOutputRef` is the only path the UI has to render an image inline,
  // so even a sub-threshold screenshot must be lifted out of `result` into a
  // renderable ref. Non-image text only offloads when it exceeds maxBytes.
  const image = detectImagePayload(result);
  if (image) {
    const bytes = Buffer.from(image.base64, "base64");
    const key = `artifacts/${ctx.executionId}/toolcalls/${tc.id}.${extFromMime(image.mimeType)}`;
    await ctx.artifactStorage.upload(key, bytes, image.mimeType);
    tc.outputRef = create(ToolCallOutputRefSchema, {
      storageKey: key,
      sizeBytes: BigInt(bytes.length),
      contentHash: hash,
      mimeType: image.mimeType,
      isImage: true,
      truncatedPreview: "",
    });
    tc.result = collapsedResultFor(tc.outputRef);
    return;
  }

  // Non-image text below the inline budget stays inline; only oversized text is
  // spilled (with a head preview) to keep the persisted payload bounded.
  if (byteLen(result) <= maxBytes) return;

  const content = Buffer.from(result, "utf8");
  const key = `artifacts/${ctx.executionId}/toolcalls/${tc.id}.txt`;
  await ctx.artifactStorage.upload(key, content, "text/plain");
  tc.outputRef = create(ToolCallOutputRefSchema, {
    storageKey: key,
    sizeBytes: BigInt(content.length),
    contentHash: hash,
    mimeType: "text/plain",
    isImage: false,
    truncatedPreview: headChars(result, TEXT_PREVIEW_HEAD_CHARS),
  });
  tc.result = collapsedResultFor(tc.outputRef);
}

/**
 * Spill one side (before/after) of a file change to artifact storage when its
 * inline body exceeds the cap, replacing the inline body with a ref carrying a
 * head preview. A side that is absent, already a ref (offloaded on a prior
 * persist), or under the cap is left untouched — the `case === "ref"` check
 * makes this idempotent across the throttled, repeated persists.
 */
async function maybeOffloadFileContent(
  content: FileContent | undefined,
  key: string,
  ctx: ToolOutputOffloadContext,
  maxBytes: number,
): Promise<void> {
  if (!content || content.body.case !== "inline") return;
  const text = content.body.value;
  if (byteLen(text) <= maxBytes) return;

  const bytes = Buffer.from(text, "utf8");
  await ctx.artifactStorage.upload(key, bytes, "text/plain");
  content.body = {
    case: "ref",
    value: create(ToolCallOutputRefSchema, {
      storageKey: key,
      sizeBytes: BigInt(bytes.length),
      contentHash: sha256(text),
      mimeType: "text/plain",
      isImage: false,
      truncatedPreview: headChars(text, TEXT_PREVIEW_HEAD_CHARS),
    }),
  };
}

/** Offload oversized before/after bodies of every file change on a tool call. */
async function maybeOffloadFileChanges(
  tc: ToolCall,
  ctx: ToolOutputOffloadContext,
  maxBytes: number,
): Promise<void> {
  for (let idx = 0; idx < tc.fileChanges.length; idx++) {
    const fc = tc.fileChanges[idx];
    const base = `artifacts/${ctx.executionId}/toolcalls/${tc.id}.${idx}`;
    await maybeOffloadFileContent(fc.before, `${base}.before.txt`, ctx, maxBytes);
    await maybeOffloadFileContent(fc.after, `${base}.after.txt`, ctx, maxBytes);
  }
}

/**
 * Every captured file change carried on a CANDIDATE_CAPTURED event in the
 * file_review ledger. The before/after bodies live HERE (not on tool calls)
 * under the apply-then-review model, so the persist-boundary size guards must
 * cover this location too — otherwise a large captured file silently pushes the
 * status past the gRPC cap (the freeze this module exists to prevent).
 */
function candidateChanges(status: AgentExecutionStatus): CapturedFileChange[] {
  const out: CapturedFileChange[] = [];
  for (const ev of status.fileReviewEventStream?.events ?? []) {
    if (ev.payload.case === "candidateCaptured") {
      out.push(...ev.payload.value.changes);
    }
  }
  return out;
}

/** Offload oversized before/after bodies of every captured file-review change. */
async function maybeOffloadCandidateChanges(
  status: AgentExecutionStatus,
  ctx: ToolOutputOffloadContext,
  maxBytes: number,
): Promise<void> {
  const changes = candidateChanges(status);
  for (const change of changes) {
    const base = `artifacts/${ctx.executionId}/filereview/${change.id}`;
    await maybeOffloadFileContent(change.before, `${base}.before.txt`, ctx, maxBytes);
    await maybeOffloadFileContent(change.after, `${base}.after.txt`, ctx, maxBytes);
  }
}

/**
 * Offload every oversized tool result in the status to artifact storage,
 * replacing the inline value with a short head + ToolCallOutputRef. Per-tool
 * failures fall back to an inline truncation (a bounded result beats a failed
 * persist) and never throw, so a storage hiccup cannot fail the execution.
 *
 * File-change before/after bodies are offloaded in the same pass, independently
 * of the result: a tool can produce a small result yet a large file diff. A
 * file-change offload failure is non-fatal — the body stays inline and the
 * aggregate backstop (enforceStatusSizeLimit) elides it if needed.
 */
export async function offloadOversizedToolOutputs(
  status: AgentExecutionStatus,
  ctx: ToolOutputOffloadContext,
): Promise<void> {
  const maxBytes = ctx.maxInlineBytes ?? INLINE_TOOL_OUTPUT_MAX_BYTES;
  const maxFileBytes = ctx.maxInlineFileBytes ?? INLINE_FILE_CONTENT_MAX_BYTES;
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

      try {
        await maybeOffloadFileChanges(tc, ctx, maxFileBytes);
      } catch {
        console.warn(
          `[status-offload] execution=${ctx.executionId} tool=${tc.name} ` +
          `file-change offload failed (non-fatal); left inline for the size backstop`,
        );
      }
    }
  }

  // File-review ledger: offload oversized captured before/after bodies the same
  // way (the proto's contract is "offloaded before the candidate event is
  // persisted"). A failure is non-fatal — the body stays inline and the
  // mark-incomplete backstop handles it without corrupting the ledger.
  try {
    await maybeOffloadCandidateChanges(status, ctx, maxFileBytes);
  } catch {
    console.warn(
      `[status-offload] execution=${ctx.executionId} ` +
      `file-review change offload failed (non-fatal); left inline for the size backstop`,
    );
  }
}

/**
 * Aggregate-budget offload of file-review candidate bodies (async, storage-backed).
 *
 * The per-item pass ({@link offloadOversizedToolOutputs}) only offloads a body
 * over {@link INLINE_FILE_CONTENT_MAX_BYTES}; many mid-sized captured files (each
 * under that per-file cap) can still sum the whole status past the soft limit.
 * Rather than let the storage-less backstop ({@link enforceStatusSizeLimit}) DROP
 * those bodies — which sets `diff_complete=false` and blocks approval, turning a
 * reviewable change discard-only — this step offloads the largest still-inline
 * captured bodies to retrievable refs (biggest-first) until the status fits. The
 * review UI then lazily fetches each ref via getArtifactContent exactly as it
 * already does for a >128 KiB file, and the change stays reviewable
 * (`diff_complete` is untouched, so the set rollup is unchanged).
 *
 * Correctness: the persisted before/after body is a DISPLAY projection —
 * reconcile sources the approved bytes from the pinned git refs / CAS manifest
 * and verifies them against the enforcement digests (`before_sha256`/
 * `after_sha256`), never this body (see {@link ../filereview/capture.js}). So
 * converting a body to a ref (or, in the backstop, dropping it) cannot change
 * what is applied on approval.
 *
 * Non-fatal per side: a storage failure leaves that body inline for the backstop
 * to drop. Returns true if any body was offloaded. Called only for a status that
 * actually carries file-review events (the caller guards on that), and a no-op
 * (single encode) when the status already fits.
 */
export async function offloadCandidateChangesToFit(
  status: AgentExecutionStatus,
  ctx: ToolOutputOffloadContext,
  softLimitBytes: number = STATUS_PAYLOAD_SOFT_LIMIT_BYTES,
): Promise<boolean> {
  if (encodedSize(status) <= softLimitBytes) return false;

  // Every still-inline captured side worth offloading, paired with its stable
  // artifact key (identical to maybeOffloadCandidateChanges so a later persist is
  // idempotent) and its byte size. ELISION_MIN_BYTES is the same "worth it"
  // threshold the drop backstop uses, so the two agree on what is large enough.
  interface InlineCandidateSide {
    readonly content: FileContent;
    readonly key: string;
    readonly bytes: number;
  }
  const sides: InlineCandidateSide[] = [];
  for (const change of candidateChanges(status)) {
    const base = `artifacts/${ctx.executionId}/filereview/${change.id}`;
    if (change.before?.body.case === "inline" && byteLen(change.before.body.value) > ELISION_MIN_BYTES) {
      sides.push({ content: change.before, key: `${base}.before.txt`, bytes: byteLen(change.before.body.value) });
    }
    if (change.after?.body.case === "inline" && byteLen(change.after.body.value) > ELISION_MIN_BYTES) {
      sides.push({ content: change.after, key: `${base}.after.txt`, bytes: byteLen(change.after.body.value) });
    }
  }

  // Largest first: shed the most bytes per upload and offload the fewest bodies.
  sides.sort((a, b) => b.bytes - a.bytes);

  let offloadedAny = false;
  for (const side of sides) {
    if (encodedSize(status) <= softLimitBytes) break;
    try {
      // Pre-filtered to inline & over the threshold, so this always offloads;
      // the shared helper keeps the ref shape + the `case === "ref"` idempotency.
      await maybeOffloadFileContent(side.content, side.key, ctx, ELISION_MIN_BYTES);
      offloadedAny = true;
    } catch {
      // Non-fatal: leave this body inline for enforceStatusSizeLimit to drop.
      console.warn(
        `[status-offload] execution=${ctx.executionId} ` +
        `aggregate file-review offload failed for ${side.key} (non-fatal); ` +
        `left inline for the size backstop`,
      );
    }
  }

  return offloadedAny;
}

function encodedSize(status: AgentExecutionStatus): number {
  return toBinary(AgentExecutionStatusSchema, status).length;
}

/** Inline byte footprint a tool call contributes via its file changes. */
function fileChangeInlineBytes(tc: ToolCall): number {
  let total = 0;
  for (const fc of tc.fileChanges) {
    total += byteLen(fc.unifiedDiff);
    if (fc.before?.body.case === "inline") total += byteLen(fc.before.body.value);
    if (fc.after?.body.case === "inline") total += byteLen(fc.after.body.value);
  }
  return total;
}

/** Elide a file change's oversized inline fields in place; returns true if any. */
function elideFileChange(fc: FileChange): boolean {
  let elided = false;
  if (byteLen(fc.unifiedDiff) > ELISION_MIN_BYTES) {
    fc.unifiedDiff = ELISION_MARKER;
    elided = true;
  }
  if (fc.before?.body.case === "inline" && byteLen(fc.before.body.value) > ELISION_MIN_BYTES) {
    fc.before.body = { case: "inline", value: ELISION_MARKER };
    elided = true;
  }
  if (fc.after?.body.case === "inline" && byteLen(fc.after.body.value) > ELISION_MIN_BYTES) {
    fc.after.body = { case: "inline", value: ELISION_MARKER };
    elided = true;
  }
  return elided;
}

/**
 * Drop a captured change's oversized inline before/after bodies (replacing them
 * with nothing), returning true if either side was large enough to drop. Used by
 * the backstop for file-review bodies, where overwriting with the elision marker
 * would corrupt the authoritative content — dropping + marking incomplete is the
 * safe alternative (bytes are re-sourced from refs/re-capture on reconcile).
 */
function dropInlineBodiesIfLarge(change: CapturedFileChange): boolean {
  let dropped = false;
  if (change.before?.body.case === "inline" && byteLen(change.before.body.value) > ELISION_MIN_BYTES) {
    change.before = undefined;
    dropped = true;
  }
  if (change.after?.body.case === "inline" && byteLen(change.after.body.value) > ELISION_MIN_BYTES) {
    change.after = undefined;
    dropped = true;
  }
  return dropped;
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
      byteLen(b.result) + byteLen(b.argsPreview) + fileChangeInlineBytes(b) -
      (byteLen(a.result) + byteLen(a.argsPreview) + fileChangeInlineBytes(a)),
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
    // File-change before/after and unified_diff can dominate the payload; elide
    // them too, preserving path/change_type/capture_level for the UI shell.
    for (const fc of tc.fileChanges) {
      if (encodedSize(status) <= softLimitBytes) return elidedAny;
      if (elideFileChange(fc)) elidedAny = true;
    }
  }

  // File-review ledger bodies — the storage-less LAST resort. When storage is
  // available, offloadCandidateChangesToFit has already turned oversized captured
  // bodies into retrievable refs (kept reviewable); a body still inline here means
  // there was no storage, or offloading everything still did not free enough.
  // Unlike a tool output, we never overwrite the captured body with the elision
  // marker — the review renders this body, so a marker would show corrupt content;
  // instead we DROP it and mark the file incomplete (SIZE_ELIDED). Reconcile
  // sources bytes from the git refs / CAS manifest (never this display body), and
  // the review surface blocks approval of an incomplete diff. This trades
  // reviewability for a bounded payload, never correctness.
  if (encodedSize(status) > softLimitBytes) {
    for (const ev of status.fileReviewEventStream?.events ?? []) {
      if (encodedSize(status) <= softLimitBytes) break;
      if (ev.payload.case !== "candidateCaptured") continue;
      const candidate = ev.payload.value;
      let markedAny = false;
      for (const change of candidate.changes) {
        if (encodedSize(status) <= softLimitBytes) break;
        if (dropInlineBodiesIfLarge(change)) {
          change.diffComplete = false;
          // Record the honest cause so the review UI distinguishes a size-elided
          // diff from a secret-withheld one (doc 15). Don't overwrite a reason a
          // more specific producer already set (e.g. SECRET_WITHHELD).
          if (change.blockedReason === FileReviewBlockReason.UNSPECIFIED) {
            change.blockedReason = FileReviewBlockReason.SIZE_ELIDED;
          }
          markedAny = true;
          elidedAny = true;
        }
      }
      if (markedAny) {
        // Re-derive the rollup from the now-elided changes via the single shared
        // rule. A dropped inline body is non-binary incomplete, so the set
        // downgrades to PARTIAL_BLOCKED (a BINARY_SUMMARY_ONLY set that loses a
        // text body is no longer binary-only); computing it here keeps the rule
        // in one place instead of hardcoding the outcome.
        candidate.diffCompleteness = deriveDiffCompleteness(candidate.changes);
      }
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
