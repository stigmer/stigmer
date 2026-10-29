/**
 * SKILL.md frontmatter parsing. The backend is the single source of truth
 * for parsing SKILL.md: name (required, kebab-case with optional dot-scoped
 * namespaces) and description come from the YAML frontmatter between ---
 * markers at the start of the file. Every error string is wire-visible
 * teaching copy, byte-pinned (multi-line "expected format" blocks
 * included): existing error copy is wire contract.
 *
 * Proven by __tests__/frontmatter.test.ts and the skill conformance
 * suite's push-validation negatives.
 */
import yaml from "js-yaml";

// trimWhiteSpace, not .trim(): a .trim()-based delimiter check would accept
// a BOM'd "---" line, which the frontmatter refuses.
import { trimWhiteSpace } from "../../../text/whitespace.js";

/** Parsed SKILL.md frontmatter. */
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
 * The per-line ceiling of a SKILL.md read, measured in BYTES. Two distinct
 * arms, each with its pinned copy: a too-long FIRST line is reported as
 * "SKILL.md is empty", while a too-long line inside the frontmatter
 * surfaces the "token too long" read error.
 */
const MAX_SCAN_TOKEN_SIZE = 64 * 1024;

function lineTooLong(line: string): boolean {
  return Buffer.byteLength(line, "utf8") > MAX_SCAN_TOKEN_SIZE;
}

/**
 * Extracts and parses YAML frontmatter from SKILL.md content. Throws plain
 * Errors — the push pipeline wraps them
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
 * (whitespace-trimmed comparison on both).
 */
function extractFrontmatterYaml(content: string): string {
  if (content === "") {
    throw new Error("SKILL.md is empty");
  }

  const lines = content.split(/\r?\n/);
  // A first line over the cap reports "SKILL.md is empty". The misleading
  // copy IS the contract (existing error copy is wire contract).
  if (lineTooLong(lines[0]!)) {
    throw new Error("SKILL.md is empty");
  }
  const firstLine = trimWhiteSpace(lines[0]!);
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
      // Checked BEFORE the closing-delimiter check, so an over-cap line
      // inside the frontmatter wins over "not closed". The message text is
      // pinned wire copy.
      throw new Error(
        "error reading SKILL.md content: bufio.Scanner: token too long",
      );
    }
    if (trimWhiteSpace(line) === "---") {
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

/** Required-field and format validation. */
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
