// Holds the coding-agent door's pure parts (lib/coding-agent-door.mjs) to
// what the published walk relies on: the prompt is read from the page's
// served HTML exactly as a person copies it, a page without it (or with two)
// is refused rather than replaced by this checkout's copy, the flags refuse a
// published walk with no version and a version without one, and every npm
// read names both registries; and the app's process group is gone before the
// scratch folder is removed, with the race that turned a passed walk red
// (stigmer/stigmer#3154) forced by a group that keeps writing after SIGTERM.
// The page sample is the code block stigmer.ai
// served for docs/getting-started/coding-agent.mdx, cut to the block and the
// prose beside it.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { NPM_REGISTRY, fetchPagePrompt, npmRegistryFlags, parseDoorArgs, promptFromPage, stopProcessGroup, withoutTags } from "./coding-agent-door.mjs";

const SERVED = `<figure dir="ltr" class="my-4 bg-fd-card rounded-xl shiki relative border"><div class="flex text-fd-muted-foreground items-center gap-2 h-9.5 border-b px-4"><figcaption class="flex-1 truncate">Paste into your coding agent</figcaption></div><div class="text-[13px] py-3.5 overflow-auto max-h-[600px] fd-scroll-container"><pre class="min-w-full w-max *:flex *:flex-col"><code><span class="line"><span>Set up Stigmer for this project. Install its command line</span></span>
<span class="line"><span>(\`npm install -g @stigmer/cli\`, or \`brew install stigmer/tap/stigmer\`),</span></span>
<span class="line"><span>run \`stigmer coding-agent\`, and follow what it prints.</span></span></code></pre></div></figure>
<p>The console offers the same prompt under its first question (&quot;Let your coding
agent set it up&quot;), with its own address added.</p>
<p>With the plugin installed, you only say &quot;Set up Stigmer for this project&quot; in
another app.</p>
<pre><code><span class="line"><span>claude plugin install stigmer --marketplace stigmer/coding-agent-plugin</span></span></code></pre>`;

/** The console's copy (sdk/react's CODING_AGENT_PROMPT), which the page's block must read as. */
const CONSOLE_PROMPT = /CODING_AGENT_PROMPT =\s*"([^"]+)"/.exec(
  readFileSync(new URL("../../../sdk/react/src/session/first-question/FirstQuestion.tsx", import.meta.url), "utf8"),
)?.[1];

test("the prompt is the page's code block, its lines joined, and reads as the console's copy", () => {
  const prompt = promptFromPage(SERVED);
  assert.equal(
    prompt,
    "Set up Stigmer for this project. Install its command line (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run `stigmer coding-agent`, and follow what it prints.",
  );
  assert.equal(prompt, CONSOLE_PROMPT);
});

test("entities in the block are decoded, and prose that quotes the prompt is not a block", () => {
  const html = `<p>&quot;Set up Stigmer for this project.&quot;</p><pre><code>Set up Stigmer for this project. Run &#x60;stigmer coding-agent&#x60; &amp; follow it.</code></pre>`;
  assert.equal(promptFromPage(html), "Set up Stigmer for this project. Run `stigmer coding-agent` & follow it.");
});

test("a page that lost the prompt is refused in words, never answered with another copy", () => {
  assert.throws(
    () => promptFromPage(`<p>Set up Stigmer for this project.</p><pre><code>npm install -g @stigmer/cli</code></pre>`, { page: "https://example.test/door" }),
    /https:\/\/example\.test\/door carries no code block that starts with "Set up Stigmer for this project\." \(1 code blocks read\)/,
  );
});

test("two different prompts on the page are refused; the same block twice is one prompt", () => {
  const block = (text) => `<pre><code>${text}</code></pre>`;
  assert.throws(() => promptFromPage(block("Set up Stigmer for this project. A.") + block("Set up Stigmer for this project. B.")), /2 different prompts/);
  assert.equal(promptFromPage(block("Set up Stigmer for this project. A.") + block("Set up Stigmer for this project. A.")), "Set up Stigmer for this project. A.");
});

test("the page must answer 200", async () => {
  const fetchImpl = async () => new Response("gone", { status: 404 });
  await assert.rejects(fetchPagePrompt({ page: "https://example.test/door", fetchImpl }), /answered HTTP 404, not 200/);
  const served = async () => new Response(SERVED, { status: 200 });
  assert.equal(await fetchPagePrompt({ fetchImpl: served }), CONSOLE_PROMPT);
});

test("without --published the flags are today's, and the published ones are refused", () => {
  assert.deepEqual(parseDoorArgs([]), {
    help: false,
    keep: false,
    local: false,
    maxTurns: 8,
    published: false,
    version: "",
    registry: "",
    model: "",
    claudeMaxTurns: undefined,
    maxBudgetUsd: undefined,
  });
  assert.equal(parseDoorArgs(["--local", "--keep", "--max-turns=3"]).maxTurns, 3);
  assert.throws(() => parseDoorArgs(["--version=0.1.4"]), /apply only with --published/);
  assert.throws(() => parseDoorArgs(["--registry=https://npm.example.test/"]), /apply only with --published/);
  assert.throws(() => parseDoorArgs(["--frobnicate"]), /unknown argument --frobnicate/);
});

