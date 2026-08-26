/**
 * Skill artifact ZIP gate — ports pkg/domain/skill/storage/zip_extractor.go
 * arm-for-arm. Validates an uploaded artifact (size caps, ZIP-bomb
 * budgets, entry-count and filename rules, root-SKILL.md presence with the
 * #452 hint), extracts SKILL.md IN MEMORY ONLY (never to disk), and parses
 * its frontmatter. Structural parsing rides @stigmer/zip-structure
 * (central-directory-based, issues #450/#567); the safearchive-parity
 * entry pre-filter runs first (prefilter.ts, sub-project DD-001) exactly
 * as Go's reader rewrites its entry list before validation.
 *
 * Error strings are wire-visible contract (the push pipeline wraps them
 * into the InvalidArgument "failed to extract SKILL.md: ..." arm), pinned
 * from Go including the stdlib texts Go's %w wrapping surfaces
 * ("zip: not a valid zip file", "zip: unsupported compression algorithm",
 * "zip: checksum error"). Two disclosed nuances versus Go, both stricter
 * only on pathological archives: a corrupt payload SLICE on any entry
 * fails structural parsing here while Go only fails when it opens that
 * entry, and deflate-corruption error text carries zlib's message rather
 * than Go flate's.
 *
 * Proven by __tests__/zip-gate.test.ts and the skill conformance suite's
 * push-validation negatives (CONFORMANCE_TARGET=local).
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { crc32, parseZipStructure } from "@stigmer/zip-structure";
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

import {
  MAX_COMPRESSION_RATIO,
  MAX_FILES,
  MAX_SKILL_MD_SIZE,
  MAX_UNCOMPRESSED_SIZE,
  MAX_ZIP_SIZE,
  NESTED_SKILL_MD_HINT,
} from "../constants.js";
import { applyEntryPrefilter } from "./prefilter.js";
import type { PrefilteredEntry } from "./prefilter.js";
import { parseFrontmatter } from "./frontmatter.js";

/** Result of a successful gate pass (Go ExtractSkillMdResult). */
export interface ExtractSkillMdResult {
  /** Full SKILL.md content, frontmatter included. */
  readonly content: string;
  /** SHA-256 of the ZIP bytes — the content-addressed version identity. */
  readonly hash: string;
  /** Skill identifier from the frontmatter (kebab-case). */
  readonly name: string;
  /** Human-readable summary from the frontmatter. */
  readonly description: string;
}

/** ZIP compression methods the gate can open (Go registers the same two). */
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/**
 * Validates the artifact and extracts SKILL.md + frontmatter (Go
 * ExtractSkillMd). Throws plain Errors with byte-pinned messages; the
 * push pipeline owns the gRPC code.
 */
