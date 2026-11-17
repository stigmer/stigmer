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

import { DOOR_FILE, DOOR_REPLY, DOOR_REPORT, NPM_REGISTRY, fetchPagePrompt, npmRegistryFlags, parseDoorArgs, promptFromPage, runnerLogNotes, stopProcessGroup, streamDigest, withoutTags } from "./coding-agent-door.mjs";

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

/** Stream-json lines in Claude Code 2.1.325's shape, from the walk's kept stream, cut to the parts the digest reads. */
const STREAM = [
  { type: "system", subtype: "init" },
  { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "stigmer auth whoami 2>&1; echo \"--- exit $?\"" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "This Bash command contains multiple operations. The following part requires approval: echo \"--- exit $?\"" }] } },
  { type: "assistant", message: { content: [{ type: "text", text: "Signed in." }, { type: "tool_use", id: "t2", name: "Read", input: { file_path: "stigmer/a.yaml" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "name: a" }] }] } },
  { type: "user", message: "a plain string message" },
]
  .map((event) => JSON.stringify(event))
  .concat(["not json"])
  .join("\n");

test("a failed walk's digest names each refused call with its refusal, then the last calls", () => {
  assert.deepEqual(streamDigest(STREAM), [
    "the coding agent made 2 tool call(s), 1 refused",
    'refused: Bash stigmer auth whoami 2>&1; echo "--- exit $?" -> This Bash command contains multiple operations. The following part requires approval: echo "--- exit $?"',
    'call 1: Bash stigmer auth whoami 2>&1; echo "--- exit $?"',
    'call 2: Read {"file_path":"stigmer/a.yaml"}',
  ]);
  assert.deepEqual(streamDigest(STREAM, { last: 1 }).slice(-1), ['call 2: Read {"file_path":"stigmer/a.yaml"}']);
  assert.deepEqual(streamDigest(""), ["the coding agent made 0 tool call(s), 0 refused"]);
  const long = streamDigest(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "x", name: "Bash", input: { command: "a".repeat(500) } }] } }));
  assert.equal(long[1].length, "call 1: ".length + 240);
});

test("a failed walk's runner notes keep its warnings, errors and output lines, without every walk's noise", () => {
  const log = [
    "(node:5676) ExperimentalWarning: SQLite is an experimental feature and might change at any time",
    "(Use `node --trace-warnings ...` to show where the warning was created)",
    "2026-11-15T09:18:23.206Z [WARN] No workflows registered, not polling for workflow tasks",
    "Failed to fetch model registry from http://localhost:7234/v1/proxy/model-registry: Error: network down.",
    '{"stigmer_timing":"execution_setup","execution_id":"run_1"}',
    "[outputs] skipped door-report.md: upload refused (413)",
    "ExecuteDeepAgent failed (actionable): execution=run_1, error=boom",
  ].join("\n");
  assert.deepEqual(runnerLogNotes(log), [
    "[outputs] skipped door-report.md: upload refused (413)",
    "ExecuteDeepAgent failed (actionable): execution=run_1, error=boom",
  ]);
  assert.deepEqual(runnerLogNotes(log, { last: 1 }), ["ExecuteDeepAgent failed (actionable): execution=run_1, error=boom"]);
  assert.deepEqual(runnerLogNotes(""), []);
});

/** The invoice example's lines, by SKU, from one of its sample CSVs. */
function linesOf(name) {
  const [, ...rows] = readFileSync(new URL(`../../../examples/invoice-match/${name}`, import.meta.url), "utf8").trim().split("\n");
  return new Map(rows.map((row) => {
    const [sku, , quantity, price] = row.split(",");
    return [sku, { quantity: Number(quantity), price: Number(price) }];
  }));
}

test("the walk's fake gives the invoice example's true answer, in the file its instructions name", () => {
  const instructions = readFileSync(new URL("../../../examples/invoice-match/invoice-matcher.yaml", import.meta.url), "utf8");
  assert.match(instructions, new RegExp(`Hand back the result as a file named ${DOOR_FILE.replace(".", "\\.")}`));
  // The agent's rule, recomputed from the samples: what the invoice charges beyond what the order agreed.
  const invoice = linesOf("invoice-4471.csv");
  const order = linesOf("po-2210.csv");
  const atStake = [...new Set([...invoice.keys(), ...order.keys()])]
    .map((sku) => {
      const billed = invoice.get(sku);
      const agreed = order.get(sku);
      const charged = billed === undefined ? 0 : billed.quantity * billed.price;
      const owed = billed === undefined || agreed === undefined ? 0 : Math.min(billed.quantity, agreed.quantity) * agreed.price;
      return { sku, amount: charged - owed, differs: JSON.stringify(billed) !== JSON.stringify(agreed) };
    })
    .filter((line) => line.differs)
    .sort((a, b) => b.amount - a.amount);
  const rows = DOOR_REPORT.split("\n").filter((line) => /^\| [A-Z]{3}-\d+ \|/.test(line));
  assert.deepEqual(
    rows.map((row) => { const cells = row.split("|").map((cell) => cell.trim()); return { sku: cells[1], amount: Number(cells[4]) }; }),
    atStake.map(({ sku, amount }) => ({ sku, amount })),
  );
  const total = atStake.reduce((sum, line) => sum + line.amount, 0).toFixed(2);
  assert.match(DOOR_REPORT, new RegExp(`^Total at stake: ${total}$`, "m"));
  for (const { sku } of atStake) assert.match(DOOR_REPLY, new RegExp(sku));
  assert.match(DOOR_REPLY, new RegExp(total.replace(".", "\\.")));
});
