/**
 * The <Term> glossary against its source of truth. glossary.ts says each
 * definition is copied from the term's entry in docs/vocabulary.md; this pins
 * that every glossary term has an entry there, and that each definition is
 * the entry's first paragraph. Terms that differ today are listed, each a
 * known gap (https://github.com/stigmer/stigmer/issues/1788): fixing one
 * fails here until its line is removed, and a new difference fails at once.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { glossary } from "../glossary";

const VOCABULARY = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../docs/vocabulary.md"),
  "utf8",
);

/** Definitions that differ from their vocabulary entry today (stigmer#1788). */
const KNOWN_DIFFERENCES: ReadonlyArray<string> = [
  "Agent",
  "Agent Execution",
  "Agent Instance",
  "Session",
  "Workflow",
  "Skill",
  "MCP Server",
  "PlatformClient",
  "Environment",
  "Agent Channel",
];

/** The first paragraph under `#### <term>`, whitespace normalised; undefined when there is no entry. */
function vocabularyDefinition(term: string): string | undefined {
  const lines = VOCABULARY.split("\n");
  const heading = lines.indexOf(`#### ${term}`);
  if (heading === -1) return undefined;
  const paragraph: string[] = [];
  for (const line of lines.slice(heading + 1)) {
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  return paragraph.join(" ");
}

describe("the docs glossary follows docs/vocabulary.md", () => {
  it("every glossary term has an entry in the vocabulary guide", () => {
    const missing = Object.keys(glossary).filter((term) => vocabularyDefinition(term) === undefined);
    expect(missing).toEqual([]);
  });

  it("each definition is its entry's first paragraph, but for the listed known differences", () => {
    const differing = Object.entries(glossary)
      .filter(([term, definition]) => vocabularyDefinition(term) !== definition)
      .map(([term]) => term);
    expect(differing).toEqual(KNOWN_DIFFERENCES);
  });
});