test("a published walk needs a version, and the registry defaults to npm's", () => {
  assert.throws(() => parseDoorArgs(["--published"]), /--published needs --version/);
  assert.throws(() => parseDoorArgs(["--published", "--version=latest"]), /not a version/);
  const release = parseDoorArgs(["--published", "--version=v0.1.4"]);
  assert.equal(release.version, "0.1.4");
  assert.equal(release.registry, NPM_REGISTRY);
  const dev = parseDoorArgs(["--published", "--version=0.1.4-dev.20261114081802.gd0762079b891", "--registry=https://npm.example.test/stigmer-npm"]);
  assert.equal(dev.registry, "https://npm.example.test/stigmer-npm/");
  assert.throws(() => parseDoorArgs(["--published", "--version=0.1.4", "--registry=file:///tmp"]), /must be http\(s\)/);
});

test("Claude Code's bounds are positive numbers", () => {
  const bounded = parseDoorArgs(["--model=haiku", "--claude-max-turns=40", "--max-budget-usd=1.5"]);
  assert.equal(bounded.model, "haiku");
  assert.equal(bounded.claudeMaxTurns, 40);
  assert.equal(bounded.maxBudgetUsd, 1.5);
  assert.throws(() => parseDoorArgs(["--claude-max-turns=0"]), /positive whole number/);
  assert.throws(() => parseDoorArgs(["--max-budget-usd=free"]), /positive number/);
  assert.throws(() => parseDoorArgs(["--model="]), /needs a model name/);
});

test("every npm read names both registries", () => {
  assert.deepEqual(npmRegistryFlags("https://npm.example.test/stigmer-npm/"), [
    "--registry=https://registry.npmjs.org/",
    "--@stigmer:registry=https://npm.example.test/stigmer-npm/",
  ]);
});

test("withoutTags removes tags until none is left, a tag formed by removing another included", () => {
  assert.equal(withoutTags("<code>Set up <b>Stigmer</b></code>"), "Set up Stigmer");
  for (const crafted of ["<<b>script>x", "<scr<b>ipt>x", "<<<a>>>b", "<a<b<c>>>d"]) {
    assert.doesNotMatch(withoutTags(crafted), /<[^>]*>/, crafted);
  }
  assert.equal(withoutTags("plain words"), "plain words");
});

/**
 * A detached process group shaped like `npx next dev`: a leader and a child,
 * each writing a new folder into `dir` every 2 ms, and on SIGTERM going on
 * writing for `afterTermMs` before exiting (Next flushes `.next/` as it
 * stops). With `ignoreTerm`, SIGTERM is ignored.
 */
const WRITER = `
const { mkdirSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const [dir, tag, afterTermMs, ignoreTerm] = process.argv.slice(2);
let n = 0;
setInterval(() => { const d = join(dir, tag + "-" + n++); mkdirSync(d); writeFileSync(join(d, "f"), "x"); }, 2);
process.on("SIGTERM", () => { if (ignoreTerm !== "1") setTimeout(() => process.exit(0), Number(afterTermMs)); });
if (tag === "leader") spawn(process.execPath, [__filename, dir, "child", afterTermMs, ignoreTerm], { stdio: "ignore" });
`;

function writerGroup(dir, { afterTermMs = 400, ignoreTerm = false } = {}) {
  const script = `${dir}-writer.cjs`;
  writeFileSync(script, WRITER);
  return spawn(process.execPath, [script, dir, "leader", String(afterTermMs), ignoreTerm ? "1" : "0"], { detached: true, stdio: "ignore" });
}

async function untilWritten(dir, prefix) {
  for (let i = 0; i < 200; i++) {
    if (readdirSync(dir).some((name) => name.startsWith(prefix))) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`no ${prefix} folder appeared in ${dir}`);
}

test("stopProcessGroup waits out a group that writes after SIGTERM, so the folder it wrote into removes cleanly", async () => {
  const dir = mkdtempSync(join(tmpdir(), "door-teardown-"));
  const group = writerGroup(dir);
  try {
    await untilWritten(dir, "leader-");
    await untilWritten(dir, "child-");
    assert.equal(await stopProcessGroup(group), "terminated");
    rmSync(dir, { recursive: true, force: true });
    assert.equal(existsSync(dir), false);
  } finally {
    try {
      process.kill(-group.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(`${dir}-writer.cjs`, { force: true });
  }
});

test("stopProcessGroup kills a group that ignores SIGTERM after its grace, and reports a group already gone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "door-teardown-"));
  const group = writerGroup(dir, { ignoreTerm: true });
  try {
    await untilWritten(dir, "child-");
    assert.equal(await stopProcessGroup(group, { graceMs: 300 }), "killed");
    assert.equal(await stopProcessGroup(group), "gone");
    assert.equal(await stopProcessGroup(undefined), "gone");
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10 });
    rmSync(`${dir}-writer.cjs`, { force: true });
  }
});
