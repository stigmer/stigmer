#!/usr/bin/env node

/**
 * The build walk: a person's one-line ask to their coding agent, with
 * Stigmer's plugin installed, changes an agent they already have, and the
 * server afterwards holds what was asked and nothing more. The ask
 * (lib/coding-agent-build.mjs, BUILD): "Make invoice-checker check our
 * invoices every Monday at 9 Berlin time, and give it pdfplumber in its
 * sandbox."
 *
 * The question bank grades answers and traces; no grader reads the server
 * after a try. This walk does, so it proves the plugin builds: a routine
 * and an Environment made the way the docs show, the agent changed from its
 * live definition rather than rewritten, and the routine left off, since
 * switching it on spends the Organization's model keys and no one asked.
 *
 * It needs a coding agent on a real model, so it is in no gate lane: by
 * hand (`make walk-coding-agent-build`). The stage is lib/hermetic-stage.mjs
 * with the question bank's fixture seeded (lib/bank-fixture.mjs): the CLI
 * signed in as the organization's admin, the vendor-aliases skill pushed,
 * invoice-checker and reconciler applied and run once. The project folder
 * holds what a person who set up holds, the agents' manifests under
 * `stigmer/`. The coding agent is Claude Code (`claude -p`, stream-json
 * kept) with the plugin as a release builds it (coding-agents/dist/plugin,
 * `--plugin-dir`), given the ask alone, answered "go ahead with the changes
 * I asked for" when it stops before the state is right, up to `--max-turns`.
 * The plugin reads Stigmer's docs from the live site, as it does for a
 * person.
 *
 * The stage's server starts no sandboxes, so the Environment is stored, not
 * used: the walk reads that it exists and that the agent names it.
 *
 * Pass when lib/coding-agent-build.mjs's judgeBuild finds nothing wrong in
 * what the stage's CLI reads back (`--output json`): one routine names
 * invoice-checker, with Mondays at 9 in Europe/Berlin, not switched on and
 * never started; invoice-checker names an Environment that lists
 * pdfplumber among its pip packages; invoice-checker's instructions, skills
 * and tool limits are what they were before the coding agent started.
 *
 * Usage: lib/coding-agent-build.mjs, USAGE (`--help` prints it).
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { listedSlugs, seedFixture, writeProjectManifests } from "./lib/bank-fixture.mjs";
import { fixtureScript } from "./lib/coding-agent-bank.mjs";
import { BUILD, USAGE, judgeBuild, parseBuildArgs } from "./lib/coding-agent-build.mjs";
import { runClaude, runnerLogNotes, streamDigest } from "./lib/coding-agent-door.mjs";
import { isTitleCall } from "./lib/fake-model.mjs";
import { stageBuildPaths, startHermeticStage } from "./lib/hermetic-stage.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginDir = join(repoRoot, "coding-agents", "dist", "plugin");
const AUDIENCE = "https://build-walk.stigmer.test/api";
const NATIVE_CLIENT = "stigmer-build-walk";
/** The walk's answer at a stop: a yes to what was asked, and to nothing else. */
const ANSWER = "Yes, go ahead with the changes I asked for.";
const PLUGIN_TOOLS = ["Skill", "mcp__plugin_stigmer_stigmer"];

function log(step) {
  process.stdout.write(`coding-agent-build: ${step}\n`);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A `stigmer` command through the stage's shim, asynchronously: the issuer and the fake model live in this process. */
function stigmer(shim, env, args, { mayFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(shim, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0 || mayFail) resolve({ status, stdout });
      else reject(new Error(`\`stigmer ${args.join(" ")}\` exited ${status}:\n${stdout}${stderr}`));
    });
  });
}

async function readJson(shim, env, args) {
  const { status, stdout } = await stigmer(shim, env, [...args, "--output", "json"], { mayFail: true });
  if (status !== 0) return undefined;
  return JSON.parse(stdout);
}

/** What the server holds now: the agent, every routine with its fires, every Environment. */
async function readState(shim, env) {
  const agent = await readJson(shim, env, ["get", "agent", BUILD.agent]);
  const routines = [];
  for (const slug of listedSlugs(JSON.stringify((await readJson(shim, env, ["list", "routines"])) ?? []))) {
    const routine = await readJson(shim, env, ["get", "routine", slug]);
    const fires = await readJson(shim, env, ["routine", "fires", slug]);
    const fired = Array.isArray(fires) ? fires.length : Array.isArray(fires?.entries) ? fires.entries.length : Array.isArray(fires?.fires) ? fires.fires.length : 0;
    if (routine !== undefined) routines.push({ routine, fires: fired });
  }
  const environments = [];
  for (const slug of listedSlugs(JSON.stringify((await readJson(shim, env, ["list", "environments"])) ?? []))) {
    const environment = await readJson(shim, env, ["get", "environment", slug]);
    if (environment !== undefined) environments.push(environment);
  }
  return { agent, routines, environments };
}

