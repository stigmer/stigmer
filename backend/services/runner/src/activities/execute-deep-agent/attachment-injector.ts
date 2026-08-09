/**
 * Attachment injection for deep agent execution.
 *
 * Downloads attachments from artifact storage (cloud) or local filesystem,
 * validates ZIP archives with security guards, and writes files into the
 * workspace via the platform mount namespace (.stigmer/inputs/).
 *
 * Security model: attachments are untrusted user uploads. All ZIP content
 * is validated for path traversal, zip bombs, and format integrity before
 * any extraction occurs.
 *
 * Error model: fail-hard. Any attachment failure aborts the entire injection
 * and propagates a descriptive error. Attachments are explicit user inputs —
 * running with partial inputs produces silently incorrect results.
 */

import { readFile } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { basename, posix } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import type {
  VisionBudget,
  VisionDegradedReason,
  VisionImage,
} from "../../shared/attachment-vision.js";

// ── Constants ────────────────────────────────────────────────────────

const MAX_ZIP_FILES = 1000;
const MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_INPUTS_PREFIX = ".stigmer/inputs";
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export { MAX_ZIP_FILES, MAX_ZIP_EXTRACTED_SIZE };

// ── Types ────────────────────────────────────────────────────────────

export interface InjectedFile {
  readonly filename: string;
  readonly path: string;
  readonly sizeBytes: number;
  /** Present when the attachment was accepted into the turn's vision payload. */
  readonly vision?: VisionImage;
  /**
   * Present when the attachment was plausibly an image but could not ride
   * inline (see {@link VisionDegradedReason}) — disclosed in the system prompt
   * so the agent never silently ignores a photo the user believes it can see.
   * Attachments that were never image-shaped carry neither field.
   */
  readonly visionDegraded?: VisionDegradedReason;
}

export interface InjectAttachmentsOptions {
  readonly backend: WorkspaceBackend;
  readonly attachments: readonly Attachment[];
  /**
   * Artifact storage for cloud-mode attachment download. `undefined` when the
   * runner could not build a store (proxy misconfig). With no attachments this is
   * never touched (the function early-returns); a cloud-mode attachment that
   * genuinely needs storage surfaces a clear {@link AttachmentInjectionError}
   * rather than dereferencing undefined.
   */
  readonly storage: ArtifactStorage | undefined;
  readonly isLocalMode: boolean;
  /**
   * The turn's vision selector (attachment-vision.ts owns all policy).
   * `undefined` disables inline image delivery; file materialization is
   * identical either way — vision is strictly additive. Archives (`extract`)
   * are never offered: an image inside a ZIP has no attachment-level bytes.
   */
  readonly visionBudget?: VisionBudget;
}

export interface ZipEntryInfo {
  readonly relativePath: string;
  readonly uncompressedSize: number;
}

// ── Errors ───────────────────────────────────────────────────────────

export class AttachmentInjectionError extends Error {
  readonly attachmentFilename: string;
  readonly reason: string;

  constructor(attachmentFilename: string, reason: string) {
    super(`Attachment '${attachmentFilename}': ${reason}`);
    this.name = "AttachmentInjectionError";
    this.attachmentFilename = attachmentFilename;
    this.reason = reason;
  }
}

export class AttachmentValidationError extends Error {
  readonly attachmentFilename: string;
  readonly reason: string;

  constructor(attachmentFilename: string, reason: string) {
    super(`Attachment '${attachmentFilename}': ${reason}`);
    this.name = "AttachmentValidationError";
    this.attachmentFilename = attachmentFilename;
    this.reason = reason;
  }
}

// ── ZIP Validation (pure function) ───────────────────────────────────

/**
 * Validate a ZIP archive for safe extraction. Returns the manifest of
 * file entries (directories excluded) if the archive passes all checks.
 *
 * Security checks enforced:
 * 1. Valid ZIP format (local file header signature present)
 * 2. No absolute paths (entries starting with / or \)
 * 3. No path traversal (.. components)
 * 4. No null bytes in filenames
 * 5. Non-empty archive (at least one file entry)
 * 6. File count within limits (max 1000)
 * 7. Total uncompressed size within limits (max 100 MB)
 */
