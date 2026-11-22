#!/usr/bin/env node

/**
 * The coding-agent question bank, run: the questions and jobs a developer
 * brings to their coding agent about Stigmer (coding-agents/evals/, one
 * folder per case, grouped by job), asked of Claude Code twice, with
 * Stigmer's plugin and without it, through `claude plugin eval`; and the
 * score per job, both ways.
 *
 * It calls a real model on the person's own Claude Code sign-in, so it is in
 * no gate lane: by hand (`make bank-coding-agent`). What it rests on is held
 * in the gate: the bank's shape and its docs pages by
 * coding-agents/__tests__/bank.test.ts, this runner's pure parts by
 * lib/coding-agent-bank.test.mjs, the stage by the coding-agent door.
 *
 * The world every case meets, both arms alike:
 *   - lib/hermetic-stage.mjs: a server that signs its callers in through
 *     test/support's hermetic issuer, Temporal, a runner on test/support's
 *     fake model, and a `stigmer` shim first on PATH. The CLI behind it is
 *     this checkout's, packed as a release packs it
 *     (scripts/publish-libs.mjs) and installed beside the shim, since
 *     `claude plugin eval` runs a coding agent's shell commands in a sandbox
 *     that reads only the directories on PATH and never the system's
 *     temporary folders: the stage lives in one folder under
 *     ~/.cache/stigmer-coding-agent-bank/, removed at the end;
 *   - the fixture (coding-agents/evals/_fixture/), seeded through that CLI
 *     once per run, signed in as the organization's admin: the
 *     vendor-aliases skill; invoice-checker, with one finished run whose
 *     saved report starts with a known line; reconciler, whose runs the
 *     model provider refuses for want of credit (lib/bank-fixture.mjs). The
 *     fake model answers their runs the same way every time
 *     (lib/coding-agent-bank.mjs, fixtureScript), so the fixture costs
 *     nothing; and every acting case's scaffold puts back, before each try,
 *     whatever an earlier try deleted or changed (`stigmer-bank-fixture`,
 *     on the stage's PATH).
 * The plugin is the tree a release publishes: the CLI's pack carries
 * @stigmer/coding-agent-plugin beside it (the CLI depends on it, and
 * publish-libs --only packs the closure), stamped with the pack's version,
 * and the stage's node_modules/@stigmer/coding-agent-plugin/plugin/ is
 * exactly the folder the reconcile lane copies from the npm tarball into
 * stigmer/coding-agent-plugin. It is copied from there, with the bank as its
 * evals/, into the stage's folder, since `claude plugin eval` reads cases
 * only below the plugin and the bank is not published with it. Its MCP server is the real `stigmer mcp-server`
 * (`--allow-real-servers`), started through the same shim. A person's own
 * settings, plugins and Stigmer config are never read: `claude plugin eval`
 * runs each try with a scratch home, and the shim keeps the CLI's config in
 * the stage.
 *
 * The run's output (`--out`, by default coding-agents/.bank-results/<time>/)
 * holds Claude Code's result and report, every try's trace under traces/
 * (what a reader needs to tell a skill that did not fire from one that did
 * not know), and the per-job summary. A try Claude Code could not run (a
 * usage limit, a crash) is no reading: the summary counts it and names the
 * most common error, leaves its case unread, and the run exits non-zero.
 *
 * Usage: lib/coding-agent-bank.mjs, USAGE (`--help` prints it).
 * Needs `claude` signed in, and `make build-libs build-server build-runner`
 * with the coding-agent plugin built (`npm run build -w
 * @stigmer/coding-agent-plugin`; the Makefile target does both).
 */

