/**
 * Stigmer says it is in Beta in the same words wherever a newcomer meets it.
 *
 * `BETA` (../beta.ts) is the one home of the words and the page. The site's
 * mark imports it; every other surface spells it out, and each is held here:
 * it carries the line, with whitespace collapsed because prose wraps it, and
 * links the page. A copy that moved fails naming its file. Lifting Beta
 * deletes ../beta.ts, and every test here then names a copy left to remove.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { BETA } from "../beta";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** `path` says the line and links the page by `link`. */
function says(path: string, link: string): void {
  const text = collapse(read(path));
  assert.ok(text.includes(BETA.line), `${path}: does not say "${BETA.line}"; change it and brand/beta.ts together`);
  assert.ok(text.includes(link), `${path}: does not link ${link}; change it and brand/beta.ts together`);
}

/** The string constant `name` in a published package's source, which cannot import brand/. */
function constant(path: string, name: string): string | undefined {
  const literal = new RegExp(`\\bexport const ${name} =\\s*("(?:[^"\\\\\\n]|\\\\.)*");`).exec(read(path))?.[1];
  return literal === undefined ? undefined : (JSON.parse(literal) as string);
}

test("the page every mention links is where the words say", () => {
  assert.ok(BETA.url.endsWith(BETA.path));
  assert.ok(existsSync(join(ROOT, `docs${BETA.path.replace(/^\/docs/, "")}.mdx`)), `no page at ${BETA.path}`);
});

for (const [path, label] of [
  ["sdk/react/src/internal/beta.ts", "the console kit"],
  ["client-apps/cli/src/beta.ts", "the command line"],
] as const) {
  test(`${label} says the line and links the page (${path})`, () => {
    assert.equal(constant(path, "BETA_LINE"), BETA.line, `${path}: BETA_LINE; change it and brand/beta.ts together`);
    assert.equal(constant(path, "BETA_URL"), BETA.url, `${path}: BETA_URL; change it and brand/beta.ts together`);
  });
}

test("the console kit's mark says the word", () => {
  assert.equal(constant("sdk/react/src/internal/beta.ts", "BETA_WORD"), BETA.word);
});

for (const [path, link] of [
  ["coding-agents/plugin/skills/stigmer-setup/SKILL.md", BETA.url],
  ["coding-agents/plugin/README.md", BETA.url],
  ["README.md", BETA.url],
  ["docs/getting-started/coding-agent.mdx", `](${BETA.path})`],
  ["docs/vocabulary.md", `](${BETA.path})`],
] as const) {
  test(`${path} says the line and links the page`, () => says(path, link));
}

test("the Beta page opens on the line", () => {
  const path = `docs${BETA.path.replace(/^\/docs/, "")}.mdx`;
  const body = read(path).replace(/^---\n[\s\S]*?\n---\n/, "");
  assert.ok(collapse(body).startsWith(BETA.line), `${path}: does not open on "${BETA.line}"`);
});

test("docs/vocabulary.md's **Beta** entry quotes the line", () => {
  const paragraph = read("docs/vocabulary.md")
    .split(/\n\s*\n/)
    .find((block) => block.startsWith("**Beta**"));
  assert.notEqual(paragraph, undefined, "docs/vocabulary.md: no **Beta** entry");
  assert.equal(/"([^"]+)"/.exec(collapse(paragraph ?? ""))?.[1], BETA.line, "docs/vocabulary.md: **Beta**");
});