async function main() {
  const args = parseBuildArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  for (const [what, path] of [...stageBuildPaths(), ["plugin", join(pluginDir, ".claude-plugin", "plugin.json")]]) {
    check(existsSync(path), `${what} not built: ${path} (make build-server build-runner build-libs; npm run build -w @stigmer/coding-agent-plugin)`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-build-walk-"));
  const projectDir = join(scratch, "project");
  const streamPath = join(scratch, "stream.jsonl");
  mkdirSync(projectDir, { recursive: true });
  log(`scratch=${scratch}`);

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  let stage;
  let passed = false;
  try {
    stage = await startHermeticStage({ scratch, audience: AUDIENCE, nativeClientId: NATIVE_CLIENT });
    for (const entry of fixtureScript({ isTitleCall, anthropicText, anthropicToolUse })) stage.fake.enqueue(entry);
    log(`a server that signs its callers in is serving on ${stage.server.baseUrl}, its runner on the fake model`);
    const env = stage.env(process.env);
    await seedFixture({ stigmer: stage.stigmer, env, serverUrl: stage.server.baseUrl, log });
    const written = writeProjectManifests(projectDir);
    log(`the project holds ${written.join(", ")}, as a person who set up has them`);

    const before = await readState(stage.stigmer, env);
    check(before.agent !== undefined, `${BUILD.agent} was not seeded`);
    check(before.routines.length === 0 && before.environments.length === 0, "the stage held a routine or an Environment before the walk");

    const sessionId = randomUUID();
    log(`claude -p in ${projectDir} on ${args.model} with the plugin: ${BUILD.ask}`);
    const extra = { pluginDir, allowedTools: PLUGIN_TOOLS };
    let turn = await runClaude(projectDir, env, sessionId, BUILD.ask, true, streamPath, stop.signal, args, extra);
    // Done when the server holds what was asked. Until then, a stop is a
    // question or a pause, and the walk says go ahead with the ask alone.
    let failed = judgeBuild(await stateFor(before.agent));
    for (let i = 0; i < args.maxTurns && failed.length > 0; i++) {
      log(`the coding agent stopped (${turn.result.slice(-160).replace(/\n/g, " ")}); answering`);
      turn = await runClaude(projectDir, env, sessionId, ANSWER, false, streamPath, stop.signal, args, extra);
      failed = judgeBuild(await stateFor(before.agent));
    }
    log(`the coding agent's last word: ${turn.result.slice(0, 300).replace(/\n/g, " ")}`);
    // An indicator, outside the pass: whether the coding agent loaded the job's skill.
    log(`the stigmer-build skill ${/"skill":"[^"]*stigmer-build"/.test(readFileSync(streamPath, "utf8")) ? "loaded" : "did not load"}`);
    check(failed.length === 0, `the server does not hold what was asked:\n  - ${failed.join("\n  - ")}`);
    log(`one routine on ${BUILD.agent}, Mondays at 9 ${BUILD.timeZone}, off and never started; its Environment lists ${BUILD.pipPackage}; its instructions, skills and tool limits as they were`);
    log("passed");
    passed = true;
  } finally {
    if (!passed && existsSync(streamPath)) {
      for (const line of streamDigest(readFileSync(streamPath, "utf8"))) log(line);
    }
    const runnerLog = join(scratch, "runner.log");
    if (!passed && existsSync(runnerLog)) {
      for (const line of runnerLogNotes(readFileSync(runnerLog, "utf8"))) log(`runner: ${line}`);
    }
    // A coding agent that started `stigmer up` on its own (it keeps its stack
    // under the stage's CLI home) leaves it running past the walk.
    if (stage !== undefined) await stigmer(stage.stigmer, stage.env(process.env), ["down"], { mayFail: true }).catch(() => undefined);
    await stage?.stop();
    if (!args.keep) rmSync(scratch, { recursive: true, force: true });
    else log(`kept ${scratch}`);
  }

  async function stateFor(agentBefore) {
    const now = await readState(stage.stigmer, stage.env(process.env));
    return { agentBefore, agentAfter: now.agent, routines: now.routines, environments: now.environments };
  }
}

main().catch((error) => {
  process.stderr.write(`coding-agent-build: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
