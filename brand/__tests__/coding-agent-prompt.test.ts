/**
 * The setup prompt reads the same wherever a person copies it.
 *
 * `CODING_AGENT_PROMPT` (../coding-agent-prompt.ts) is the one home of the
 * words. The docs front page imports it; the setup page, the console's first
 * question and the plugin's README each spell it out, and each is held here to
 * the constant, with whitespace collapsed because prose wraps the sentence
 * across lines. A copy that moved, or one this test can no longer find, fails
 * naming its file.
 *
 * The door walk each release runs finds the prompt on the live setup page by
 * its first words, so the constant is held to open with them too.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PROMPT_START } from "../../test/install/lib/coding-agent-door.mjs";
import { CODING_AGENT_PROMPT } from "../coding-agent-prompt";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** The copy `found` in `path` is the prompt; `where` says what was looked for, for the failure. */
function holds(path: string, where: string, found: string | undefined): void {
  assert.notEqual(found, undefined, `${path}: no ${where} to read the prompt from`);
  assert.equal(collapse(found ?? ""), CODING_AGENT_PROMPT, `${path}: ${where}; change it and brand/coding-agent-prompt.ts together`);
}

test("the setup page's code block is the prompt", () => {
  const path = "docs/getting-started/coding-agent.mdx";
  const block = /^```text title="Paste into your coding agent"\n([\s\S]*?)\n```$/m.exec(read(path))?.[1];
  holds(path, 'the block titled "Paste into your coding agent"', block);
});

test("the console's first question offers the prompt", () => {
  const path = "sdk/react/src/session/first-question/FirstQuestion.tsx";
  const literal = /\bexport const CODING_AGENT_PROMPT =\s*("(?:[^"\\\n]|\\.)*");/.exec(read(path))?.[1];
  holds(path, "the CODING_AGENT_PROMPT string", literal === undefined ? undefined : (JSON.parse(literal) as string));
});

test("the coding-agent plugin's README quotes the prompt", () => {
  const path = "coding-agents/plugin/README.md";
  const quote = /^(?:> ?.*\n)+/m.exec(read(path))?.[0].replace(/^> ?/gm, "");
  holds(path, "the quoted prompt", quote);
});

test("the prompt opens with the words the release's door walk finds it by", () => {
  assert.ok(
    CODING_AGENT_PROMPT.startsWith(PROMPT_START),
    `test/install/lib/coding-agent-door.mjs reads the block that starts "${PROMPT_START}" from the live setup page`,
  );
});
