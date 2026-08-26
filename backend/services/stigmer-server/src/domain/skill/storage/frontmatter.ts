/**
 * SKILL.md frontmatter parsing — ports pkg/domain/skill/storage/
 * frontmatter.go. The backend is the single source of truth for parsing
 * SKILL.md: name (required, kebab-case with optional dot-scoped
 * namespaces) and description come from the YAML frontmatter between ---
 * markers at the start of the file. Every error string is wire-visible
 * teaching copy, byte-pinned from Go (multi-line "expected format" blocks
 * included).
 *
 * Proven by __tests__/frontmatter.test.ts and the skill conformance
 * suite's push-validation negatives.
 */
import yaml from "js-yaml";

// goTrimSpace: Go's exact TrimSpace set — a .trim()-based delimiter check
// would accept BOM'd "---" lines Go rejects (found by the #8 parity review
// panel; promoted to gocompat when search criteria became the second
// consumer, #14).
import { goTrimSpace } from "../../../gocompat/trim.js";

/** Parsed SKILL.md frontmatter (Go SkillFrontmatter). */
export interface SkillFrontmatter {
  /** Canonical skill identifier (required; kebab-case, optionally dot-scoped). */
  readonly name: string;
  /** Human-readable summary (optional but recommended). */
  readonly description: string;
  /** Informational only — hash-based versioning is used instead. */
  readonly version: string;
}

/**
 * Kebab-case skill names, optionally scoped with dot-separated namespaces:
 * lowercase letters, numbers, hyphens (words), and dots (namespace
 * segments). Every segment between separators must be alphanumeric, so a
 * name cannot start or end with a separator, nor contain consecutive
 * separators. The derived slug renders dots as hyphens (generateSlug).
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

/**
 * bufio.Scanner's default token cap (Go bufio.MaxScanTokenSize): lines
 * longer than this fail Go's scan loop, so the port enforces the same
 * ceiling — measured in BYTES, as the scanner buffers bytes. Two distinct
 * arms, faithful to Go's checking order: a too-long FIRST line makes the
 * initial Scan() return false before Err() is consulted (reported as
 * "SKILL.md is empty"), while a too-long line inside the frontmatter
 * surfaces the scanner error.
 */
const MAX_SCAN_TOKEN_SIZE = 64 * 1024;

function lineTooLong(line: string): boolean {
  return Buffer.byteLength(line, "utf8") > MAX_SCAN_TOKEN_SIZE;
}

/**
 * Extracts and parses YAML frontmatter from SKILL.md content (Go
 * ParseFrontmatter). Throws plain Errors — the push pipeline wraps them
 * into the InvalidArgument "failed to extract SKILL.md: ..." arm.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
  const frontmatterYaml = extractFrontmatterYaml(content);

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatterYaml);
  } catch (error) {
    throw new Error(
      `failed to parse YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const record =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  const frontmatter: SkillFrontmatter = {
    name: typeof record["name"] === "string" ? record["name"] : "",
    description:
      typeof record["description"] === "string" ? record["description"] : "",
    version: typeof record["version"] === "string" ? record["version"] : "",
  };

  validateFrontmatter(frontmatter);
  return frontmatter;
}

/**
 * Extracts the raw YAML between --- delimiters: the frontmatter must
 * start on the FIRST line with --- and end with --- on its own line
 * (whitespace-trimmed comparison on both, as Go's scanner loop does).
 */
function extractFrontmatterYaml(content: string): string {
  if (content === "") {
    throw new Error("SKILL.md is empty");
  }

  const lines = content.split(/\r?\n/);
  // Go's initial Scan() returns false for a first line over the scanner
  // cap — and its !Scan() arm reports "SKILL.md is empty" without ever
  // consulting Err(). Bug-for-bug: the misleading copy IS the contract.
  if (lineTooLong(lines[0]!)) {
    throw new Error("SKILL.md is empty");
  }
  const firstLine = goTrimSpace(lines[0]!);
  if (firstLine !== "---") {
    throw new Error(
      "SKILL.md must start with YAML frontmatter (---)\n\n" +
        "Expected format:\n" +
        "---\n" +
        "name: my-skill-name\n" +
        "description: A brief description of what this skill does\n" +
        "---\n" +
        "# Skill Title\n" +
        "...",
    );
  }

  const frontmatterLines: string[] = [];
  let foundClosing = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (lineTooLong(line)) {
      // Go: the scan loop stops, and Err() is checked BEFORE the
      // closing-delimiter check — so an over-cap line inside the
      // frontmatter wins over "not closed". Message text is the %w-chain
      // rendering of bufio.ErrTooLong.
      throw new Error(
        "error reading SKILL.md content: bufio.Scanner: token too long",
      );
    }
    if (goTrimSpace(line) === "---") {
      foundClosing = true;
      break;
    }
    frontmatterLines.push(line);
  }

  if (!foundClosing) {
    throw new Error("SKILL.md frontmatter is not closed (missing closing ---)");
  }

  if (frontmatterLines.length === 0) {
    throw new Error(
      "SKILL.md has empty frontmatter\n\n" +
        "The frontmatter must contain at least a 'name' field:\n" +
        "---\n" +
        "name: my-skill-name\n" +
        "---",
    );
  }

  return frontmatterLines.join("\n");
}

/** Required-field and format validation (Go validateFrontmatter). */
function validateFrontmatter(frontmatter: SkillFrontmatter): void {
  if (frontmatter.name === "") {
    throw new Error(
      "SKILL.md is missing required 'name' field in YAML frontmatter\n\n" +
        "Expected format:\n" +
        "---\n" +
        "name: my-skill-name\n" +
        "---\n\n" +
        "The name must be kebab-case (lowercase letters, numbers, and hyphens), " +
        "optionally scoped with dots (e.g. 'platform.my-skill')",
    );
  }

  if (!SKILL_NAME_PATTERN.test(frontmatter.name)) {
    throw new Error(
      `invalid skill name '${frontmatter.name}' in SKILL.md\n\n` +
        "Skill names must be kebab-case, optionally scoped with dot-separated namespaces:\n" +
        "- Lowercase letters (a-z)\n" +
        "- Numbers (0-9)\n" +
        "- Hyphens (-) to separate words\n" +
        "- Dots (.) to separate namespace segments\n\n" +
        "Every segment must be alphanumeric: no leading, trailing, or consecutive separators.\n\n" +
        "Examples: 'calculator', 'web-scraper', 'math-utils', 'platform.planton-architecture'",
    );
  }
}