export function extractSkillMd(zipData: Uint8Array): ExtractSkillMdResult {
  if (zipData.length > MAX_ZIP_SIZE) {
    throw new Error(
      `ZIP file too large: ${zipData.length} bytes (max: ${MAX_ZIP_SIZE})`,
    );
  }

  const hash = calculateHash(zipData);

  let entries: readonly ZipStructuralEntry[];
  try {
    entries = parseZipStructure(zipData);
  } catch {
    // Go's zip.NewReader surfaces stdlib ErrFormat here; its text is what
    // clients see via the %w chain, so it is pinned verbatim.
    throw new Error("invalid ZIP file: zip: not a valid zip file");
  }

  // safearchive MaximumSecurityMode rewrites the entry list before any
  // validation sees it (DD-001) — sanitized names, shadowed/special/8.3
  // entries dropped.
  const filtered = applyEntryPrefilter(entries);

  validateZipContent(filtered);

  const content = extractSkillMdContent(filtered);

  let frontmatter;
  try {
    frontmatter = parseFrontmatter(content);
  } catch (error) {
    throw new Error(
      `invalid SKILL.md frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    content,
    hash,
    name: frontmatter.name,
    description: frontmatter.description,
  };
}

/**
 * Security validation over the (pre-filtered) entry list — Go
 * validateZipContent, checks in its exact order: empty archive, file-count
 * cap, then per entry SKILL.md placement tracking, filename
 * control-character rejection, the running declared-uncompressed budget
 * (fail-fast), and the per-file compression-ratio cap; finally the
 * root-SKILL.md presence rule with the #452 nested-only hint.
 */
function validateZipContent(entries: readonly PrefilteredEntry[]): void {
  if (entries.length === 0) {
    throw new Error("ZIP file is empty");
  }

  if (entries.length > MAX_FILES) {
    throw new Error(`too many files in ZIP: ${entries.length} (max: ${MAX_FILES})`);
  }

  let totalUncompressedSize = 0;
  let hasSkillMd = false;
  let hasNestedSkillMd = false;

  for (const { name, entry } of entries) {
    // SKILL.md must be at the archive root. Nested occurrences are tracked
    // only to make the rejection actionable (below).
    if (name === "SKILL.md") {
      hasSkillMd = true;
    } else if (name.endsWith("/SKILL.md")) {
      hasNestedSkillMd = true;
    }

    // Reject null bytes and control characters in entry names (code
    // points, not UTF-16 units — Go ranges over runes).
    for (const ch of name) {
      const codePoint = ch.codePointAt(0)!;
      if (codePoint < 32 || codePoint === 127) {
        throw new Error(`invalid character in filename: ${name}`);
      }
    }

    // Track the declared uncompressed total (fail fast once exceeded).
    totalUncompressedSize += entry.uncompressedSize;
    if (totalUncompressedSize > MAX_UNCOMPRESSED_SIZE) {
      throw new Error(
        `total uncompressed size too large: ${totalUncompressedSize} bytes (max: ${MAX_UNCOMPRESSED_SIZE})`,
      );
    }

    // Per-file compression ratio (ZIP-bomb guard); integer division as Go.
    if (entry.compressedSize > 0) {
      const ratio = Math.floor(entry.uncompressedSize / entry.compressedSize);
      if (ratio > MAX_COMPRESSION_RATIO) {
        throw new Error(
          `suspicious compression ratio in ${name}: ${ratio}:1 (max: ${MAX_COMPRESSION_RATIO}:1)`,
        );
      }
    }
  }

  if (!hasSkillMd) {
    if (hasNestedSkillMd) {
      throw new Error(NESTED_SKILL_MD_HINT);
    }
    throw new Error("SKILL.md not found in ZIP archive");
  }
}

/**
 * Extracts SKILL.md's content in memory (Go extractSkillMdContent): the
 * first root-named entry, decompressed under the 1MB cap, CRC-verified
 * (Go's reader checks the checksum on every read), UTF-8 decoded.
 */
function extractSkillMdContent(entries: readonly PrefilteredEntry[]): string {
  for (const { name, entry } of entries) {
    if (name !== "SKILL.md") {
      continue;
    }

    let contentBytes: Uint8Array;
    switch (entry.compressionMethod) {
      case METHOD_STORED:
        contentBytes = entry.compressedData;
        break;
      case METHOD_DEFLATED:
        try {
          // The cap bounds the ACTUAL inflated output — declared sizes are
          // client claims (the ratio check upstream only sees declarations).
          contentBytes = new Uint8Array(
            inflateRawSync(entry.compressedData, {
              maxOutputLength: MAX_SKILL_MD_SIZE + 1,
            }),
          );
        } catch (error) {
          if (isOutputLengthError(error)) {
            throw new Error(`SKILL.md too large (max: ${MAX_SKILL_MD_SIZE} bytes)`);
          }
          throw new Error(
            `failed to read SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        break;
      default:
        // Go: File.Open returns ErrAlgorithm for methods without a
        // registered decompressor; the text is pinned via the %w chain.
        throw new Error("failed to open SKILL.md: zip: unsupported compression algorithm");
    }

    if (contentBytes.length > MAX_SKILL_MD_SIZE) {
      throw new Error(`SKILL.md too large (max: ${MAX_SKILL_MD_SIZE} bytes)`);
    }

    if (crc32(contentBytes) !== entry.crc32) {
      // Go's checksumReader: stdlib ErrChecksum via the read-error arm.
      throw new Error("failed to read SKILL.md: zip: checksum error");
    }

    if (contentBytes.length === 0) {
      throw new Error("SKILL.md is empty");
    }

    return new TextDecoder().decode(contentBytes);
  }

  throw new Error("SKILL.md not found in ZIP archive");
}

/** node:zlib's maxOutputLength violation (the output-cap arm). */
function isOutputLengthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error && (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") ||
      error.message.includes("maxOutputLength"))
  );
}

/** SHA-256 hex of the artifact bytes (Go CalculateHash). */
export function calculateHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
