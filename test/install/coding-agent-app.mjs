#!/usr/bin/env node

/**
 * The app walk: a person's one-line ask to their coding agent, with
 * Stigmer's plugin installed, ends with their Stigmer agent working inside
 * their own app for one of its signed-in customers, as that customer. Two
 * apps, two stacks, two shapes of the job (lib/coding-agent-app.mjs, APPS):
 *   - `ledgerly-nextjs`: the coding-agent door's Next.js invoicing app
 *     (lib/scratch-apps.mjs). The ask: "Let our signed-in customers chat
 *     with our invoice-checker agent on the invoices page."
 *   - `statements-fastapi`: a FastAPI app with an upload route. The ask:
 *     "When a signed-in customer uploads a statement, run our
 *     statement-checker agent on it as that customer and show them the
 *     report it makes."
 *
 * It needs a coding agent on a real model, so it is in no gate lane: by
 * hand (`make walk-coding-agent-app APP=<app>`). The coding-agent door
 * (coding-agent-door.mjs) proves the console's setup prompt; this proves the
 * plugin on the job that comes after setup, in each stack.
 *
 * The stage is lib/hermetic-stage.mjs, as the door's and the question
 * bank's: a server that signs its callers in through test/support's
 * hermetic issuer, Temporal, a runner on the fake model, and the `stigmer`
 * shim. Before the coding agent starts, the walk does what the person did
 * at setup: the CLI is signed in (its first caller, so the organization's
 * admin) and the app's agent is applied. The fake model answers that
 * agent's every run alike: it saves the app's report as `report.md` in its
 * outputs folder, then answers the app's reply (APPS, appScript).
 *
 * The coding agent is Claude Code (`claude -p`, stream-json kept) with the
 * plugin as a release builds it (coding-agents/dist/plugin, `--plugin-dir`),
 * given the ask alone, with the tools a person allows, answered "go ahead"
 * when it stops, up to `--max-turns`. The plugin reads Stigmer's docs from
 * the live site, as it does for a person.
 *
 * The FastAPI app's virtual environment is made by the walk with the app's
 * requirements and this checkout's Python stubs and SDK, before the coding
 * agent starts and again before the app does (the coding agent may install
 * `stigmer-sdk` from PyPI over it, which can predate what the docs show).
 * The Next.js app gets this checkout's packed @stigmer packages before the
 * browser step, as the door's does.
 *
 * Pass when:
 *   - the service account's key is in the app's env file, which git
 *     ignores, and in no file git would take and no line of the stream;
 *   - Ledgerly: a route mints a token reading the app's own session
 *     (`getSession`), a page renders the chat, and a browser that signs
 *     Dana in through the app's stand-in sends a message on that page and
 *     gets the agent's reply;
 *   - Statements: an HTTP client that signs Dana in and uploads a statement
 *     gets back the report's first line;
 *   - in both, the conversation is Dana's own: a token minted for Dana's id
 *     in the app (`user-dana`, the app's session) lists one more
 *     conversation after the walk's use of the app than before it (the
 *     coding agent may have tried the app as Dana). A conversation is
 *     private to whoever started it, so a route that minted for anyone
 *     else, or a run on the service account's key, leaves Dana's list as it
 *     was.
 *
 * Usage: lib/coding-agent-app.mjs, USAGE (`--help` prints it).
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { APPS, USAGE, agentManifest, appScript, filesHoldingKey, parseAppArgs, reportLine } from "./lib/coding-agent-app.mjs";
import { freePort, runClaude, runnerLogNotes, stopProcessGroup, streamDigest } from "./lib/coding-agent-door.mjs";
import { isTitleCall } from "./lib/fake-model.mjs";
import { stageBuildPaths, startHermeticStage } from "./lib/hermetic-stage.mjs";
import { writeLedgerly, writeStatements } from "./lib/scratch-apps.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const pluginDir = join(repoRoot, "coding-agents", "dist", "plugin");
const AUDIENCE = "https://app-walk.stigmer.test/api";
const NATIVE_CLIENT = "stigmer-app-walk";
const ANSWER = "Yes, go ahead with what you suggest. Keep going until it works in the app.";
/** The customer the walk signs in through the app's stand-in sign-in, and the id each app's session gives them. */
const CUSTOMER = "dana";
const CUSTOMER_ID = `user-${CUSTOMER}`;
/** The tools a person working on each stack allows beside the door's. */
const STACK_TOOLS = {
  "ledgerly-nextjs": [],
  "statements-fastapi": ["Bash(python *)", "Bash(python3 *)", "Bash(pip *)", "Bash(.venv/bin/*)", "Bash(uvicorn *)"],
};
const PLUGIN_TOOLS = ["Skill", "mcp__plugin_stigmer_stigmer"];