import { execFileSync, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { RESTORE_COMMAND, seedFixture } from "./lib/bank-fixture.mjs";
import {
  BANK_REPLY,
  USAGE,
  evalArgs,
  fixtureScript,
  parseBankArgs,
  readBankCases,
  renderSpread,
  renderSummary,
  selectCases,
  spreadBetween,
  summarizeResult,
  tracePlan,
} from "./lib/coding-agent-bank.mjs";
import { isTitleCall } from "./lib/fake-model.mjs";
import { stageBuildPaths, startHermeticStage } from "./lib/hermetic-stage.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const evalsDir = join(repoRoot, "coding-agents", "evals");
const fixtureLib = fileURLToPath(new URL("./lib/bank-fixture.mjs", import.meta.url));
/** The plugin's build, which the CLI's pack reads (the package is published from dist/). */
const builtPlugin = join(repoRoot, "coding-agents", "dist", "plugin");
const AUDIENCE = "https://bank.stigmer.test/api";
const NATIVE_CLIENT = "stigmer-bank";
const PACK_VERSION = "0.0.0-bank";

function log(step) {
  process.stdout.write(`coding-agent-bank: ${step}\n`);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * One command, asynchronous: the issuer and the fake model live in this
 * process, so its event loop must keep answering while the command runs.
 */
function run(command, args, { env, cwd, stdio = "pipe", signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, cwd, signal, stdio: stdio === "pipe" ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}


/**
 * This checkout's CLI, packed as a release packs it and installed into
 * `dir`; returns the shim's command for it and the packed plugin's folder.
 */
function installPackedCli(dir, packDir) {
  log("packing this checkout's CLI");
  execFileSync(process.execPath, [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", PACK_VERSION, "--pack-dir", packDir, "--only", "@stigmer/cli", "--skip-build"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "bank-cli", private: true }));
  const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz")).map((f) => join(packDir, f));
  log(`installing it (${tarballs.length} packages) into the stage`);
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...tarballs], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_API_KEY: undefined },
  });
  const manifest = JSON.parse(readFileSync(join(dir, "node_modules", "@stigmer", "cli", "package.json"), "utf8"));
  const entry = join(dir, "node_modules", "@stigmer", "cli", manifest.bin.stigmer);
  check(existsSync(entry), `the installed CLI has no entry at ${entry}`);
  const packedPlugin = join(dir, "node_modules", "@stigmer", "coding-agent-plugin", "plugin");
  const stamped = JSON.parse(readFileSync(join(packedPlugin, ".claude-plugin", "plugin.json"), "utf8")).version;
  check(stamped === PACK_VERSION, `the packed plugin is stamped ${stamped}, not the pack's ${PACK_VERSION}`);
  return { cliCommand: `'${process.execPath}' '${entry}'`, packedPlugin };
}

/** The packed plugin, with the selected cases as its evals/ (the fixture and every other case left out). */
function stagePlugin(dir, packedPlugin, selected) {
  cpSync(packedPlugin, dir, { recursive: true });
  for (const c of selected) cpSync(join(evalsDir, c.dir), join(dir, "evals", c.dir), { recursive: true });
}

/**
 * Each try's trace, copied into the run's output (`traces/`), and each kept
 * try folder removed: `claude plugin eval --keep-temp` seals what the plugin
 * wrote there (mode 000), so the folder is opened before it is removed.
 */
function collectTraces(result, out) {
  let copied = 0;
  for (const { from, to, keptDir } of tracePlan(result)) {
    try {
      chmodTree(keptDir);
      mkdirSync(dirname(join(out, to)), { recursive: true });
      cpSync(from, join(out, to));
      copied += 1;
    } catch (error) {
      log(`no trace for ${to}: ${error instanceof Error ? error.message : String(error)}`);
    }
    rmSync(keptDir, { recursive: true, force: true });
  }
  return copied;
}

/** Opens a kept try folder and everything in it for its owner, so it can be read and removed. */
function chmodTree(dir) {
  if (!existsSync(dir)) return;
  chmodSync(dir, 0o700);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !entry.isSymbolicLink()) chmodTree(path);
  }
}

