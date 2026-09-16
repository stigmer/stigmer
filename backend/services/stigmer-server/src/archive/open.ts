/**
 * Opening a pushed archive — the kind-agnostic half of the ZIP gate every
 * archive-shaped push runs (skills, plugins). Two steps, both pure over the
 * bytes: `openArchive` bounds the compressed size, hashes the bytes (the
 * content-addressed version identity), parses the central directory and
 * applies the safearchive prefilter; `validateArchiveStructure` walks the
 * pre-filtered entries in the retired Go gate's exact order (empty
 * archive, file count, then per entry the filename control-character rule,
 * the running declared-uncompressed budget and the per-file ratio cap).
 *
 * What a KIND requires of the entries (a root SKILL.md, a plugin manifest)
 * is not here: the walk accepts an `onEntry` observer so a kind tracks what
 * it needs in the same pass and rules on it afterwards, which keeps the
 * observable error order the skill gate's tests pin.
 *
 * Error text is wire-visible contract: the sentences below are the Go
 * gate's verbatim, wrapped by each kind's push step into its own
 * InvalidArgument arm. Only declared sizes are judged here; inflating an
 * entry under a real cap is `inflate.ts`'s job.
 *
 * Proven by the skill gate's __tests__/zip-gate.test.ts (which composes
 * these) and by __tests__/open.test.ts for the plugin-shaped path.
 */
import { createHash } from "node:crypto";

import { parseZipStructure } from "@stigmer/zip-structure";
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

import type { ArchiveLimits } from "./limits.js";
import { MAX_ZIP_SIZE } from "./limits.js";
import { applyEntryPrefilter } from "./prefilter.js";
import type { PrefilteredEntry } from "./prefilter.js";

/** A parsed, pre-filtered archive with its content-addressed identity. */
export interface OpenedArchive {
  /** SHA-256 hex of the archive bytes. */
  readonly hash: string;
  /** The entries a kind may read, names sanitised, shadows dropped. */
  readonly entries: readonly PrefilteredEntry[];
}

/**
 * Bounds, hashes, parses and pre-filters. Throws plain Errors with
 * byte-pinned messages; the caller owns the gRPC code.
 */
export function openArchive(
  bytes: Uint8Array,
  maxZipSize: number = MAX_ZIP_SIZE,
): OpenedArchive {
  if (bytes.length > maxZipSize) {
    throw new Error(
      `ZIP file too large: ${bytes.length} bytes (max: ${maxZipSize})`,
    );
  }

  const hash = calculateHash(bytes);

  let entries: readonly ZipStructuralEntry[];
  try {
    entries = parseZipStructure(bytes);
  } catch {
    // Go's zip.NewReader surfaces stdlib ErrFormat here; its text is what
    // clients see via the %w chain, so it is pinned verbatim.
    throw new Error("invalid ZIP file: zip: not a valid zip file");
  }

  // safearchive MaximumSecurityMode rewrites the entry list before any
  // validation sees it — sanitized names, shadowed/special/8.3 entries
  // dropped.
  return { hash, entries: applyEntryPrefilter(entries) };
}

/**
 * The structural walk: empty archive, file-count cap, then per entry the
 * control-character rule, the running declared-uncompressed budget
 * (fail-fast) and the per-file compression-ratio cap. `onEntry` sees each
 * sanitised name in order so a kind can track its own requirements.
 */
export function validateArchiveStructure(
  entries: readonly PrefilteredEntry[],
  limits: ArchiveLimits,
  onEntry?: (name: string) => void,
): void {
  if (entries.length === 0) {
    throw new Error("ZIP file is empty");
  }

  if (entries.length > limits.maxFiles) {
    throw new Error(
      `too many files in ZIP: ${entries.length} (max: ${limits.maxFiles})`,
    );
  }

  let totalUncompressedSize = 0;

  for (const { name, entry } of entries) {
    onEntry?.(name);

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
    if (totalUncompressedSize > limits.maxUncompressedSize) {
      throw new Error(
        `total uncompressed size too large: ${totalUncompressedSize} bytes (max: ${limits.maxUncompressedSize})`,
      );
    }

    // Per-file compression ratio (ZIP-bomb guard); integer division as Go.
    if (entry.compressedSize > 0) {
      const ratio = Math.floor(entry.uncompressedSize / entry.compressedSize);
      if (ratio > limits.maxCompressionRatio) {
        throw new Error(
          `suspicious compression ratio in ${name}: ${ratio}:1 (max: ${limits.maxCompressionRatio}:1)`,
        );
      }
    }
  }
}

/** SHA-256 hex of the archive bytes (Go CalculateHash). */
export function calculateHash(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
