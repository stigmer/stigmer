// Tests that the review brief names every word scripts/review-verdict.mjs
// accepts, in the section each reader is told to read.
// Run via `node --test scripts/review-verdict-brief.test.mjs` (wired into root
// `npm test`).
//
// What these guard: a fresh reader reads only its own section of
// `.agents/skills/review-pull-request/SKILL.md` ("What the reviewer does" or
// "What the fix-check does"), and its answer is refused when it carries a word
// the script does not accept. So the reviewer's section must name every verdict
// and severity the script accepts, and the fix-check's section every fix-check
// verdict, each in backticks. The words are imported from the script, so a word
// added there fails here until the brief names it; a renamed or missing section
// fails by name rather than passing with nothing checked.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { FIX_VERDICTS, SEVERITIES, VERDICTS } from "./review-verdict.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRIEF = join(ROOT, ".agents/skills/review-pull-request/SKILL.md");

const REVIEWER_SECTION = "What the reviewer does";
const FIX_CHECK_SECTION = "What the fix-check does";

/**
 * Splits a Markdown document at its level-two headings, skipping lines inside
 * fenced code blocks, and returns a map from heading text to section body.
 */
export function sections(markdown) {
  const out = new Map();
  let current = null;
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && line.startsWith("## ")) {
      current = line.slice(3).trim();
      out.set(current, []);
      continue;
    }
    if (current !== null) out.get(current).push(line);
  }
  return new Map(
    [...out].map(([heading, lines]) => [heading, lines.join("\n")]),
  );
}

/** Returns the words of `words` that `body` never names in backticks. */
export function unnamed(body, words) {
  return words.filter((word) => !body.includes(`\`${word}\``));
}

const brief = sections(readFileSync(BRIEF, "utf8"));

function section(heading) {
  assert.ok(
    brief.has(heading),
    `the review brief has no "## ${heading}" section; a reader told to read it would find nothing`,
  );
  return brief.get(heading);
}

test("the reviewer's section names every verdict the script accepts", () => {
  assert.deepEqual(unnamed(section(REVIEWER_SECTION), VERDICTS), []);
});

test("the reviewer's section names every severity the script accepts", () => {
  assert.deepEqual(unnamed(section(REVIEWER_SECTION), SEVERITIES), []);
});

test("the fix-check's section names every fix-check verdict the script accepts", () => {
  assert.deepEqual(unnamed(section(FIX_CHECK_SECTION), FIX_VERDICTS), []);
});

test("sections splits at level-two headings and ignores fenced ones", () => {
  const doc = [
    "intro",
    "## One",
    "a `x`",
    "```md",
    "## Not a heading",
    "```",
    "## Two",
    "b",
  ].join("\n");
  const got = sections(doc);
  assert.deepEqual([...got.keys()], ["One", "Two"]);
  assert.match(got.get("One"), /## Not a heading/);
  assert.deepEqual(unnamed(got.get("One"), ["x", "y"]), ["y"]);
});
