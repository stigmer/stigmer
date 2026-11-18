// Pins the coding-agent question bank's pure parts (coding-agent-bank.mjs)
// and the two pieces it added to the hermetic stage: the shim's sandbox
// handling (hermetic-stage.mjs, stageShim) and the preload that carries the
// CLI's HTTP/2 calls through a sandbox's proxy (loopback-through-proxy.mjs),
// the latter end to end through a CONNECT proxy and an HTTP/2 server started
// here. No model and no Stigmer stack: the bank's run itself is by hand
// (`make bank-coding-agent`). Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http2 from "node:http2";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTS_TAG,
  DEFAULT_MODEL,
  FIXTURE,
  INVOICE_REPORT,
  JOBS,
  TOOL_GRANTS,
  carriesToolResult,
  evalArgs,
  fixtureScript,
  frontmatterTags,
  isWithOnlyGrader,
  globMatches,
  jobOf,
  parseBankArgs,
  readBankCases,
  renderSpread,
  renderSummary,
  selectCases,
  spreadBetween,
  summarizeResult,
  tracePlan,
  tryReading,
} from "./coding-agent-bank.mjs";
import { FIXTURE_DIR, listedSlugs, PROJECT_MANIFESTS, writeProjectManifests } from "./bank-fixture.mjs";
import { SANDBOX_HOME, stageShim } from "./hermetic-stage.mjs";
import { connectRequest, isLoopback, proxyFromEnv } from "./loopback-through-proxy.mjs";

const preload = fileURLToPath(new URL("./loopback-through-proxy.mjs", import.meta.url));

test("the flags default to three tries on the pinned model under the ceiling, and refuse what they do not know", () => {
  const args = parseBankArgs([]);
  assert.equal(args.runs, 3);
  assert.equal(args.model, DEFAULT_MODEL);
  assert.equal(args.maxCostUsd, 60);
  assert.equal(args.concurrency, 1);
  assert.deepEqual(args.tags, []);
  const set = parseBankArgs(["--tag=run-fix", "--tag=acts", "--case=*reconciler*", "--runs=1", "--model=claude-opus-5-5", "--judge-model=claude-sonnet-5-5", "--max-cost-usd=2.5", "--with-only", "--compare=a/summary.json", "--keep"]);
  assert.deepEqual(set.tags, ["run-fix", "acts"]);
  assert.equal(set.caseGlob, "*reconciler*");
  assert.equal(set.runs, 1);
  assert.equal(set.maxCostUsd, 2.5);
  assert.equal(set.withOnly, true);
  assert.equal(set.compare, "a/summary.json");
  assert.throws(() => parseBankArgs(["--tag=nonsense"]), /--tag must be one of/);
  assert.throws(() => parseBankArgs(["--runs=0"]), /--runs must be a positive whole number/);
  assert.throws(() => parseBankArgs(["--runs=1.5"]), /--runs must be a positive whole number/);
  assert.throws(() => parseBankArgs(["--concurrency=9"]), /at most 8/);
  assert.throws(() => parseBankArgs(["--model"]), /--model needs a value/);
  assert.throws(() => parseBankArgs(["--deep"]), /unknown flag "--deep"/);
});

test("the eval command grants the shell, the web, the plugin's tools, the fixture's loopback and the docs, and passes the filters", () => {
  const args = parseBankArgs(["--tag=admin", "--case=delete-*", "--runs=2"]);
  const argv = evalArgs(args, { pluginDir: "/s/plugin", resultPath: "/o/result.json", outputDir: "/o", reportPath: "/o/report.html" });
  assert.deepEqual(argv.slice(0, 3), ["plugin", "eval", "/s/plugin"]);
  for (const flag of ["--trust-plugin", "--scaffold", "--allow-real-servers", "--no-publish"]) assert.ok(argv.includes(flag), flag);
  const grants = argv.slice(argv.indexOf("--allow-tools") + 1, argv.indexOf("--model"));
  assert.deepEqual(grants, TOOL_GRANTS);
  assert.ok(grants.includes("WebFetch(domain:127.0.0.1)"), "without the loopback grant the sandbox's proxy refuses the CLI");
  assert.ok(grants.includes("WebFetch(domain:localhost)"), "without it the proxy refuses a download from the stage's file server, whose links name localhost");
  assert.ok(grants.includes("WebFetch(domain:stigmer.ai)"), "without it the proxy refuses a shell read of the docs' pages");
  assert.ok(grants.includes("mcp__plugin_stigmer_stigmer__*"));
  const after = (flag) => argv[argv.indexOf(flag) + 1];
  assert.equal(after("--judge-model"), DEFAULT_MODEL);
  assert.equal(after("--runs"), "2");
  assert.equal(after("--ablation"), "with-without");
  assert.ok(argv.includes("--keep-temp"), "each try's trace is kept for the run's output");
  assert.ok(!argv.includes("--tag") && !argv.includes("--case"), "the selection is the staged cases, never the runner's own glob");
  assert.equal(after("--json"), "/o/result.json");
  assert.equal(evalArgs(parseBankArgs(["--with-only"]), { pluginDir: "p", resultPath: "r", outputDir: "o", reportPath: "h" })[evalArgs(parseBankArgs(["--with-only"]), { pluginDir: "p", resultPath: "r", outputDir: "o", reportPath: "h" }).indexOf("--ablation") + 1], "none");
});

