/**
 * Attachment injection for deep agent execution.
 *
 * Downloads attachments from artifact storage (cloud) or local filesystem,
 * validates ZIP archives with security guards, and writes files into the
 * workspace via the platform mount namespace (.stigmer/inputs/).
 *
 * Security model: attachments are untrusted user uploads. ZIP archives are
 * parsed from the central directory — the format's authoritative index —
 * via the shared structural layer (@stigmer/zip-structure; issue #567,
 * which killed this module's local-header walk: it silently truncated
 * stored streaming entries and rejected Go-default archives outright).
 * Every entry is validated for path traversal, zip bombs, and format
 * integrity BEFORE any extraction occurs, and because the central
 * directory's sizes are declarations an attacker controls, decompression
 * re-enforces them: an entry whose actual output disagrees with its
 * declared size aborts the injection.
 *
 * Error model: fail-hard. Any attachment failure aborts the entire injection
 * and propagates a descriptive error. Attachments are explicit user inputs —
 * running with partial inputs produces silently incorrect results. This is
 * deliberately the OPPOSITE policy from the skill-artifact reader
 * (shared/zip-extract.ts, non-fatal empty return): skill artifacts were
 * structurally vouched for by the push gates, attachments never are.
 *
 * Duplicate names are NOT a failure (issue #364): a default-derived mount
 * path that collides is renamed with the platform's `stem-2.ext` semantics
 * (shared/attachment-naming.ts) and the rename is disclosed in the prompt's
 * Input Files section. Only two attachments EXPLICITLY pinning the same
 * `mountPath` still abort — that is a user contradiction no rename can
 * honestly resolve.
 */

import { readFile } from "node:fs/promises";
import { createInflateRaw } from "node:zlib";
import { posix } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { mintAttachmentDownloadUrl } from "../../shared/attachment-download-urls.js";
import { allocateUniqueName } from "../../shared/attachment-naming.js";
import type {
  VisionBudget,
  VisionDegradedReason,
  VisionImage,
} from "../../shared/attachment-vision.js";
import {
  EOCD_MIN_SIZE,
  parseZipStructure,
  type ZipStructuralEntry,
} from "@stigmer/zip-structure";

// ── Constants ────────────────────────────────────────────────────────

const MAX_ZIP_FILES = 1000;
const MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024; // 100 MB
const DEFAULT_INPUTS_PREFIX = ".stigmer/inputs";

export { MAX_ZIP_FILES, MAX_ZIP_EXTRACTED_SIZE };

// ── Types ────────────────────────────────────────────────────────────

