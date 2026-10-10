/**
 * The suite's documents as the reader opens them: a file's text through the
 * `evalDocument` cap, a YAML mapping, and a Markdown file with optional
 * frontmatter. Each records a finding and returns `undefined` when the file
 * cannot be read, so the caller keeps reading the rest. Shared by the case
 * reader (`read-eval-suite.ts`) and the mock reader (`mocks.ts`).
 */

import { type JsonObject, readCapped } from "../documents.js";
import { decodeUtf8, type PluginFileIndex } from "../files.js";
import { extractFrontmatter, parseFrontmatter } from "../frontmatter.js";
import type { CaseFindings, EvalFindingKind, FieldScope } from "./fields.js";

/** One document's text through the `evalDocument` cap, or `undefined` after a finding of `kind`. */
export function readDocument(index: PluginFileIndex, path: string, kind: EvalFindingKind, findings: CaseFindings): string | undefined {
  const read = readCapped(index, path, "evalDocument");
  if (!read.ok) {
    findings.add(kind, path, `the file is ${read.size} bytes, over the ${read.limit}-byte limit`);
    return undefined;
  }
  return decodeUtf8(read.bytes);
}

/** A YAML mapping, or `undefined` after a finding. */
export function parseMapping(yaml: string, scope: FieldScope, what: string): JsonObject | undefined {
  const parsed = parseFrontmatter(yaml);
  if (!parsed.ok) {
    scope.findings.add(scope.invalid, scope.path, `${what} is not valid YAML: ${parsed.detail}`);
    return undefined;
  }
  return parsed.fields;
}

export interface MarkdownDocument {
  readonly fields: JsonObject;
  readonly body: string;
}

/**
 * A Markdown file with optional frontmatter: no opening `---` is a body
 * with no fields, an unclosed one is a finding.
 */
export function readMarkdown(index: PluginFileIndex, scope: FieldScope): MarkdownDocument | undefined {
  const text = readDocument(index, scope.path, scope.invalid, scope.findings);
  if (text === undefined) return undefined;
  const extracted = extractFrontmatter(text);
  if (!extracted.ok) {
    if (extracted.reason === "unclosed") {
      scope.findings.add(scope.invalid, scope.path, "the frontmatter is not closed (missing the closing '---')");
      return undefined;
    }
    return { fields: {}, body: text };
  }
  const fields = parseMapping(extracted.yaml, scope, "the frontmatter");
  return fields === undefined ? undefined : { fields, body: extracted.body };
}