function log(step) {
  process.stdout.write(`coding-agent-app: ${step}\n`);
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** A `stigmer` command through the stage's shim, asynchronously: the issuer and the fake model live in this process. */
function stigmer(shim, env, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(shim, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (status) => (status === 0 ? resolve(output) : reject(new Error(`\`stigmer ${args.join(" ")}\` exited ${status}:\n${output}`))));
  });
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.name === "node_modules" || entry.name === ".venv" || entry.name === ".next" || entry.name === ".git"
      ? []
      : entry.isDirectory()
        ? filesUnder(join(dir, entry.name)).map((f) => join(entry.name, f))
        : [entry.name],
  );
}

/** The FastAPI app's virtual environment: its requirements, then this checkout's stubs and SDK. */
function installPythonDeps(appDir) {
  const python = join(appDir, ".venv", "bin", "python");
  if (!existsSync(python)) execFileSync("python3", ["-m", "venv", join(appDir, ".venv")], { stdio: "inherit" });
  const pip = (...args) => execFileSync(python, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", ...args], { cwd: appDir, stdio: "inherit" });
  pip("-r", "requirements.txt");
  pip(join(repoRoot, "apis", "stubs", "python", "stigmer"), join(repoRoot, "sdk", "python"));
}

/** Waits until `url` answers, up to `seconds`. */
async function waitFor(url, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await fetch(url, { redirect: "manual" }).then(() => true).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${url} never answered`);
}

/** The env file holding STIGMER_API_KEY and the key, after checking git ignores it and nothing else holds the key. */
function checkKey(appDir, streamPath) {
  const envFile = [".env.local", ".env"].map((f) => join(appDir, f)).find((p) => existsSync(p) && readFileSync(p, "utf8").includes("STIGMER_API_KEY="));
  check(envFile !== undefined, "no env file holds STIGMER_API_KEY");
  const key = /STIGMER_API_KEY=["']?([^\s"']+)/.exec(readFileSync(envFile, "utf8"))?.[1] ?? "";
  check(key.length > 8, `the key in ${envFile} is empty`);
  check(spawnSync("git", ["check-ignore", "-q", envFile], { cwd: appDir }).status === 0, `${envFile} is not git-ignored`);
  check(!readFileSync(streamPath, "utf8").includes(key), "the key appears in the coding agent's stream");
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: appDir, encoding: "utf8" }).split("\n").filter((f) => f !== "");
  const holding = filesHoldingKey(listed, (path) => (existsSync(join(appDir, path)) ? readFileSync(join(appDir, path), "utf8") : undefined), key);
  check(holding.length === 0, `the key is in files git would take: ${holding.join(", ")}`);
  return { envFile, key };
}

/** How many conversations Dana's own token lists: minted with the app's key for the id the app's session gives Dana. */
async function customersConversations(serverUrl, key) {
  const { createNodeClient } = await import(pathToFileURL(join(repoRoot, "sdk", "typescript", "dist", "node.js")).href);
  const admin = createNodeClient({ baseUrl: serverUrl, apiKey: key });
  const org = (await admin.organization.listMine({})).entries[0]?.metadata?.slug;
  check(org !== undefined, "the app's key reaches no organization");
  const { accessToken } = await admin.tokens.mintUserToken({ org, userId: CUSTOMER_ID });
  const customer = createNodeClient({ baseUrl: serverUrl, getAccessToken: () => accessToken });
  return (await customer.session.list({ org })).entries ?? [];
}

async function main() {
  const args = parseAppArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const app = APPS[args.app];
  for (const [what, path] of [...stageBuildPaths(), ["plugin", join(pluginDir, ".claude-plugin", "plugin.json")]]) {
    check(existsSync(path), `${what} not built: ${path} (make build-server build-runner build-libs; npm run build -w @stigmer/coding-agent-plugin)`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-app-walk-"));
  const appDir = join(scratch, args.app);
  const npmPrefix = join(scratch, "npm-global");
  const streamPath = join(scratch, "stream.jsonl");
  for (const dir of [appDir, npmPrefix]) mkdirSync(dir, { recursive: true });
  log(`scratch=${scratch}`);

  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  let stage;
  let server;
  let passed = false;
  try {
    stage = await startHermeticStage({ scratch, audience: AUDIENCE, nativeClientId: NATIVE_CLIENT, replyText: app.reply });
    for (const entry of appScript(args.app, { isTitleCall, anthropicText, anthropicToolUse })) stage.fake.enqueue(entry);
    log(`a server that signs its callers in is serving on ${stage.server.baseUrl}, its runner on the fake model`);

    // What the person did at setup: the CLI signed in, the agent applied.
    const cliEnv = stage.env(process.env);
    await stigmer(stage.stigmer, cliEnv, ["config", "backend", "add", "walk", "--endpoint", new URL(stage.server.baseUrl).host]);
    await stigmer(stage.stigmer, cliEnv, ["config", "backend", "use", "walk"]);
    await stigmer(stage.stigmer, cliEnv, ["auth", "login"]);
    const manifest = join(scratch, `${app.agent}.yaml`);
    writeFileSync(manifest, agentManifest(args.app));
    await stigmer(stage.stigmer, cliEnv, ["apply", "-f", manifest]);
    log(`the CLI is signed in as the organization's admin, and ${app.agent} is applied`);

    if (args.app === "ledgerly-nextjs") writeLedgerly(appDir);
    else {
      writeStatements(appDir);
      installPythonDeps(appDir);
    }

    const env = { ...stage.env(process.env, [join(npmPrefix, "bin")]), npm_config_prefix: npmPrefix };
    const sessionId = randomUUID();
    log(`claude -p in ${appDir} on ${args.model} with the plugin: ${app.ask}`);
    const extra = { pluginDir, allowedTools: [...PLUGIN_TOOLS, ...STACK_TOOLS[args.app]] };
    let turn = await runClaude(appDir, env, sessionId, app.ask, true, streamPath, stop.signal, args, extra);
    // Done when the app holds the key: the last thing the job needs. Until
    // then, a stop is a question or a pause, and the walk says go ahead.
    const keyed = () => [".env.local", ".env"].some((f) => existsSync(join(appDir, f)) && readFileSync(join(appDir, f), "utf8").includes("STIGMER_API_KEY="));
    for (let i = 0; i < args.maxTurns && !keyed(); i++) {
      log(`the coding agent stopped (${turn.result.slice(-160).replace(/\n/g, " ")}); answering`);
      turn = await runClaude(appDir, env, sessionId, ANSWER, false, streamPath, stop.signal, args, extra);
    }
    log(`the coding agent's last word: ${turn.result.slice(0, 300).replace(/\n/g, " ")}`);
    // An indicator, outside the pass: whether the coding agent loaded the job's skill.
    log(`the stigmer-integrate skill ${/"skill":"[^"]*stigmer-integrate"/.test(readFileSync(streamPath, "utf8")) ? "loaded" : "did not load"}`);

    const { key } = checkKey(appDir, streamPath);
    // Dana's conversations before the walk's own use of the app: the coding
    // agent may have tried the app as Dana itself.
    const before = (await customersConversations(stage.server.baseUrl, key)).length;
    const sources = filesUnder(appDir);
    const port = await freePort();
    const appUrl = `http://localhost:${port}`;
    if (args.app === "ledgerly-nextjs") {
      const route = sources.find((f) => /route\.ts$/.test(f) && readFileSync(join(appDir, f), "utf8").includes("mintUserToken"));
      check(route !== undefined, "no route mints a user token");
      check(/getSession/.test(readFileSync(join(appDir, route), "utf8")), `${route} does not read the app's own session (getSession)`);
      const chatPage = sources.find((f) => f.endsWith("page.tsx") && /AgentChat/.test(readFileSync(join(appDir, f), "utf8")));
      check(chatPage !== undefined, "no page renders the agent's chat");
      log(`the key in the git-ignored env file alone; ${route} mints for the session's user; the chat on ${chatPage}`);

      const packDir = join(scratch, "packs");
      execFileSync(process.execPath, [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", "0.0.0-walk", "--pack-dir", packDir, "--only", "@stigmer/react-sdk", "--skip-build"], { cwd: repoRoot, stdio: "inherit" });
      const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz")).map((f) => join(packDir, f));
      execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir, stdio: "inherit", env: { ...env, npm_config_prefix: undefined } });
      server = spawn("npx", ["next", "dev", "-p", String(port)], { cwd: appDir, env: { ...process.env, PORT: String(port) }, stdio: "ignore", detached: true });
      await waitFor(appUrl, 180);
      const { chromium } = createRequire(join(repoRoot, "package.json"))("playwright");
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${appUrl}/login?user=${CUSTOMER}`);
        await page.goto(`${appUrl}/${chatPage.replace(/^app\//, "").replace(/(^|\/)page\.tsx$/, "").replace(/\([^)]*\)\/?/g, "")}`);
        const box = page.getByRole("textbox").first();
        await box.waitFor({ timeout: 60_000 });
        await box.fill("Can you check this month's invoices?");
        await box.press("Enter");
        await page.getByText(app.reply).first().waitFor({ timeout: 120_000 });
      } finally {
        await browser.close();
      }
      log(`a browser signed ${CUSTOMER} in through the app, sent a message on the page, and the agent answered`);
    } else {
      check(sources.some((f) => f.endsWith(".py") && /from stigmer|import stigmer/.test(readFileSync(join(appDir, f), "utf8"))), "no Python file uses the Stigmer SDK");
      installPythonDeps(appDir);
      server = spawn(join(appDir, ".venv", "bin", "uvicorn"), ["app.main:app", "--env-file", ".env", "--port", String(port)], { cwd: appDir, env: { ...process.env }, stdio: ["ignore", "ignore", "pipe"], detached: true });
      let serverErr = "";
      server.stderr.setEncoding("utf8").on("data", (chunk) => (serverErr = (serverErr + chunk).slice(-4000)));
      await waitFor(`${appUrl}/statements`, 60);
      const login = await fetch(`${appUrl}/login?user=${CUSTOMER}`, { redirect: "manual" });
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      check(cookie.startsWith("statements_user="), `the app's sign-in set no cookie (${login.status})`);
      const form = new FormData();
      form.append("file", new Blob(["date,description,amount\n2026-11-03,CARD 4411,-42.00\n2026-11-03,CARD 4411,-42.00\n2026-11-05,TRANSFER,-900.00\n"], { type: "text/csv" }), "november.csv");
      const upload = await fetch(`${appUrl}/statements`, { method: "POST", body: form, headers: { cookie } });
      const body = await upload.text();
      check(upload.ok, `the upload answered ${upload.status}: ${body.slice(0, 300)}\n${serverErr}`);
      check(body.includes(reportLine(args.app)), `the upload's answer does not show the report's first line:\n${body.slice(0, 600)}\n${serverErr}`);
      log(`an HTTP client signed ${CUSTOMER} in, uploaded a statement, and got the report back`);
    }

    const after = (await customersConversations(stage.server.baseUrl, key)).length;
    check(after > before, `${CUSTOMER}'s own token lists ${after} conversation(s), as before the walk used the app: the run was not ${CUSTOMER}'s`);
    log(`${CUSTOMER}'s own token lists ${after - before} new conversation(s): the run was ${CUSTOMER}'s`);
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
    await stopProcessGroup(server);
    await stage?.stop();
    if (!args.keep) rmSync(scratch, { recursive: true, force: true });
    else log(`kept ${scratch}`);
  }
}

main().catch((error) => {
  process.stderr.write(`coding-agent-app: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
