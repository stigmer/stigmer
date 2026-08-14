/**
 * Skill-artifact ZIP extraction: byte-preserving entries with non-fatal
 * structural failure.
 *
 * Entries are returned as raw bytes, never decoded: skill artifacts carry
 * binary assets (images, fonts, archives) alongside text, and a UTF-8
 * decode/encode round-trip silently corrupts anything that isn't valid
 * UTF-8 (issue #683). No consumer parses entry content as text — SKILL.md
 * is excluded from extraction on every path and written from the Skill
 * spec instead — so there is deliberately no text accessor to misuse.
 *
 * Structural parsing lives in zip-structure.ts (central-directory-based —
 * see that module's doc for why local-header walks are never acceptable,
 * issue #450). This module owns the skill-artifact *policy* on top of it:
 *
 * Input without a readable central directory is not given a second
 * chance on purpose: every artifact reaching the runner was validated at
 * push by a central-directory-based reader on both editions (OSS:
 * `safearchive/zip` in stigmer-server's skill storage; cloud:
 * commons-compress `ZipFile` in SkillArtifactExtractor), so a missing
 * EOCD here can only mean a truncated or corrupted download — and the
 * honest result for that is the documented empty return, not a guess.
 * (The attachment injector consumes the same structural layer under the
 * opposite policy — fail-hard — because its input is untrusted.)
 *
 * Handles stored (method 0) and deflated (method 8) entries. Returns
 * parsed entries as path + content pairs — consumers bring their own
 * write mechanism (WorkspaceBackend, node:fs, etc.).
 *
 * Extracted from skill-writer.ts so both the deep-agent and Cursor
 * harnesses can share the same ZIP parsing logic without coupling to
 * a specific workspace abstraction.
 */

import { createInflateRaw } from "node:zlib";
import { EOCD_MIN_SIZE, parseZipStructure, type ZipStructuralEntry } from "./zip-structure.js";

// ─── Public API ──────────────────────────────────────────────────────────

export interface ZipFileEntry {
  /** Relative path within the archive (forward-slash separated). */
  readonly path: string;
  /** Raw file bytes, exactly as stored in the archive. */
  readonly content: Uint8Array;
}

/**
 * Parse and decompress all file entries from a ZIP archive.
 *
 * Directory entries are always skipped. An optional `exclude` list filters
 * entries whose filename (basename or full path) matches any excluded name.
 *
 * Returns an empty array for empty, truncated, or non-ZIP input rather
 * than throwing — callers treat missing artifacts as non-fatal. Errors
 * while *decompressing* a structurally valid entry (corrupt deflate
 * stream, unsupported compression method) do propagate: at that point
 * the archive's structure vouched for the entry, and silently dropping
 * it would be the exact corruption this module exists to prevent.
 */
export async function extractZipFileEntries(
  zipBytes: Uint8Array,
  options?: { exclude?: readonly string[] },
): Promise<ZipFileEntry[]> {
  if (zipBytes.length < EOCD_MIN_SIZE) return [];

  let entries: ZipStructuralEntry[];
  try {
    entries = parseZipStructure(zipBytes);
  } catch (err) {
    console.warn(
      "[zip-extract] archive has no readable central directory " +
      `(truncated or corrupt download?): ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const excludeSet = new Set(options?.exclude ?? []);
  const results: ZipFileEntry[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (isExcluded(entry.name, excludeSet)) continue;

    const content = await decompressEntry(entry);
    results.push({ path: entry.name, content });
  }

  return results;
}

function isExcluded(name: string, excludeSet: ReadonlySet<string>): boolean {
  if (excludeSet.size === 0) return false;
  if (excludeSet.has(name)) return true;

  const basename = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return excludeSet.has(basename);
}

// ─── Decompression ───────────────────────────────────────────────────────

async function decompressEntry(entry: ZipStructuralEntry): Promise<Uint8Array> {
  if (entry.compressionMethod === 0) {
    return entry.compressedData;
  }

  if (entry.compressionMethod === 8) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const inflate = createInflateRaw();
      const chunks: Buffer[] = [];
      inflate.on("data", (chunk: Buffer) => chunks.push(chunk));
      inflate.on("end", () => resolve(Buffer.concat(chunks)));
      inflate.on("error", reject);
      inflate.end(Buffer.from(entry.compressedData));
    });
  }

  throw new Error(`Unsupported ZIP compression method: ${entry.compressionMethod}`);
}
