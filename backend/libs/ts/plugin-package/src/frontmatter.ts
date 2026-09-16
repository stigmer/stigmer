/**
 * YAML frontmatter extraction for `SKILL.md` and sub-agent files, and the
 * skill name rule.
 *
 * The delimiter discipline is the server's skill push gate's: the file must
 * open with `---` on its first line and close with `---` on a line of its
 * own, both compared after trimming whitespace. Extraction and parsing are
 * separate steps because the two callers differ on what a missing block
 * means: a `SKILL.md` without frontmatter is refused (the Agent Skills
 * format requires it), while a sub-agent file without frontmatter is a
 * prompt named after its file (the Claude Code posture).
 *
 * `SKILL_NAME_PATTERN` is the server's rule for a skill name (kebab-case,
 * optionally dot-scoped), a strict superset of the Agent Skills rule
 * (lowercase alphanumerics and hyphens), so no skill valid under the open
 * format is refused here. This module is meant to become the pattern's one
 * home; the server's `frontmatter.ts` carries the same regex today.
 */

import { parse as parseYaml } from "yaml";

import { isJsonObject, type JsonObject } from "./documents.js";

/**
 * Kebab-case, optionally scoped with dot-separated namespaces. Every
 * segment between separators is alphanumeric, so a name cannot start or end
 * with a separator or contain consecutive separators. The derived slug
 * renders dots as hyphens.
 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+([.-][a-z0-9]+)*$/;

export type FrontmatterExtraction =
  | { readonly ok: true; readonly yaml: string; readonly body: string }
  | { readonly ok: false; readonly reason: "missing" | "unclosed" };

/** Split a document into its frontmatter YAML and its body. */
export function extractFrontmatter(content: string): FrontmatterExtraction {
  const lines = content.split(/\r?\n/);
  if (lines.length === 0 || lines[0]?.trim() !== "---") {
    return { ok: false, reason: "missing" };
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      return { ok: true, yaml: lines.slice(1, i).join("\n"), body: lines.slice(i + 1).join("\n") };
    }
  }
  return { ok: false, reason: "unclosed" };
}

export type FrontmatterParse =
  | { readonly ok: true; readonly fields: JsonObject }
  | { readonly ok: false; readonly detail: string };

/**
 * Parse frontmatter YAML into a field map. An empty block is an empty map
 * (the caller decides whether required fields are missing); a scalar or a
 * list where a map was expected is a parse failure with its own detail.
 * `yaml`'s defaults are the safe ones: no custom tags, aliases capped.
 */
export function parseFrontmatter(yaml: string): FrontmatterParse {
  let value: unknown;
  try {
    value = parseYaml(yaml);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
  if (value === null || value === undefined) return { ok: true, fields: {} };
  if (!isJsonObject(value)) return { ok: false, detail: "the frontmatter is not a mapping" };
  return { ok: true, fields: value };
}