export function validateZipForExtraction(
  zipData: Buffer,
  sourceFilename: string,
): ZipEntryInfo[] {
  if (zipData.length < 4) {
    throw new AttachmentValidationError(
      sourceFilename,
      "not a valid ZIP archive (file too small)",
    );
  }

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const firstSignature = view.getUint32(0, true);

  if (firstSignature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new AttachmentValidationError(
      sourceFilename,
      "not a valid ZIP archive (invalid header signature)",
    );
  }

  const entries: ZipEntryInfo[] = [];
  let totalUncompressed = 0;
  let offset = 0;

  while (offset < zipData.length - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) break;

    if (offset + 30 > zipData.length) {
      throw new AttachmentValidationError(
        sourceFilename,
        "not a valid ZIP archive (truncated local file header)",
      );
    }

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > zipData.length) {
      throw new AttachmentValidationError(
        sourceFilename,
        "not a valid ZIP archive (truncated filename)",
      );
    }

    const fileNameBytes = zipData.subarray(fileNameStart, fileNameEnd);

    for (let i = 0; i < fileNameBytes.length; i++) {
      if (fileNameBytes[i] === 0x00) {
        throw new AttachmentValidationError(
          sourceFilename,
          "contains a filename with null bytes and cannot be safely extracted",
        );
      }
    }

    const fileName = new TextDecoder().decode(fileNameBytes);

    const isDirectory = fileName.endsWith("/");

    if (!isDirectory) {
      if (fileName.startsWith("/") || fileName.startsWith("\\")) {
        throw new AttachmentValidationError(
          sourceFilename,
          `contains an absolute path entry and cannot be safely extracted: ${fileName}`,
        );
      }

      if (hasPathTraversal(fileName)) {
        throw new AttachmentValidationError(
          sourceFilename,
          `contains a path traversal entry and cannot be safely extracted: ${fileName}`,
        );
      }

      entries.push({ relativePath: fileName, uncompressedSize });
      totalUncompressed += uncompressedSize;
    }

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;

    // Handle data descriptor (bit 3 of general purpose flag)
    const generalFlags = view.getUint16(offset + 6, true);
    let dataSize = compressedSize;

    if ((generalFlags & 0x08) !== 0 && compressedSize === 0) {
      // Data descriptor follows compressed data — scan for next header
      // This is a simplified approach; for untrusted inputs we require
      // sizes in the local header. Reject archives that use streaming.
      if (!isDirectory && compressionMethod !== 0) {
        throw new AttachmentValidationError(
          sourceFilename,
          "uses streaming (data descriptors without sizes) which is not supported for security validation",
        );
      }
    }

    offset = dataStart + dataSize;
  }

  if (entries.length === 0) {
    throw new AttachmentValidationError(
      sourceFilename,
      "is an empty ZIP archive (no file entries)",
    );
  }

  if (entries.length > MAX_ZIP_FILES) {
    throw new AttachmentValidationError(
      sourceFilename,
      `contains ${entries.length} files (limit: ${MAX_ZIP_FILES})`,
    );
  }

  if (totalUncompressed > MAX_ZIP_EXTRACTED_SIZE) {
    const sizeMb = (totalUncompressed / (1024 * 1024)).toFixed(1);
    const limitMb = (MAX_ZIP_EXTRACTED_SIZE / (1024 * 1024)).toFixed(0);
    throw new AttachmentValidationError(
      sourceFilename,
      `would extract to ${sizeMb} MB (limit: ${limitMb} MB)`,
    );
  }

  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

// ── Attachment Injection ─────────────────────────────────────────────

/**
 * Download, validate, and inject all attachments into the workspace.
 *
 * Performs mount path collision detection before any downloads begin.
 * On any failure, throws AttachmentInjectionError with an actionable message.
 */