export interface InjectedFile {
  /** The final on-disk basename — after any duplicate rename, so it always
   * agrees with {@link path} and with the vision payload's image label. */
  readonly filename: string;
  readonly path: string;
  readonly sizeBytes: number;
  /**
   * The attachment's original filename, present only when a duplicate name
   * was renamed (shared/attachment-naming.ts) — rendered as disclosure in
   * the prompt's Input Files section.
   */
  readonly renamedFrom?: string;
  /** Present when the attachment was accepted into the turn's vision payload. */
  readonly vision?: VisionImage;
  /**
   * Present when the attachment was plausibly an image but could not ride
   * inline (see {@link VisionDegradedReason}) — disclosed in the system prompt
   * so the agent never silently ignores a photo the user believes it can see.
   * Attachments that were never image-shaped carry neither field.
   */
  readonly visionDegraded?: VisionDegradedReason;
  /**
   * A download URL for the attachment's stored object, listed in the system
   * prompt's Input Files section so the agent can hand the file to a tool
   * whose backend cannot read the sandbox filesystem (issue #532). Minted
   * whenever the attachment has a `storageKey` and a usable storage; never
   * present on extracted ZIP entries (no attachment-level object). Absent
   * when there is nothing to mint or the mint failed (non-fatal — policy,
   * degrade log, and prompt wording live in
   * shared/attachment-download-urls.ts).
   */
  readonly downloadUrl?: string;
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

// ── ZIP Validation (pure functions) ──────────────────────────────────

/**
 * Validate a ZIP archive for safe extraction. Returns the manifest of
 * file entries (directories excluded) if the archive passes all checks.
 *
 * Security checks enforced:
 * 1. Valid ZIP format (readable central directory; fail-hard, see module doc)
 * 2. No absolute paths (entries starting with / or \)
 * 3. No path traversal (.. components)
 * 4. No null bytes in filenames
 * 5. No duplicate entry paths (a contradictory manifest)
 * 6. Only supported compression methods (stored, deflate) — checked here
 *    so an unsupported entry can never abort extraction after earlier
 *    entries were already written
 * 7. Non-empty archive (at least one file entry)
 * 8. File count within limits (max 1000)
 * 9. Total declared uncompressed size within limits (max 100 MB) —
 *    declarations are re-enforced against actual output at decompression
 */
export function validateZipForExtraction(
  zipData: Buffer,
  sourceFilename: string,
): ZipEntryInfo[] {
  return parseAndValidateZip(zipData, sourceFilename).map(
    ({ relativePath, uncompressedSize }) => ({ relativePath, uncompressedSize }),
  );
}

/**
 * A validated file entry, still carrying its payload slice. Validation and
 * extraction share these records — parsing happens exactly once, so "the
 * manifest promised a file extraction cannot find" is unrepresentable
 * (the old two-walker design silently skipped such entries).
 */
interface ValidatedZipEntry extends ZipEntryInfo {
  readonly compressionMethod: number;
  readonly compressedData: Uint8Array;
}

function parseAndValidateZip(
  zipData: Buffer,
  sourceFilename: string,
): ValidatedZipEntry[] {
  if (zipData.length < EOCD_MIN_SIZE) {
    throw new AttachmentValidationError(
      sourceFilename,
      "not a valid ZIP archive (file too small)",
    );
  }

  let structural: ZipStructuralEntry[];
  try {
    structural = parseZipStructure(zipData);
  } catch (err) {
    throw new AttachmentValidationError(
      sourceFilename,
      `not a valid ZIP archive (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const entries: ValidatedZipEntry[] = [];
  const seenPaths = new Set<string>();
  let totalUncompressed = 0;

  for (const entry of structural) {
    if (entry.name.includes("\u0000")) {
      throw new AttachmentValidationError(
        sourceFilename,
        "contains a filename with null bytes and cannot be safely extracted",
      );
    }

    if (entry.isDirectory) continue;

    if (entry.name.startsWith("/") || entry.name.startsWith("\\")) {
      throw new AttachmentValidationError(
        sourceFilename,
        `contains an absolute path entry and cannot be safely extracted: ${entry.name}`,
      );
    }

    if (hasPathTraversal(entry.name)) {
      throw new AttachmentValidationError(
        sourceFilename,
        `contains a path traversal entry and cannot be safely extracted: ${entry.name}`,
      );
    }

    if (seenPaths.has(entry.name)) {
      throw new AttachmentValidationError(
        sourceFilename,
        `contains duplicate entry '${entry.name}' and cannot be safely extracted`,
      );
    }
    seenPaths.add(entry.name);

    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new AttachmentValidationError(
        sourceFilename,
        `entry '${entry.name}' uses unsupported compression method ${entry.compressionMethod}`,
      );
    }

    entries.push({
      relativePath: entry.name,
      uncompressedSize: entry.uncompressedSize,
      compressionMethod: entry.compressionMethod,
      compressedData: entry.compressedData,
    });
    totalUncompressed += entry.uncompressedSize;
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
 * Resolves all mount paths before any downloads begin: duplicate
 * default-derived names are renamed (never fatal — see module doc), and an
 * explicit-mountPath contradiction throws before any bytes move.
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
    const { path: mountPath, renamedFrom } = mountPaths.get(attachment)!;

    if (attachment.extract) {
      const entries = parseAndValidateZip(content, attachment.filename);
      const extracted = await extractZipToWorkspace(
        entries, mountPath, backend, attachment.filename,
      );
      // A renamed mount DIR is visible through every extracted path; the
      // entries themselves were not renamed, so they carry no renamedFrom
      // (per-file disclosure would misattribute the rename). Extracted
      // entries also carry no downloadUrl: the stored object is the ZIP, not
      // any listed file, and a URL to bytes that differ from the listing
      // would be a false promise.
      injectedFiles.push(...extracted);
    } else {
      await backend.writeFileBuffer(mountPath, content);
      // The final basename is the canonical filename: after a duplicate
      // rename the original attachment.filename no longer names the file on
      // disk, and the vision label must match what the prompt lists or the
      // agent sees two images with one indistinguishable name.
      const filename = posix.basename(mountPath);
      // The bytes are already in hand for the workspace write — offer them to
      // the vision budget before they go out of scope (the sniff decides
      // eligibility; the budget owns every size/count rule).
      const vision = visionBudget?.offer(filename, attachment.contentType, content);
      const downloadUrl = await mintAttachmentDownloadUrl(
        storage, attachment.storageKey, filename,
      );
      injectedFiles.push({
        filename,
        path: mountPath,
        sizeBytes: content.length,
        ...(renamedFrom !== undefined ? { renamedFrom } : {}),
        ...(vision?.kind === "accepted" ? { vision: vision.image } : {}),
        ...(vision?.kind === "degraded" ? { visionDegraded: vision.reason } : {}),
        ...(downloadUrl !== undefined ? { downloadUrl } : {}),
      });
    }
  }

  console.log(
    `[attachment-injector] Injected ${injectedFiles.length} file(s) into workspace`,
  );

  return injectedFiles;
}

// ── Internal Helpers ─────────────────────────────────────────────────

interface ResolvedMountPath {
  readonly path: string;
  /** Present when a default-derived name was uniquified (issue #364). */
  readonly renamedFrom?: string;
}

function resolveMountPaths(
  attachments: readonly Attachment[],
): Map<Attachment, ResolvedMountPath> {
  const result = new Map<Attachment, ResolvedMountPath>();
  const pathToAttachment = new Map<string, Attachment>();

  // Pass 1: explicit mount paths claim their exact targets first. Two
  // attachments explicitly pinning the SAME path is a user contradiction no
  // rename can honestly resolve — keep rejecting with the actionable message.
  for (const attachment of attachments) {
    if (!attachment.mountPath) continue;
    const mountPath = resolveExplicitMountPath(attachment);
    const existing = pathToAttachment.get(mountPath);

    if (existing) {
      throw new AttachmentInjectionError(
        attachment.filename,
        `mount path '${mountPath}' collides with attachment '${existing.filename}'. ` +
        "Set distinct mountPath values on the attachments to resolve this conflict.",
      );
    }

    pathToAttachment.set(mountPath, attachment);
    result.set(attachment, { path: mountPath });
  }

  // Pass 2: default-derived names (`.stigmer/inputs/{filename}`) uniquify
  // around everything already taken — other defaults AND explicit paths that
  // landed inside the inputs prefix — instead of failing the execution
  // (issue #364). The taken-set is seeded with the basenames the explicit
  // pass claimed directly under the prefix.
  const takenNames = new Set<string>();
  for (const path of pathToAttachment.keys()) {
    if (path.startsWith(`${DEFAULT_INPUTS_PREFIX}/`)) {
      const rest = path.slice(DEFAULT_INPUTS_PREFIX.length + 1);
      if (rest.length > 0 && !rest.includes("/")) takenNames.add(rest);
    }
  }
  for (const attachment of attachments) {
    if (attachment.mountPath) continue;
    const { name, renamedFrom } = allocateUniqueName(
      deriveDefaultFilename(attachment),
      takenNames,
    );
    const path = `${DEFAULT_INPUTS_PREFIX}/${name}`;
    pathToAttachment.set(path, attachment);
    result.set(
      attachment,
      renamedFrom !== undefined ? { path, renamedFrom } : { path },
    );
  }

  return result;
}

function resolveExplicitMountPath(attachment: Attachment): string {
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

// Derives the single-component filename an attachment without an explicit
// mountPath materializes under (the name that pass 2 uniquifies).
function deriveDefaultFilename(attachment: Attachment): string {
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

  return filename;
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
  entries: readonly ValidatedZipEntry[],
  mountDir: string,
  backend: WorkspaceBackend,
  sourceFilename: string,
): Promise<InjectedFile[]> {
  const cleanMountDir = mountDir.replace(/\/+$/, "");
  const injected: InjectedFile[] = [];

  for (const entry of entries) {
    const content = await decompressEntry(entry, sourceFilename);
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

/**
 * Decompress a validated entry, enforcing its declared uncompressed size.
 *
 * The size cap in parseAndValidateZip budgets *declared* sizes, which the
 * archive author controls — a crafted archive can declare 1 KB and inflate
 * to gigabytes. Enforcement is therefore two-sided and fail-hard: inflation
 * aborts the moment output exceeds the declaration, and an undershoot (or a
 * stored payload whose length disagrees) fails too, because a manifest that
 * misdescribes its own contents is exactly the corrupt-input class this
 * module must never extract from.
 */
async function decompressEntry(
  entry: ValidatedZipEntry,
  sourceFilename: string,
): Promise<Buffer> {
  const declared = entry.uncompressedSize;

  if (entry.compressionMethod === 0) {
    if (entry.compressedData.length !== declared) {
      throw new AttachmentValidationError(
        sourceFilename,
        `entry '${entry.relativePath}' payload is ${entry.compressedData.length} bytes ` +
        `but the archive declares ${declared} — corrupt or crafted archive`,
      );
    }
    return Buffer.from(entry.compressedData);
  }

  // Deflate — the only other method parseAndValidateZip admits.
  return new Promise<Buffer>((resolve, reject) => {
    const inflate = createInflateRaw();
    const chunks: Buffer[] = [];
    let produced = 0;
    inflate.on("data", (chunk: Buffer) => {
      produced += chunk.length;
      if (produced > declared) {
        inflate.destroy();
        reject(new AttachmentValidationError(
          sourceFilename,
          `entry '${entry.relativePath}' decompresses past its declared size of ` +
          `${declared} bytes — corrupt or crafted archive`,
        ));
        return;
      }
      chunks.push(chunk);
    });
    inflate.on("end", () => {
      if (produced !== declared) {
        reject(new AttachmentValidationError(
          sourceFilename,
          `entry '${entry.relativePath}' decompressed to ${produced} bytes ` +
          `but the archive declares ${declared} — corrupt or crafted archive`,
        ));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    inflate.on("error", reject);
    inflate.end(Buffer.from(entry.compressedData));
  });
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
