/**
 * Skill artifact ZIP gate — ports pkg/domain/skill/storage/zip_extractor.go
 * arm-for-arm. Validates an uploaded artifact (size caps, ZIP-bomb
 * budgets, entry-count and filename rules, root-SKILL.md presence with the
 * #452 hint), extracts SKILL.md IN MEMORY ONLY (never to disk), and parses
 * its frontmatter.
 *
 * The kind-agnostic half (open, hash, prefilter, structural walk, capped
 * inflate with CRC) is src/archive's, shared with the plugin gate since
 * plugins are pushed as archives too; this module composes it and owns
 * what is a SKILL's: the root-SKILL.md rule, the 1 MB document cap, the
 * frontmatter parse, and every sentence below. The observable error order
 * is the Go gate's exactly: the structural walk tracks SKILL.md placement
 * in the same pass it validates, and rules on presence last.
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
import { InflateError, inflateEntry } from "../../../archive/inflate.js";
import { PLATFORM_ARCHIVE_LIMITS } from "../../../archive/limits.js";
import {
  openArchive,
  validateArchiveStructure,
} from "../../../archive/open.js";
import type { PrefilteredEntry } from "../../../archive/prefilter.js";
import {
  MAX_SKILL_MD_SIZE,
  MAX_ZIP_SIZE,
  NESTED_SKILL_MD_HINT,
} from "../constants.js";
import { parseFrontmatter } from "./frontmatter.js";

export { calculateHash } from "../../../archive/open.js";

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

/**
 * Validates the artifact and extracts SKILL.md + frontmatter (Go
 * ExtractSkillMd). Throws plain Errors with byte-pinned messages; the
 * push pipeline owns the gRPC code.
 */
export function extractSkillMd(zipData: Uint8Array): ExtractSkillMdResult {
  const { hash, entries } = openArchive(zipData, MAX_ZIP_SIZE);

  // SKILL.md must be at the archive root. Nested occurrences are tracked
  // only to make the rejection actionable (the #452 hint), in the same
  // pass the structural checks run so their precedence stays Go's.
  let hasSkillMd = false;
  let hasNestedSkillMd = false;
  validateArchiveStructure(entries, PLATFORM_ARCHIVE_LIMITS, (name) => {
    if (name === "SKILL.md") {
      hasSkillMd = true;
    } else if (name.endsWith("/SKILL.md")) {
      hasNestedSkillMd = true;
    }
  });

  if (!hasSkillMd) {
    if (hasNestedSkillMd) {
      throw new Error(NESTED_SKILL_MD_HINT);
    }
    throw new Error("SKILL.md not found in ZIP archive");
  }

  const content = extractSkillMdContent(entries);

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
 * Extracts SKILL.md's content in memory (Go extractSkillMdContent): the
 * first root-named entry, decompressed under the 1MB cap, CRC-verified,
 * UTF-8 decoded. The typed inflate outcome maps to Go's sentences here.
 */
function extractSkillMdContent(entries: readonly PrefilteredEntry[]): string {
  for (const { name, entry } of entries) {
    if (name !== "SKILL.md") {
      continue;
    }

    let contentBytes: Uint8Array;
    try {
      contentBytes = inflateEntry(entry, MAX_SKILL_MD_SIZE);
    } catch (error) {
      if (!(error instanceof InflateError)) {
        throw error;
      }
      switch (error.kind) {
        case "too-large":
          throw new Error(
            `SKILL.md too large (max: ${MAX_SKILL_MD_SIZE} bytes)`,
          );
        case "read-failed":
          throw new Error(`failed to read SKILL.md: ${error.detail}`);
        case "unsupported-method":
          throw new Error(`failed to open SKILL.md: ${error.detail}`);
        case "checksum":
          throw new Error(`failed to read SKILL.md: ${error.detail}`);
        default: {
          const exhaustive: never = error.kind;
          throw new Error(`unknown inflate failure ${String(exhaustive)}`);
        }
      }
    }

    if (contentBytes.length === 0) {
      throw new Error("SKILL.md is empty");
    }

    return new TextDecoder().decode(contentBytes);
  }

  throw new Error("SKILL.md not found in ZIP archive");
}
