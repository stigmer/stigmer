/**
 * What every coding-agent walk shares (test/install/coding-agent-build.mjs,
 * test/install/coding-agent-operate.mjs): a person's one-line ask to Claude
 * Code with Stigmer's plugin installed, on the hermetic stage
 * (lib/hermetic-stage.mjs) seeded with the question bank's fixture
 * (lib/bank-fixture.mjs), in a project folder holding the fixture agents'
 * manifests, then the server read back and judged.
 *
 * A walk names its ask, how it reads the server and how it judges what it
 * read; runWalk does the rest: the stage, the fixture, the project, the
 * turns (the ask, then "go ahead with the changes I asked for" each time
 * the coding agent stops before the state is right, up to `--max-turns`),
 * the digest of a failed try, and the teardown. The answer is a yes to what
 * was asked and to nothing else, so a coding agent that proposes more than
 * the ask (a routine switched on, a key with a wider role) is never told to
 * go ahead with it.
 *
 * The flags every walk takes are parsed here too (parseWalkArgs), each
 * walk giving its own usage text.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { anthropicText, anthropicToolUse } from "../../support/src/llm-wire.ts";
import { seedFixture, writeProjectManifests } from "./bank-fixture.mjs";
import { fixtureScript } from "./coding-agent-bank.mjs";
import { runClaude, runnerLogNotes, streamDigest } from "./coding-agent-door.mjs";
import { isTitleCall } from "./fake-model.mjs";
import { stageBuildPaths, startHermeticStage } from "./hermetic-stage.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
/** The plugin as a release builds it. */
export const PLUGIN_DIR = join(repoRoot, "coding-agents", "dist", "plugin");
/** The walk's answer at a stop: a yes to what was asked, and to nothing else. */
export const ANSWER = "Yes, go ahead with the changes I asked for.";
const PLUGIN_TOOLS = ["Skill", "mcp__plugin_stigmer_stigmer"];