export async function injectAttachments(opts: InjectAttachmentsOptions): Promise<InjectedFile[]> {
  const { backend, attachments, storage, isLocalMode, visionBudget } = opts;

  if (attachments.length === 0) return [];

  // Phase 1: Pre-compute mount paths and detect collisions
  const mountPaths = resolveMountPaths(attachments);

  // Phase 2: Download, validate, and write each attachment
  const injectedFiles: InjectedFile[] = [];

  for (const attachment of attachments) {
    const content = await downloadAttachment(attachment, storage, isLocalMode);
    const mountPath = mountPaths.get(attachment)!;

    if (attachment.extract) {
      const entries = validateZipForExtraction(content, attachment.filename);
      const extracted = await extractZipToWorkspace(
        content, entries, mountPath, backend,
      );
      injectedFiles.push(...extracted);
    } else {
      await backend.writeFileBuffer(mountPath, content);
      const filename = attachment.filename || basename(mountPath);
      // The bytes are already in hand for the workspace write — offer them to
      // the vision budget before they go out of scope (the sniff decides
      // eligibility; the budget owns every size/count rule).
      const vision = visionBudget?.offer(filename, attachment.contentType, content);
      injectedFiles.push({
        filename,
        path: mountPath,
        sizeBytes: content.length,
        ...(vision?.kind === "accepted" ? { vision: vision.image } : {}),
        ...(vision?.kind === "degraded" ? { visionDegraded: vision.reason } : {}),
      });
    }
  }

  console.log(
    `[attachment-injector] Injected ${injectedFiles.length} file(s) into workspace`,
  );

  return injectedFiles;
}

// ── Internal Helpers ─────────────────────────────────────────────────

function resolveMountPaths(
  attachments: readonly Attachment[],
): Map<Attachment, string> {
  const result = new Map<Attachment, string>();
  const pathToAttachment = new Map<string, Attachment>();

  for (const attachment of attachments) {
    const mountPath = resolveMountPath(attachment);
    const existing = pathToAttachment.get(mountPath);

    if (existing) {
      throw new AttachmentInjectionError(
        attachment.filename,
        `mount path '${mountPath}' collides with attachment '${existing.filename}'. ` +
        "Set distinct mountPath values on the attachments to resolve this conflict.",
      );
    }

    pathToAttachment.set(mountPath, attachment);
    result.set(attachment, mountPath);
  }

  return result;
}

function resolveMountPath(attachment: Attachment): string {
  if (attachment.mountPath) {
    const cleaned = attachment.mountPath.replace(/^\/+/, "");
    if (cleaned.length === 0) {
      throw new AttachmentInjectionError(
        attachment.filename,
        "mountPath resolves to an empty path after removing leading slashes",
      );
    }
    // A caller-supplied mount path is untrusted. Stripping leading slashes does
    // not stop `..` segments from climbing out of the workspace root on the
    // non-`.stigmer/` branch (the `.stigmer/`-routed branch is already guarded
    // by LocalWorkspaceBackend.resolvePath). Reject any path that normalizes to
    // an escape before it reaches the backend write.
    if (escapesRoot(cleaned)) {
      throw new AttachmentInjectionError(
        attachment.filename,
        `mount path '${attachment.mountPath}' escapes the workspace root`,
      );
    }
    return cleaned;
  }

  const rawName = attachment.filename || deriveFilename(attachment.storageKey);
  if (!rawName) {
    throw new AttachmentInjectionError(
      "(unknown)",
      "attachment has neither filename nor storageKey — cannot determine mount path",
    );
  }

  // The filename is untrusted; reduce it to a single path component so it lands
  // directly under the inputs prefix rather than steering the write elsewhere.
  const filename = posix.basename(rawName);
  if (filename === "" || filename === "." || filename === "..") {
    throw new AttachmentInjectionError(
      rawName,
      `filename '${rawName}' does not yield a usable name for materialization`,
    );
  }

  return `${DEFAULT_INPUTS_PREFIX}/${filename}`;
}

// escapesRoot reports whether a workspace-relative mount path would climb out
// of the workspace root once normalized. Mount paths are forward-slash,
// workspace-relative strings, so posix normalization is the correct semantics.
function escapesRoot(relPath: string): boolean {
  const normalized = posix.normalize(relPath);
  return (
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
  );
}

