/**
 * ZIP validation and decompression for attachment archives — the byte-level
 * half of an `extract` attachment, shared by every writer of one.
 *
 * Security model: attachments are untrusted user uploads. Archives are parsed
 * from the central directory — the format's authoritative index — via the
 * shared structural layer (@stigmer/zip-structure; issue #567, which killed
 * the earlier local-header walk: it silently truncated stored streaming
 * entries and rejected Go-default archives outright). Every entry is
 * validated for path traversal, zip bombs, and format integrity BEFORE any
 * extraction occurs, and because the central directory's sizes are
 * declarations an attacker controls, decompression re-enforces them: an
 * entry whose actual output disagrees with its declared size aborts the
 * extraction.
 *
 * Error model: fail-hard through {@link AttachmentValidationError}. An
 * archive that fails any check aborts the whole attachment resolution and
 * propagates a descriptive, user-fixable message. This is deliberately the
 * OPPOSITE policy from the skill-artifact reader (`zip-extract.ts`,
 * non-fatal empty return): skill artifacts were structurally vouched for by
 * the push gates, attachments never are.
 *
 * Validation and decompression share one record ({@link ValidatedZipEntry},
 * still carrying its payload slice), so parsing happens exactly once and
 * "the manifest promised a file extraction cannot find" is unrepresentable.
 * The WRITE of an extracted entry is the caller's: the attachment resolver
 * writes under the session's platform dir (`attachment-resolver.ts`), and
 * until S3 M2b retires it, the native injector writes through its workspace
 * backend. Moved here from `execute-deep-agent/attachment-injector.ts` at
 * S3 M1 (Q-S3-14) so the guards have one home.
 */

import { createInflateRaw } from "node:zlib";
import { posix } from "node:path";
import {
  EOCD_MIN_SIZE,
  parseZipStructure,
  type ZipStructuralEntry,
} from "@stigmer/zip-structure";

// ── Constants ────────────────────────────────────────────────────────

export const MAX_ZIP_FILES = 1000;
export const MAX_ZIP_EXTRACTED_SIZE = 100 * 1024 * 1024; // 100 MB

// ── Types ────────────────────────────────────────────────────────────

export interface ZipEntryInfo {
  readonly relativePath: string;
  readonly uncompressedSize: number;
}

/**
 * A validated file entry, still carrying its payload slice. Validation and
 * extraction share these records — parsing happens exactly once, so "the
 * manifest promised a file extraction cannot find" is unrepresentable
 * (the old two-walker design silently skipped such entries).
 */
export interface ValidatedZipEntry extends ZipEntryInfo {
  readonly compressionMethod: number;
  readonly compressedData: Uint8Array;
}

// ── Errors ───────────────────────────────────────────────────────────

/** An archive the user handed us cannot be safely extracted; the reason is theirs to fix. */
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

/** The same checks as {@link validateZipForExtraction}, keeping each entry's payload for the extraction that follows. */
export function parseAndValidateZip(
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

// ── Decompression ────────────────────────────────────────────────────

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
export async function decompressEntry(
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