/** The flags every walk takes, parsed; throws naming the flag on anything it does not know, with `usage`. */
export function parseWalkArgs(argv, usage) {
  const args = { model: "claude-sonnet-5-5", maxBudgetUsd: undefined, claudeMaxTurns: undefined, maxTurns: 2, keep: false, help: false };
  for (const arg of argv) {
    const [flag, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const number = () => {
      const n = Number(value);
      if (value === undefined || value === "" || !Number.isFinite(n) || n <= 0) throw new Error(`${flag} must be a positive number (got ${JSON.stringify(value)})`);
      return n;
    };
    if (flag === "--help" || flag === "-h") args.help = true;
    else if (flag === "--keep") args.keep = true;
    else if (flag === "--model") args.model = value ?? "";
    else if (flag === "--max-budget-usd") args.maxBudgetUsd = number();
    else if (flag === "--claude-max-turns") args.claudeMaxTurns = Math.floor(number());
    else if (flag === "--max-turns") args.maxTurns = Math.floor(number());
    else throw new Error(`unknown flag ${JSON.stringify(arg)}\n\n${usage}`);
  }
  return args;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A `stigmer` command through the stage's shim, asynchronously: the issuer and the fake model live in this process. */
export function stigmer(shim, env, args, { mayFail = false } = {}) {
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

/** A read through the stage's CLI with `--output json`; undefined when it fails (a resource that is gone). */
export async function readJson(shim, env, args) {
  const { status, stdout } = await stigmer(shim, env, [...args, "--output", "json"], { mayFail: true });
  if (status !== 0) return undefined;
  return JSON.parse(stdout);
}

/**
 * The TypeScript SDK on the token the stage's CLI signed in with (the
 * hermetic issuer's; read from the CLI's config, never printed), with the
 * organization it reaches, for what the CLI does not read. Made after a CLI
 * call, which refreshes the token when it is near its end.
 */
export async function sdkSession(cliHome) {
  const config = readFileSync(join(cliHome, ".stigmer", "config.yaml"), "utf8");
  const token = /^\s+token:\s*["']?([^\s"']+)/m.exec(config)?.[1];
  const endpoint = /^\s+endpoint:\s*["']?([^\s"']+)/m.exec(config)?.[1];
  check(token !== undefined && endpoint !== undefined, "the stage's CLI holds no sign-in to read with");
  const { createNodeClient } = await import(pathToFileURL(join(repoRoot, "sdk", "typescript", "dist", "node.js")).href);
  const client = createNodeClient({ baseUrl: `http://${endpoint}`, getAccessToken: () => token });
  const org = (await client.organization.listMine({})).entries[0]?.metadata;
  check(org?.slug !== undefined, "the stage's CLI reaches no organization");
  return { client, org: { slug: org.slug, id: org.id } };
}

/**
 * Runs one walk.
 * @param {{
 *   name: string,
 *   ask: string,
 *   skill: string,
 *   audience: string,
 *   nativeClientId: string,
 *   args: ReturnType<typeof parseWalkArgs>,
 *   readState: (stage: { shim: string, env: NodeJS.ProcessEnv, cliHome: string, projectDir: string, streamPath: string }) => Promise<unknown>,
 *   checkBefore?: (before: unknown) => string[],
 *   judge: (before: unknown, now: unknown) => string[],
 *   passed: string,
 * }} walk
 */
export async function runWalk(walk) {
  const { name, args } = walk;
  const log = (step) => process.stdout.write(`${name}: ${step}\n`);
  for (const [what, path] of [...stageBuildPaths(), ["plugin", join(PLUGIN_DIR, ".claude-plugin", "plugin.json")]]) {
    check(existsSync(path), `${what} not built: ${path} (make build-server build-runner build-libs; npm run build -w @stigmer/coding-agent-plugin)`);
  }
  const scratch = mkdtempSync(join(tmpdir(), `stigmer-${name}-`));
  const projectDir = join(scratch, "project");
  const streamPath = join(scratch, "stream.jsonl");
  mkdirSync(projectDir, { recursive: true });
  log(`scratch=${scratch}`);

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  let stage;
  let passed = false;
  try {
    stage = await startHermeticStage({ scratch, audience: walk.audience, nativeClientId: walk.nativeClientId });
    for (const entry of fixtureScript({ isTitleCall, anthropicText, anthropicToolUse })) stage.fake.enqueue(entry);
    log(`a server that signs its callers in is serving on ${stage.server.baseUrl}, its runner on the fake model`);
    const env = stage.env(process.env);
    await seedFixture({ stigmer: stage.stigmer, env, serverUrl: stage.server.baseUrl, log });
    const written = writeProjectManifests(projectDir);
    log(`the project holds ${written.join(", ")}, as a person who set up has them`);

    const read = () => walk.readState({ shim: stage.stigmer, env: stage.env(process.env), cliHome: stage.cliHome, projectDir, streamPath });
    const before = await read();
    const wrongBefore = walk.checkBefore?.(before) ?? [];
    check(wrongBefore.length === 0, `the stage was not as the walk starts from:\n  - ${wrongBefore.join("\n  - ")}`);

    const sessionId = randomUUID();
    log(`claude -p in ${projectDir} on ${args.model} with the plugin: ${walk.ask}`);
    const extra = { pluginDir: PLUGIN_DIR, allowedTools: PLUGIN_TOOLS };
    let turn = await runClaude(projectDir, env, sessionId, walk.ask, true, streamPath, stop.signal, args, extra);
    // Done when the server holds what was asked. Until then, a stop is a
    // question or a pause, and the walk says go ahead with the ask alone.
    let failed = walk.judge(before, await read());
    for (let i = 0; i < args.maxTurns && failed.length > 0; i++) {
      log(`the coding agent stopped (${turn.result.slice(-160).replace(/\n/g, " ")}); answering`);
      turn = await runClaude(projectDir, env, sessionId, ANSWER, false, streamPath, stop.signal, args, extra);
      failed = walk.judge(before, await read());
    }
    log(`the coding agent's last word: ${turn.result.slice(0, 300).replace(/\n/g, " ")}`);
    // An indicator, outside the pass: whether the coding agent loaded the job's skill.
    const loaded = new RegExp(`"skill":"[^"]*${walk.skill}"`).test(readFileSync(streamPath, "utf8"));
    log(`the ${walk.skill} skill ${loaded ? "loaded" : "did not load"}`);
    check(failed.length === 0, `the server does not hold what was asked:\n  - ${failed.join("\n  - ")}`);
    log(walk.passed);
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
}

/** Runs `main`, printing `<name>: FAILED` and the error, and exiting 1, when it throws. */
export function runMain(name, main) {
  main().catch((error) => {
    process.stderr.write(`${name}: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exit(1);
  });
}