function deriveFilename(storageKey: string): string {
  if (!storageKey) return "";
  const parts = storageKey.split("/");
  return parts[parts.length - 1] || "";
}

async function downloadAttachment(
  attachment: Attachment,
  storage: ArtifactStorage | undefined,
  isLocalMode: boolean,
): Promise<Buffer> {
  // Local mode fast path: read directly from filesystem
  if (isLocalMode && attachment.localPath) {
    try {
      return await readFile(attachment.localPath);
    } catch (err) {
      throw new AttachmentInjectionError(
        attachment.filename,
        `failed to read local file '${attachment.localPath}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Cloud mode: download via artifact storage
  if (!attachment.storageKey) {
    throw new AttachmentInjectionError(
      attachment.filename,
      "missing storageKey — cannot download attachment from storage",
    );
  }

  // The attachment must come from storage, but the runner could not build one
  // (proxy misconfig). Fail with an actionable message rather than dereferencing
  // undefined — consistent with the degraded posture, never a silent skip.
  if (!storage) {
    throw new AttachmentInjectionError(
      attachment.filename,
      `artifact storage is unavailable, so this attachment (key: ${attachment.storageKey}) cannot be downloaded`,
    );
  }

  try {
    return await storage.download(attachment.storageKey);
  } catch (err) {
    if (err instanceof AttachmentInjectionError) throw err;
    throw new AttachmentInjectionError(
      attachment.filename,
      `failed to download from storage (key: ${attachment.storageKey}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function extractZipToWorkspace(
  zipData: Buffer,
  entries: readonly ZipEntryInfo[],
  mountDir: string,
  backend: WorkspaceBackend,
): Promise<InjectedFile[]> {
  const cleanMountDir = mountDir.replace(/\/+$/, "");
  const injected: InjectedFile[] = [];
  const parsedEntries = parseZipFileData(zipData);

  for (const entry of entries) {
    const fileData = parsedEntries.get(entry.relativePath);
    if (!fileData) continue;

    const content = await decompressEntry(fileData);
    const targetPath = `${cleanMountDir}/${entry.relativePath}`;

    await backend.writeFileBuffer(targetPath, content);
    injected.push({
      filename: posix.basename(entry.relativePath),
      path: targetPath,
      sizeBytes: content.length,
    });
  }

  return injected;
}

interface RawZipEntry {
  compressedData: Buffer;
  compressionMethod: number;
}

function parseZipFileData(zipData: Buffer): Map<string, RawZipEntry> {
  const result = new Map<string, RawZipEntry>();
  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  let offset = 0;

  while (offset < zipData.length - 4) {
    const signature = view.getUint32(offset, true);
    if (signature !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) break;

    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraFieldLength = view.getUint16(offset + 28, true);

    const fileNameStart = offset + 30;
    const fileName = new TextDecoder().decode(
      zipData.subarray(fileNameStart, fileNameStart + fileNameLength),
    );

    const dataStart = fileNameStart + fileNameLength + extraFieldLength;
    const compressedData = zipData.subarray(dataStart, dataStart + compressedSize);

    if (!fileName.endsWith("/")) {
      result.set(fileName, {
        compressedData: Buffer.from(compressedData),
        compressionMethod,
      });
    }

    offset = dataStart + compressedSize;
  }

  return result;
}

async function decompressEntry(entry: RawZipEntry): Promise<Buffer> {
  if (entry.compressionMethod === 0) {
    return entry.compressedData;
  }

  if (entry.compressionMethod === 8) {
    return new Promise<Buffer>((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];
      inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);
      inflate.end(entry.compressedData);
    });
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}

function hasPathTraversal(filePath: string): boolean {
  const normalized = posix.normalize(filePath);
  if (normalized.startsWith("../") || normalized === "..") return true;

  const segments = filePath.split(/[/\\]/);
  for (const seg of segments) {
    if (seg === "..") return true;
  }

  return false;
}