async function main() {
  const args = parseBankArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  for (const [what, path] of [...stageBuildPaths(), ["plugin", builtPlugin]]) {
    check(existsSync(path), `${what} not built: ${path} (make build-libs build-server build-runner; npm run build -w @stigmer/coding-agent-plugin)`);
  }
  const selected = selectCases(readBankCases(evalsDir), { tags: args.tags, caseGlob: args.caseGlob });
  check(selected.length > 0, "no case in the bank matches the --tag/--case given");
  log(`${selected.length} cases selected, ${args.runs} tries each${args.withOnly ? ", with the plugin only" : ", with the plugin and without it"}, on ${args.model}`);

  const out = args.out ?? join(repoRoot, "coding-agents", ".bank-results", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(out, { recursive: true });
  const cacheDir = join(homedir(), ".cache", "stigmer-coding-agent-bank");
  mkdirSync(cacheDir, { recursive: true });
  const root = mkdtempSync(join(cacheDir, "run-"));
  log(`stage=${root} out=${out}`);

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  let stage;
  try {
    const binDir = join(root, "bin");
    const { cliCommand, packedPlugin } = installPackedCli(join(binDir, "cli"), join(root, "packs"));
    const pluginDir = join(root, "plugin");
    stagePlugin(pluginDir, packedPlugin, selected);
    log(`the plugin is the pack's (${PACK_VERSION}), as a release publishes it`);
    stage = await startHermeticStage({
      scratch: root,
      audience: AUDIENCE,
      nativeClientId: NATIVE_CLIENT,
      replyText: BANK_REPLY,
      cliCommand,
      binDir,
      cliHome: join(binDir, "home"),
    });
    for (const script of fixtureScript({ isTitleCall, anthropicText, anthropicToolUse })) stage.fake.enqueue(script);
    log(`a server that signs its callers in is serving on ${stage.server.baseUrl}, its runner on the fake model`);
    await seedFixture({ stigmer: stage.stigmer, env: stage.env(), serverUrl: stage.server.baseUrl, log });
    // Each acting case's scaffold calls it before every try, outside the sandbox, to put back what an earlier try changed.
    const restore = join(binDir, RESTORE_COMMAND);
    writeFileSync(restore, `#!/bin/sh\nexec '${process.execPath}' '${fixtureLib}' --restore "$@"\n`);
    chmodSync(restore, 0o755);

    // The shim first, then this Node, which the sandbox must be able to read to run the CLI.
    const env = stage.env(process.env, [dirname(process.execPath)]);
    // Claude Code's own key, when it signs in by one, is its alone: the shim drops it before the CLI.
    if (process.env.ANTHROPIC_API_KEY !== undefined) env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    const resultPath = join(out, "result.json");
    const claudeArgs = evalArgs(args, { pluginDir, resultPath, outputDir: out, reportPath: join(out, "report.html") });
    log(`claude ${claudeArgs.join(" ")}`);
    // Stopped by hand (Ctrl-C, a kill), the eval is stopped too and the stage still comes down.
    const evaluation = await run("claude", claudeArgs, { env, cwd: root, stdio: "inherit", signal: stop.signal });
    // 0: every case passed; 1: a case fell below the threshold (the usual reading); 2: the cost ceiling stopped it.
    check([0, 1, 2].includes(evaluation.status ?? -1), `claude plugin eval exited ${evaluation.status}`);
    check(existsSync(resultPath), `claude plugin eval wrote no result at ${resultPath}`);

    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    log(`${collectTraces(result, out)} tries' traces kept in ${join(out, "traces")}`);
    const summary = summarizeResult(result, { indicators: new Map(selected.map((kase) => [kase.dir, kase.indicators])) });
    writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    const table = renderSummary(summary);
    writeFileSync(join(out, "summary.md"), `${table}\n`);
    process.stdout.write(`\n${table}\n`);
    if (args.compare !== undefined) {
      const spread = renderSpread(spreadBetween(JSON.parse(readFileSync(args.compare, "utf8")), summary));
      writeFileSync(join(out, "spread.md"), `${spread}\n`);
      process.stdout.write(`\nWith the plugin, against ${args.compare}:\n${spread}\n`);
    }
    log(`result, report and summary in ${out}`);
    // A try that never ran is no reading; a run holding one is never recorded as a score.
    check(summary.valid, `not a valid reading: ${summary.erroredTries} tries errored${summary.commonError === undefined ? "" : ` (most often: ${summary.commonError.error})`}`);
  } finally {
    await stage?.stop();
    if (args.keep) log(`kept ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`coding-agent-bank: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
