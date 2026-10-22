/**
 * Hold every copy of Stigmer's words equal to brand/positioning.ts.
 *
 * Code reads the words from POSITIONING; prose cannot import, so the prose
 * homes (the vocabulary's positioning section, the docs' front page, "What
 * is Stigmer?" and the docs assistant's Skill) are read here and must match
 * it, and no text source in the site or the console may carry the words, or
 * a retired tagline, as a literal of its own. A failure names the copy that
 * drifted.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { POSITIONING } from "../positioning";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The first quoted string of the vocabulary paragraph that opens with `**label**`. */
function vocabularyWords(markdown: string, label: string): string | undefined {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .find((block) => block.startsWith(`**${label}**`));
  return paragraph === undefined
    ? undefined
    : /"([^"]+)"/.exec(collapse(paragraph))?.[1];
}

test("docs/vocabulary.md states the words POSITIONING holds", () => {
  const vocabulary = read("docs/vocabulary.md");
  for (const [label, words] of [
    ["The headline", POSITIONING.headline],
    ["The subhead", POSITIONING.subhead],
    ["The one sentence", POSITIONING.oneSentence],
  ] as const) {
    assert.equal(
      vocabularyWords(vocabulary, label),
      words,
      `docs/vocabulary.md: **${label}**`,
    );
  }
});

test("docs/index.mdx carries the headline, the subhead and the one sentence", () => {
  const page = read("docs/index.mdx");
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(page)?.[1] ?? "";
  const hero = /<Hero\b([\s\S]*?)\/>/.exec(page)?.[1] ?? "";
  const attribute = (name: string) =>
    new RegExp(`\\b${name}="([^"]*)"`).exec(hero)?.[1];
  assert.equal(
    /^description:\s*(.+)$/m.exec(frontmatter)?.[1],
    POSITIONING.oneSentence,
    "docs/index.mdx: frontmatter description",
  );
  assert.equal(attribute("title"), POSITIONING.headline, "docs/index.mdx: <Hero title>");
  assert.equal(
    attribute("description"),
    POSITIONING.subhead,
    "docs/index.mdx: <Hero description>",
  );
});

/** Whether `text` carries `words`, compared with whitespace collapsed and case folded. */
const carries = (text: string, words: string) =>
  collapse(text).toLowerCase().includes(words.toLowerCase());

test("What is Stigmer? opens with the one sentence and where it runs", () => {
  const page = read("docs/concepts/what-is-stigmer.mdx");
  const [, frontmatter = "", body = ""] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(page) ?? [];
  const description = /^description:([\s\S]*?)(?=^\S|$(?![\s\S]))/m.exec(frontmatter)?.[1] ?? "";
  const opening = body.trim().split(/\n\s*\n/)[0] ?? "";
  const path = "docs/concepts/what-is-stigmer.mdx";
  assert.ok(carries(description, POSITIONING.oneSentence), `${path}: frontmatter description`);
  assert.ok(carries(opening, POSITIONING.oneSentence), `${path}: opening paragraph, the one sentence`);
  assert.ok(carries(opening, POSITIONING.whereItRuns), `${path}: opening paragraph, where it runs`);
});

test("the docs assistant's Skill says what Stigmer is in the same words", () => {
  const path = "docs-agent/skills/stigmer-docs/SKILL.md";
  const section = /^## What Stigmer is\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(read(path))?.[1];
  assert.ok(section !== undefined, `${path}: a "## What Stigmer is" section`);
  assert.ok(carries(section, POSITIONING.oneSentence), `${path}: "What Stigmer is", the one sentence`);
  assert.ok(carries(section, POSITIONING.whereItRuns), `${path}: "What Stigmer is", where it runs`);
});

/** Where the site and the console keep their text sources. */
const CODE_ROOTS = ["site/src", "site/scripts", "site/public", "client-apps/web/src"];

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".js",
  ".jsx",
  ".mjs",
  ".json",
  ".txt",
  ".md",
  ".mdx",
  ".html",
  ".webmanifest",
]);

/**
 * The words no source may spell out: the current ones (with the trailing
 * period dropped, so a copy without it is caught too) and the taglines they
 * replaced. A source is compared with its whitespace collapsed and its case
 * folded, so prose wrapped across lines, or a copy in another case, is
 * caught too.
 */
const HAND_COPIES = [
  POSITIONING.headline,
  POSITIONING.subhead,
  POSITIONING.oneSentence,
  POSITIONING.whereItRuns,
  "Build agents that work for your business",
  "Agents as Microservices",
].map((words) => words.replace(/\.$/, ""));

function* textSources(dir: string): Generator<string> {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "__tests__") {
        yield* textSources(path);
      }
    } else if (TEXT_EXTENSIONS.has(extname(entry.name)) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield path;
    }
  }
}

test("no site or console source holds the words as a literal of its own", () => {
  const copies: string[] = [];
  for (const root of CODE_ROOTS) {
    for (const path of textSources(root)) {
      const text = collapse(read(path)).toLowerCase();
      for (const words of HAND_COPIES) {
        if (text.includes(words.toLowerCase())) copies.push(`${path}: "${words}"`);
      }
    }
  }
  assert.deepEqual(copies, [], "import POSITIONING from brand/positioning.ts instead");
});