test("cases are read from <job>/<case>/prompt.md with their tags, the fixture left out, and selected as the runner filters them", () => {
  const dir = mkdtempSync(join(tmpdir(), "bank-cases-"));
  try {
    const write = (path, text) => {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    write("run-fix/why-reconciler-failed/prompt.md", "---\ntags: [run-fix, acts]\nmax_turns: 30\n---\n\nWhy?\n");
    write("deciding/who-pays/prompt.md", "---\ntags: [deciding]\n---\n\nWho pays?\n");
    write("deciding/who-pays/graders/criteria.md", "---\ntype: llm\n---\nPASS if it says who.\n");
    write("deciding/who-pays/graders/skill-fired.md", "---\ntype: tool_used\ntool: Skill\narm: with-only\n---\n");
    write("_fixture/agents/a.yaml", "kind: Agent\n");
    write("deciding/notes.md", "not a case\n");
    const cases = readBankCases(dir);
    assert.deepEqual(cases, [
      { name: "who-pays", job: "deciding", dir: "deciding/who-pays", tags: ["deciding"], indicators: ["skill-fired"] },
      { name: "why-reconciler-failed", job: "run-fix", dir: "run-fix/why-reconciler-failed", tags: ["run-fix", "acts"], indicators: [] },
    ]);
    assert.deepEqual(selectCases(cases, { tags: [ACTS_TAG] }).map((c) => c.name), ["why-reconciler-failed"]);
    assert.deepEqual(selectCases(cases, { caseGlob: "who-*" }).map((c) => c.name), ["who-pays"]);
    assert.equal(selectCases(cases).length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(frontmatterTags("---\ntags: ['admin', \"acts\"]\n---\nbody"), ["admin", "acts"]);
  assert.deepEqual(frontmatterTags("no frontmatter"), []);
  assert.ok(isWithOnlyGrader("---\ntype: tool_used\narm: \"with-only\"\n---\n"));
  assert.ok(!isWithOnlyGrader("---\ntype: llm\n---\narm: with-only is not frontmatter\n"));
  assert.ok(globMatches("*key*", "ci-key-least-privilege"));
  assert.ok(!globMatches("key", "ci-key"));
  assert.ok(globMatches("a.b", "a.b") && !globMatches("a.b", "axb"), "a dot is a dot");
  assert.ok(globMatches("{who-pays,why-*-failed}", "why-reconciler-run-failed"));
  assert.ok(globMatches("{who-pays,why-*-failed}", "who-pays"));
  assert.ok(!globMatches("{who-pays,why-*-failed}", "who-pays-more"));
});

test("the fixture's script answers every try alike: the invoice agent saves its report then ends, the reconciler is refused for credit", () => {
  const isTitleCall = (request) => JSON.stringify(request.body?.system ?? "").includes("session title generator");
  const anthropicText = (text) => ({ text });
  const anthropicToolUse = (id, name, input) => ({ id, name, input });
  const script = fixtureScript({ isTitleCall, anthropicText, anthropicToolUse });
  assert.ok(script.every((entry) => entry.repeat === true), "every answer stands for every try");
  const answer = (body) => script.find((entry) => entry.matches({ body }));
  const invoiceFirst = { system: `You check a month's ${FIXTURE.invoiceMark}.`, messages: [{ role: "user", content: "Check March." }] };
  const invoiceAfter = { ...invoiceFirst, messages: [...invoiceFirst.messages, { role: "user", content: [{ type: "tool_result", tool_use_id: "t" }] }] };
  assert.equal(answer(invoiceFirst).body.name, "write_file");
  assert.equal(answer(invoiceFirst).body.input.file_path, `/.stigmer/outputs/${FIXTURE.invoiceFile}`);
  assert.ok(answer(invoiceFirst).body.input.content.startsWith(FIXTURE.invoiceFirstLine));
  assert.match(answer(invoiceAfter).body.text, /INV-2307/);
  const reconciler = answer({ system: `You ${FIXTURE.reconcilerMark}.`, messages: [] });
  assert.equal(reconciler.kind, "error");
  assert.equal(reconciler.status, 400);
  assert.match(reconciler.body.error.message, /credit balance is too low/);
  assert.equal(answer({ system: "You are a session title generator.", messages: [] }).body.text, "Agent run");
  assert.equal(answer({ system: "Some agent a case made.", messages: [] }), undefined, "any other agent gets the fake's default reply");
  assert.ok(carriesToolResult({ body: invoiceAfter }) && !carriesToolResult({ body: invoiceFirst }));
  assert.ok(INVOICE_REPORT.startsWith(`${FIXTURE.invoiceFirstLine}\n`));
});

/** A result shaped like `claude plugin eval --json`'s, two jobs, two cases each. */
function result({ reachPasses = true } = {}) {
  const tryOf = (passed, fired = true) => ({ passed, score: passed ? 1 : 0.5, error: null, graders: [{ name: "skill-fired", passed: fired, withOnly: true }] });
  const kase = (dir, withRuns, withoutRuns) => ({ name: dir.split("/").at(-1), dir: `evals/${dir}`, arms: { with: withRuns, without: withoutRuns } });
  return {
    costUsd: 1.234,
    durationSeconds: 600,
    partial: false,
    suite: { modelOverride: DEFAULT_MODEL },
    cases: [
      kase("reach/slack", [tryOf(reachPasses), tryOf(true)], [tryOf(false, false), tryOf(false, false)]),
      kase("deciding/who-pays", [tryOf(true), tryOf(true)], [tryOf(true, false), tryOf(true, false)]),
      kase("deciding/open-source", [tryOf(true), tryOf(false, false)], [tryOf(false, false), tryOf(false, false)]),
      kase("reach/schedule", [tryOf(true), tryOf(true)], [tryOf(true, false), tryOf(false, false)]),
    ],
  };
}

test("the summary counts a case passed only when every try passed, per job in the jobs' order, with the skill-fired rate apart", () => {
  const summary = summarizeResult(result({ reachPasses: false }));
  assert.deepEqual(summary.jobs.map((row) => row.job), ["deciding", "reach"], "JOBS' order, not the result's");
  const [deciding, reach] = summary.jobs;
  assert.equal(deciding.cases, 2);
  assert.equal(deciding.with.passed, 1);
  assert.equal(deciding.without.passed, 1);
  assert.equal(deciding.with.mean, 0.875);
  assert.equal(deciding.skillFired, 0.75);
  assert.deepEqual(deciding.failingWith, ["open-source"]);
  assert.equal(reach.with.passed, 1, "a case with one failed try of two does not pass");
  assert.equal(reach.without.passed, 0);
  assert.equal(jobOf({ dir: "evals/admin/x" }), "admin");
  assert.equal(jobOf({ dir: "x" }), "unknown");
  const table = renderSummary(summary);
  assert.match(table, /\| deciding \| 2 \| 1\/2 \(0\.88\) \| 1\/2 \(0\.75\) \| 75% \|/);
  assert.match(table, /\| \*\*all\*\* \| 4 \| 2\/4 \| 1\/4 \|/);
  assert.match(table, /\$1\.23 API-equivalent, 10 min/);
  assert.ok(JOBS.length === 10 && JOBS.includes("own-server"));
});

test("a try that never ran is left out of every score, counted with its most common error, and makes the reading invalid", () => {
  const limit = "exit 1: You've hit your 5-hour limit · resets 11:30pm";
  const clean = (passed) => ({ passed, score: passed ? 1 : 0, error: null, graders: [] });
  const refused = () => ({ passed: false, score: 0, error: limit, graders: [] });
  const summary = summarizeResult({
    cases: [
      { name: "who-pays", dir: "evals/deciding/who-pays", arms: { with: [clean(true), clean(true)], without: [clean(false), clean(true)] } },
      { name: "open-source", dir: "evals/deciding/open-source", arms: { with: [clean(true), refused()], without: [refused(), refused()] } },
      { name: "slack", dir: "evals/reach/slack", arms: { with: [refused(), refused()], without: [{ ...clean(false), error: "trace unreadable" }, clean(false)] } },
    ],
  });
  assert.equal(summary.valid, false);
  assert.equal(summary.erroredTries, 6);
  assert.deepEqual(summary.commonError, { error: limit, tries: 5 });
  const [deciding, reach] = summary.jobs;
  assert.deepEqual(deciding.with, { passed: 1, read: 1, mean: 1 }, "the errored case is no failure and no pass");
  assert.deepEqual(deciding.without, { passed: 0, read: 1, mean: 0.5 });
  assert.equal(deciding.erroredTries, 3);
  assert.deepEqual(deciding.failingWith, []);
  assert.deepEqual(reach.with, { passed: 0, read: 0, mean: undefined });
  const table = renderSummary(summary);
  assert.match(table, /\| deciding \| 2 \| 1\/1 \(1\.00, 1 of 2 read\) \| 0\/1 \(0\.50, 1 of 2 read\) \| – \| 3 \|/);
  assert.match(table, /\| reach \| 1 \| no reading \(0 of 1 read\) \| no reading \(0 of 1 read\) \|/);
  assert.match(table, /\| \*\*all\*\* \| 3 \| 1\/1 \(1 of 3 read\) \| 0\/1 \(1 of 3 read\) \| \| 6 \|/);
  assert.match(table, /NOT A VALID READING: 6 tries errored .* Most common error \(5 tries\): exit 1: You've hit your 5-hour limit/);
  assert.equal(spreadBetween(summary, summary)[0].spread, undefined, "a job not read whole has no spread");
  assert.doesNotMatch(renderSummary(summarizeResult(result())), /NOT A VALID READING/);
  assert.equal(summarizeResult(result()).valid, true);
});

test("the skill-fired indicator stays out of the score in every ablation mode, read from the bank when the result does not mark it", () => {
  // Under --ablation none, Claude Code reports a with-only grader as scored and not with-only.
  const grader = (name, passed, extra = {}) => ({ name, passed, weight: 1, withOnly: false, scored: true, ...extra });
  const run = { passed: false, score: 1 / 3, error: null, graders: [grader("cites-the-page", false), grader("criteria", false), grader("skill-fired", true)] };
  const cases = [{ name: "who-pays", dir: "evals/deciding/who-pays", arms: { with: [run] } }];
  assert.equal(summarizeResult({ cases }).jobs[0].with.mean, 1 / 3, "unmarked, it counts");
  const read = summarizeResult({ cases }, { indicators: new Map([["deciding/who-pays", ["skill-fired"]]]) }).jobs[0];
  assert.equal(read.with.mean, 0);
  assert.equal(read.skillFired, 1);
  assert.deepEqual(tryReading(run, new Set(["skill-fired"])), { score: 0, passed: false });
  const allClean = { ...run, graders: [grader("cites-the-page", true), grader("criteria", true, { weight: 3 }), grader("skill-fired", false)] };
  assert.deepEqual(tryReading(allClean, new Set(["skill-fired"])), { score: 1, passed: true }, "a miss of the indicator alone never fails a try");
  assert.deepEqual(tryReading({ ...run, graders: [grader("criteria", true, { weight: 3 }), grader("cites-the-page", false)] }), { score: 0.75, passed: false });
  // Under --ablation with-without the result marks it; the bank's list is not needed.
  const marked = { ...run, graders: [grader("criteria", true), grader("skill-fired", false, { withOnly: true, scored: false })] };
  assert.deepEqual(tryReading(marked), { score: 1, passed: true });
});

test("every try's trace is planned into traces/<job>/<case>/<arm>-<n>.jsonl, its kept folder beside it", () => {
  const plan = tracePlan({
    cases: [
      {
        name: "who-pays",
        dir: "evals/deciding/who-pays",
        arms: { with: [{ tracePath: "/tmp/e-A/out/trace.jsonl" }, { tracePath: null }], without: [{ tracePath: "/tmp/e-B/out/trace.jsonl" }] },
      },
    ],
  });
  assert.deepEqual(plan, [
    { from: "/tmp/e-A/out/trace.jsonl", to: "traces/deciding/who-pays/with-1.jsonl", keptDir: "/tmp/e-A" },
    { from: "/tmp/e-B/out/trace.jsonl", to: "traces/deciding/who-pays/without-1.jsonl", keptDir: "/tmp/e-B" },
  ]);
});

test("the fixture's restore reads a list's slugs, whichever shape the answer has", () => {
  assert.deepEqual(listedSlugs('[{"metadata":{"slug":"ci-runner"}},{"slug":"nightly"}]'), ["ci-runner", "nightly"]);
  assert.deepEqual(listedSlugs('{"entries":[{"metadata":{"name":"ci-runner"}}]}'), ["ci-runner"]);
  assert.deepEqual(listedSlugs('{"items":[{"name":"x"},{}]}'), ["x"]);
  assert.deepEqual(listedSlugs("No service accounts"), []);
});

test("an acting try's folder holds the fixture agents' manifests where a person who set up keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "bank-project-"));
  try {
    const written = writeProjectManifests(dir);
    assert.deepEqual(written, [join(PROJECT_MANIFESTS, "invoice-checker.yaml"), join(PROJECT_MANIFESTS, "reconciler.yaml")]);
    for (const path of written) {
      assert.equal(readFileSync(join(dir, path), "utf8"), readFileSync(join(FIXTURE_DIR, "agents", path.slice(PROJECT_MANIFESTS.length + 1)), "utf8"));
    }
    assert.deepEqual(writeProjectManifests(dir), written, "a second try in the same folder writes them again");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two with-plugin readings are compared per job, and a spread of more than one case is noisy", () => {
  const first = { jobs: [{ job: "deciding", with: { passed: 5 } }, { job: "reach", with: { passed: 2 } }] };
  const second = { jobs: [{ job: "deciding", with: { passed: 3 } }, { job: "reach", with: { passed: 3 } }] };
  const rows = spreadBetween(first, second);
  assert.deepEqual(rows, [
    { job: "deciding", first: 5, second: 3, spread: 2, noisy: true },
    { job: "reach", first: 2, second: 3, spread: 1, noisy: false },
  ]);
  assert.match(renderSpread(rows), /\| deciding \| 5 \| 3 \| 2 \(noisy\) \|/);
});

/** Runs the shim with `env`, its CLI a script that prints where it ran and what it was given. */
function runShim(shimDir, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(join(shimDir, "stigmer"), ["auth", "whoami"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, out }));
  });
}

test("the shim runs the CLI in the stage's home, or in a copy under the caller's when it cannot write there, with the proxy turned on only when one is named", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bank-shim-"));
  try {
    const cliHome = join(dir, "home");
    mkdirSync(join(cliHome, ".stigmer"), { recursive: true });
    writeFileSync(join(cliHome, ".stigmer", "config.yaml"), "signed-in: yes\n");
    const cli = join(dir, "fake-cli.sh");
    writeFileSync(cli, '#!/bin/sh\necho "home=$HOME args=$* key=${ANTHROPIC_API_KEY:-none} envproxy=${NODE_USE_ENV_PROXY:-off} noproxy=${NO_PROXY-unset} options=$NODE_OPTIONS"\ncat "$HOME/.stigmer/config.yaml"\n');
    chmodSync(cli, 0o755);
    writeFileSync(join(dir, "stigmer"), stageShim({ cliHome, follower: join(dir, "browser.mjs"), preload, node: process.execPath, cliCommand: `'${cli}'` }));
    chmodSync(join(dir, "stigmer"), 0o755);
    const base = { PATH: process.env.PATH, ANTHROPIC_API_KEY: "the-coding-agent's-own" };

    const direct = await runShim(dir, { ...base, HOME: join(dir, "caller") });
    assert.equal(direct.status, 0, direct.out);
    assert.match(direct.out, new RegExp(`home=${cliHome} args=auth whoami key=none envproxy=off`));
    assert.match(direct.out, /--import=file:\/\/.*loopback-through-proxy\.mjs/);
    assert.match(direct.out, /signed-in: yes/);

    // Where the stage's home is read-only (as in claude plugin eval's sandbox), the sign-in is copied into the caller's home, once.
    chmodSync(join(cliHome, ".stigmer"), 0o555);
    chmodSync(cliHome, 0o555);
    const callerHome = join(dir, "caller");
    mkdirSync(callerHome, { recursive: true });
    const proxied = await runShim(dir, { ...base, HOME: callerHome, HTTPS_PROXY: "http://u:p@127.0.0.1:9", NO_PROXY: "localhost,127.0.0.1" });
    assert.equal(proxied.status, 0, proxied.out);
    assert.match(proxied.out, new RegExp(`home=${join(callerHome, SANDBOX_HOME)} `));
    assert.match(proxied.out, /envproxy=1 noproxy= /);
    assert.match(proxied.out, /signed-in: yes/);
    assert.equal(readFileSync(join(callerHome, SANDBOX_HOME, ".stigmer", "config.yaml"), "utf8"), "signed-in: yes\n");
    writeFileSync(join(callerHome, SANDBOX_HOME, ".stigmer", "token-refresh"), "refreshed\n");
    writeFileSync(join(callerHome, SANDBOX_HOME, ".stigmer", "config.yaml"), "refreshed\n");
    assert.match((await runShim(dir, { ...base, HOME: callerHome })).out, /refreshed/, "a later call keeps the copy's own changes");
  } finally {
    chmodSync(join(dir, "home"), 0o755);
    chmodSync(join(dir, "home", ".stigmer"), 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
  assert.throws(() => stageShim({ cliHome: "/it's", follower: "/f", preload: "/p", node: "/n", cliCommand: "x" }), /single quote/);
});

test("the preload knows a proxy, a loopback host and how to ask for a tunnel", () => {
  assert.equal(proxyFromEnv({}), undefined);
  assert.equal(proxyFromEnv({ HTTPS_PROXY: "socks5h://x:1" }), undefined, "only an HTTP proxy can CONNECT");
  assert.equal(proxyFromEnv({ http_proxy: "http://127.0.0.1:3128" })?.port, "3128");
  for (const host of ["127.0.0.1", "127.9.0.4", "localhost", "[::1]"]) assert.ok(isLoopback(host), host);
  for (const host of ["10.0.0.1", "stigmer.ai", "127.0.0.1.example"]) assert.ok(!isLoopback(host), host);
  const request = connectRequest("127.0.0.1:7234", new URL("http://srt.user:p%40ss@127.0.0.1:9"));
  assert.match(request, /^CONNECT 127\.0\.0\.1:7234 HTTP\/1\.1\r\nHost: 127\.0\.0\.1:7234\r\n/);
  assert.match(request, new RegExp(`Proxy-Authorization: Basic ${Buffer.from("srt.user:p@ss").toString("base64")}`));
  assert.ok(request.endsWith("\r\n\r\n"));
  assert.ok(!connectRequest("h:1", new URL("http://127.0.0.1:9")).includes("Proxy-Authorization"));
});

/** A CONNECT proxy that tunnels to any address and counts its tunnels. */
async function startConnectProxy() {
  const tunnels = [];
  const server = net.createServer((client) => {
    client.once("data", (head) => {
      const [, target] = /^CONNECT (\S+) HTTP/.exec(head.toString("latin1")) ?? [];
      const [host, port] = target.split(":");
      tunnels.push(target);
      const upstream = net.connect(Number(port), host, () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        client.pipe(upstream).pipe(client);
      });
      upstream.on("error", () => client.destroy());
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://u:p@127.0.0.1:${server.address().port}`, tunnels, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("a process that loads the preload reaches a loopback HTTP/2 server through the proxy, and exits once its session is idle", async () => {
  const h2 = http2.createServer((request, response) => response.end("through the tunnel"));
  await new Promise((resolve) => h2.listen(0, "127.0.0.1", resolve));
  const proxy = await startConnectProxy();
  try {
    const client = `
      import http2 from "node:http2";
      const session = http2.connect("http://127.0.0.1:${h2.address().port}");
      const request = session.request({ ":path": "/" });
      let body = "";
      request.setEncoding("utf8").on("data", (chunk) => (body += chunk));
      // Like connect-node, the session is unref'd once idle and never closed: the process must still exit.
      request.on("end", () => { console.log(body); session.unref(); });
      request.end();
    `;
    const started = Date.now();
    const { status, out } = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [`--import=${new URL("./loopback-through-proxy.mjs", import.meta.url).href}`, "--input-type=module", "-e", client], {
        env: { ...process.env, HTTPS_PROXY: proxy.url },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (chunk) => (text += chunk));
      child.stderr.on("data", (chunk) => (text += chunk));
      const timer = setTimeout(() => child.kill(), 15_000);
      child.once("error", reject);
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({ status: code, out: text });
      });
    });
    assert.equal(status, 0, out);
    assert.match(out, /through the tunnel/);
    assert.ok(Date.now() - started < 10_000, "the idle session kept the process alive");
    assert.deepEqual(proxy.tunnels, [`127.0.0.1:${h2.address().port}`]);
  } finally {
    await proxy.close();
    await new Promise((resolve) => h2.close(resolve));
  }
});
