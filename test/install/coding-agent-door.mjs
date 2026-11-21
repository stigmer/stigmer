#!/usr/bin/env node

/**
 * The coding-agent door, end to end: the prompt the console hands a person,
 * pasted into a real coding agent in a clean scratch app, ends with an agent
 * made, run once, and its chat on the app's own page (the UX bar's CLI-18).
 *
 * It needs a coding agent on a real model, so it is in no gate lane: by hand
 * against this checkout (`make door-coding-agent`), and in the live lane
 * after every release against what was published (`--published`, below).
 * What it rests on is held in the gate by the CLI's own suites (the
 * commands, the guide's drift test, the sign-in smoke).
 *
 * The stage is lib/hermetic-stage.mjs, the one the coding-agent question
 * bank meets Stigmer on too, all on this machine and hermetic on Stigmer's
 * side:
 *   - test/support's hermetic issuer, and a server from the built shipped
 *     entry that signs its callers in through it and announces a native
 *     client (so `stigmer auth login` finds it), with Temporal and a runner
 *     whose model is test/support's fake (lib/fake-model.mjs): the agent's
 *     first run saves the invoice example's true answer as the file its
 *     instructions name, and every later turn (the chat in the app) answers
 *     in the same words (lib/coding-agent-door.mjs, DOOR_REPORT and
 *     DOOR_REPLY), not the shared fake's "no real model was called";
 *   - the CLI from this checkout (the published one with `--published`)
 *     behind a `stigmer` on PATH that runs it with
 *     a scratch HOME (its config lives under HOME, with no other override)
 *     and a stand-in `BROWSER` that follows the authorize address, so the
 *     issuer's auto-consent finishes the sign-in; npm's global prefix is a
 *     scratch folder too, so an install the coding agent makes lands there;
 *   - a scratch Next.js app with its own stand-in sign-in (a cookie read by
 *     `getSession()` in lib/session.ts), committed to a fresh git repository.
 *
 * The coding agent is Claude Code (`claude -p`, stream-json kept): given
 * exactly the console's prompt (the shared words plus "Use the Stigmer at
 * <address>."), with its tools granted as a person would allow them, and
 * answered "yes, go ahead" whenever it stops to ask, up to a bound. Its own
 * sign-in and settings are the person's; nothing of their Stigmer config is
 * read or written, and the user-level settings and MCP servers are left out
 * (`--setting-sources project`, `--strict-mcp-config`).
 *
 * Pass when: the CLI signed in (the scratch config keeps the issuer); a
 * manifest is under stigmer/ and its agent exists on the server; one run's
 * file is in stigmer-output/, which .gitignore names; the env file holds
 * STIGMER_API_KEY and no line of the stream shows it; the token route and
 * the chat are in the app, the route reading the app's own session; and a
 * browser signs in through the app's stand-in, opens the page, sends a
 * message and gets DOOR_REPLY in the chat. Without `--published`, the
 * app's Stigmer packages are the ones packed from this checkout (the
 * registry's may predate the handover), installed before the browser step.
 *
 * With `--local`, the server trusts every caller, as `stigmer up` does: the
 * guide skips signing in, the key and the service account, and hands over the
 * development chat alone. Pass then needs no sign-in, no key and no route;
 * the manifest, the run's file and the chat answering on the page are the
 * same.
 *
 * With `--published --version=<v>`, the door is walked against what a
 * release put out, the way a person on a fresh machine meets it (the live
 * lane runs it after every release, .github/workflows/ci.live.yaml):
 *   - the prompt is read from the page a person copies it from
 *     (lib/coding-agent-door.mjs, PROMPT_PAGE), and a page that does not
 *     carry it fails the walk; this checkout's copy is never used;
 *   - the `stigmer` on PATH runs @stigmer/cli at <v>, installed from npm into
 *     the scratch folder with its coding-agent plugin, and both must be at
 *     <v>; the scratch app's .npmrc routes @stigmer to the same registry, so
 *     what the coding agent installs comes from there too;
 *   - the app's Stigmer packages, installed before the browser step, are
 *     the registry's at <v>, every one checked.
 * `--registry=<url>` names where @stigmer/* is read (npm's public registry
 * by default; a dev build lives in Stigmer's own), and every npm read names
 * it on its command line, since a machine's npm config may route the scope
 * elsewhere. The server, runner, issuer and fake model still come from this
 * checkout: the live lane checks out the released tag, so they are the
 * released code.
 *
 * Claude Code runs on the person's own sign-in. Where there is none (CI),
 * DOOR_ANTHROPIC_API_KEY is handed to it as ANTHROPIC_API_KEY, and to it
 * alone: the `stigmer` shim drops it, GitHub Actions' Claude Code strips
 * provider keys from the commands it runs (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB
 * is on there by default), and the stream must never show it. `--model`,
 * `--claude-max-turns` and `--max-budget-usd` pass through to each
 * `claude -p`, so an unattended walk runs on a cheap model under a bound.
 *
 * Usage: lib/coding-agent-door.mjs, USAGE (`--help` prints it).
 * Needs `claude` signed in (or DOOR_ANTHROPIC_API_KEY), and
 * `make build-server build-runner build-libs`.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { DOOR_FILE, DOOR_REPLY, DOOR_REPORT, NPM_REGISTRY, USAGE, fetchPagePrompt, freePort, npmRegistryFlags, parseDoorArgs, runClaude, runnerLogNotes, stopProcessGroup, streamDigest } from "./lib/coding-agent-door.mjs";
import { isTitleCall } from "./lib/fake-model.mjs";
import { stageBuildPaths, startHermeticStage } from "./lib/hermetic-stage.mjs";
import { writeLedgerly } from "./lib/scratch-apps.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const AUDIENCE = "https://door.stigmer.test/api";
const NATIVE_CLIENT = "stigmer-door";
/** The console's prompt, as sdk/react's first question writes it (CODING_AGENT_PROMPT); `--published` reads the live page's instead. */
export const PROMPT =
  "Set up Stigmer for this project. Install its command line (`npm install -g @stigmer/cli`, or `brew install stigmer/tap/stigmer`), run `stigmer coding-agent`, and follow what it prints.";
const ANSWER = "Yes, go ahead with what you suggest. I'm happy with your choices; keep going until the chat is on the page.";


function log(step) {
  process.stdout.write(`coding-agent-door: ${step}\n`);
}

/** The model's script: the first run saves the example's answer (DOOR_REPORT); every turn after it answers DOOR_REPLY. */
function scriptFirstRun(fake) {
  fake.enqueue({ kind: "anthropic", body: anthropicText("First run"), matches: isTitleCall });
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({
    kind: "anthropic",
    matches: turn,
    body: anthropicToolUse("toolu_door", "write_file", {
      file_path: `/.stigmer/outputs/${DOOR_FILE}`,
      content: DOOR_REPORT,
    }),
  });
  fake.enqueue({ kind: "anthropic", body: anthropicText(DOOR_REPLY), matches: turn });
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** The version a package.json under `dir` declares, or undefined when there is none. */
function installedVersion(dir) {
  const path = join(dir, "package.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).version : undefined;
}

/**
 * Every @stigmer/* package npm put in `nodeModules`, nested ones included,
 * as `name@version`, so a walk can say each one is the version it named.
 */
function stigmerPackagesUnder(nodeModules) {
  const scope = join(nodeModules, "@stigmer");
  if (!existsSync(scope)) return [];
  return readdirSync(scope, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(scope, entry.name);
      return [`@stigmer/${entry.name}@${installedVersion(dir)}`, ...stigmerPackagesUnder(join(dir, "node_modules"))];
    });
}

/** Refuses, naming each one, any @stigmer/* package under `nodeModules` that is not at `version`. */
function checkAllAt(nodeModules, version, what) {
  const found = stigmerPackagesUnder(nodeModules);
  check(found.length > 0, `${what}: no @stigmer/* package installed`);
  const off = found.filter((spec) => !spec.endsWith(`@${version}`));
  check(off.length === 0, `${what}: not at ${version}: ${off.join(", ")}`);
  return found;
}

/**
 * The published CLI at `version`, installed from `registry` into its own
 * folder (not npm's global prefix, which the coding agent may install into
 * itself): its path, once it and its coding-agent plugin are both at
 * `version`.
 */
function installPublishedCli(dir, version, registry) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "door-published-cli", private: true }));
  log(`installing @stigmer/cli@${version} from ${registry}`);
  execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...npmRegistryFlags(registry), `@stigmer/cli@${version}`], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, ANTHROPIC_API_KEY: undefined, DOOR_ANTHROPIC_API_KEY: undefined },
  });
  const nodeModules = join(dir, "node_modules");
  const cli = installedVersion(join(nodeModules, "@stigmer", "cli"));
  check(cli === version, `@stigmer/cli is ${cli ?? "missing"}, not ${version}`);
  const plugin = [join(nodeModules, "@stigmer", "coding-agent-plugin"), join(nodeModules, "@stigmer", "cli", "node_modules", "@stigmer", "coding-agent-plugin")]
    .map(installedVersion)
    .find((v) => v !== undefined);
  check(plugin === version, `@stigmer/coding-agent-plugin is ${plugin ?? "missing"} beside @stigmer/cli@${version}, not ${version}`);
  checkAllAt(nodeModules, version, "the published CLI");
  return join(nodeModules, ".bin", "stigmer");
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(dir, entry.name)).map((f) => join(entry.name, f)) : [entry.name],
  );
}

async function main() {
  const args = parseDoorArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  // Read before anything starts, so a page without the prompt leaves nothing to tear down.
  let promptBody = PROMPT;
  if (args.published) {
    promptBody = await fetchPagePrompt();
    log(`the prompt, from the live page${promptBody === PROMPT ? " (the same words as this checkout's)" : " (this checkout's words differ)"}: ${promptBody}`);
  }
  for (const [what, path] of stageBuildPaths()) {
    check(existsSync(path), `${what} not built: ${path} (make build-server build-runner build-libs)`);
  }
  const scratch = mkdtempSync(join(tmpdir(), "stigmer-door-"));
  const appDir = join(scratch, "ledgerly");
  const npmPrefix = join(scratch, "npm-global");
  const streamPath = join(scratch, "stream.jsonl");
  for (const dir of [appDir, npmPrefix]) mkdirSync(dir, { recursive: true });
  log(`scratch=${scratch}`);

  // Stopped by hand (Ctrl-C, a kill), the run still tears its stack down.
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => stop.abort(new Error(`stopped by ${signal}`)));
  // The coding agent reads the runs' replies. The shared fake's words ("no
  // real model was called") read to it as a runner without a model key, and
  // it stopped before the chat, a stop a person on a real server never meets
  // (stigmer/stigmer#3160); so every later turn answers as the example agent
  // would, and the browser waits for those words.
  let stage;
  let app;
  let passed = false;
  try {
    const cliCommand = args.published ? `'${installPublishedCli(join(scratch, "published-cli"), args.version, args.registry)}'` : undefined;
    // The server's and runner's logs are kept with the stream (--keep, and a
    // failed walk's digest names them): a run's side of a failure exists
    // nowhere else after teardown.
    stage = await startHermeticStage({ scratch, audience: AUDIENCE, nativeClientId: NATIVE_CLIENT, local: args.local, replyText: DOOR_REPLY, cliCommand });
    const { fake, server, stigmer } = stage;
    log(`a server that ${args.local ? "trusts every caller" : "signs its callers in"} is serving on ${server.baseUrl}, its runner on the fake model`);
    scriptFirstRun(fake);
    if (args.published) {
      // Before the coding agent spends a token: the guide it will be told to follow must print.
      const guide = spawnSync(stigmer, ["coding-agent"], { encoding: "utf8" });
      const why = (guide.stderr ?? "").split("\n").find((line) => line.trim() !== "") ?? `exit ${guide.status}`;
      check(guide.status === 0, `the published CLI cannot print its guide (\`stigmer coding-agent\` exits ${guide.status}): ${why}`);
      const header = guide.stdout.split("\n")[0];
      check(header.startsWith(`Stigmer CLI ${args.version}:`), `the published CLI's guide does not name ${args.version}: ${header}`);
      log(`the published CLI prints its guide: ${header}`);
    }
    writeLedgerly(appDir, args.published ? `registry=${NPM_REGISTRY}\n@stigmer:registry=${args.registry}\n` : undefined);

    const env = { ...stage.env(process.env, [join(npmPrefix, "bin")]), npm_config_prefix: npmPrefix };
    const claudeKey = process.env.DOOR_ANTHROPIC_API_KEY ?? "";
    delete env.DOOR_ANTHROPIC_API_KEY;
    if (claudeKey !== "") env.ANTHROPIC_API_KEY = claudeKey;
    const sessionId = randomUUID();
    const prompt = `${promptBody} Use the Stigmer at ${server.baseUrl}.`;
    log(`claude -p in ${appDir}${args.model === "" ? "" : ` on ${args.model}`}${claudeKey === "" ? "" : " (DOOR_ANTHROPIC_API_KEY)"}: ${prompt}`);
    let turn = await runClaude(appDir, env, sessionId, prompt, true, streamPath, stop.signal, args);
    const handedOver = () =>
      args.local
        ? filesUnder(join(appDir, "app")).some((f) => f.endsWith("page.tsx") && readFileSync(join(appDir, "app", f), "utf8").includes("StigmerAgentChat"))
        : existsSync(join(appDir, "app", "api", "stigmer-token", "route.ts"));
    for (let i = 0; i < args.maxTurns && !handedOver(); i++) {
      log(`the coding agent stopped (${turn.result.slice(0, 160).replace(/\n/g, " ")}); answering`);
      turn = await runClaude(appDir, env, sessionId, ANSWER, false, streamPath, stop.signal, args);
    }
    log(`the coding agent's last word: ${turn.result.slice(0, 300).replace(/\n/g, " ")}`);

    // What the door must have left behind.
    const config = readFileSync(join(stage.cliHome, ".stigmer", "config.yaml"), "utf8");
    if (!args.local) check(config.includes(`oidc_issuer: ${stage.issuer.issuer}`), "the CLI never signed in through the server's issuer");
    const manifests = filesUnder(join(appDir, "stigmer")).filter((f) => f.endsWith(".yaml"));
    check(manifests.length > 0, "no agent manifest under stigmer/");
    const outputs = filesUnder(join(appDir, "stigmer-output"));
    check(outputs.some((f) => f.endsWith(DOOR_FILE)), `the first run's ${DOOR_FILE} is not in stigmer-output/ (found: ${outputs.join(", ") || "nothing"})`);
    check(readFileSync(join(appDir, ".gitignore"), "utf8").includes("stigmer-output"), ".gitignore does not name stigmer-output/");
    const envFile = [".env.local", ".env"].map((f) => join(appDir, f)).find((p) => existsSync(p) && readFileSync(p, "utf8").includes("STIGMER_API_KEY="));
    if (args.local) {
      check(!existsSync(join(appDir, "app", "api", "stigmer-token", "route.ts")), "a token route on a server that trusts every caller");
    } else {
      check(envFile !== undefined, "no env file holds STIGMER_API_KEY");
      const key = /STIGMER_API_KEY=(\S+)/.exec(readFileSync(envFile, "utf8"))?.[1] ?? "";
      check(key.length > 8 && !readFileSync(streamPath, "utf8").includes(key), "the key appears in the coding agent's stream");
      const route = readFileSync(join(appDir, "app", "api", "stigmer-token", "route.ts"), "utf8");
      check(/getSession/.test(route), "the token route does not read the app's own session (getSession)");
    }
    if (claudeKey !== "") check(!readFileSync(streamPath, "utf8").includes(claudeKey), "the coding agent's own model key appears in its stream");
    const chatPage = filesUnder(join(appDir, "app")).find((f) => f.endsWith("page.tsx") && readFileSync(join(appDir, "app", f), "utf8").includes("StigmerAgentChat"));
    check(chatPage !== undefined, "no page renders <StigmerAgentChat />");
    log(`left behind: ${manifests.join(", ")}; stigmer-output/${DOOR_FILE}; ${args.local ? "the development chat" : `the key in ${envFile}; the route; the chat`} on app/${chatPage}`);

    // The app, with this checkout's packages (or the registry's at the
    // published version), and its chat in a browser.
    if (args.published) {
      const manifest = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
      const named = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter((name) => name.startsWith("@stigmer/"));
      const wanted = [...new Set(["@stigmer/react-sdk", "@stigmer/client", "@stigmer/apis", ...named])].map((name) => `${name}@${args.version}`);
      log(`installing the app's Stigmer packages from ${args.registry}: ${wanted.join(", ")}`);
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", ...npmRegistryFlags(args.registry), ...wanted], {
        cwd: appDir,
        stdio: "inherit",
        env: { ...env, npm_config_prefix: undefined, ANTHROPIC_API_KEY: undefined },
      });
      log(`the app's Stigmer packages: ${checkAllAt(join(appDir, "node_modules"), args.version, "the app").join(", ")}`);
    } else {
      const packDir = join(scratch, "packs");
      execFileSync(process.execPath, [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", "0.0.0-door", "--pack-dir", packDir, "--only", "@stigmer/react-sdk", "--skip-build"], { cwd: repoRoot, stdio: "inherit" });
      const tarballs = readdirSync(packDir).filter((f) => f.endsWith(".tgz")).map((f) => join(packDir, f));
      execFileSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], { cwd: appDir, stdio: "inherit", env: { ...env, npm_config_prefix: undefined } });
    }
    const appPort = await freePort();
    app = spawn("npx", ["next", "dev", "-p", String(appPort)], { cwd: appDir, env: { ...process.env, DOOR_ANTHROPIC_API_KEY: undefined, PORT: String(appPort) }, stdio: "ignore", detached: true });
    const appUrl = `http://localhost:${appPort}`;
    for (let i = 0; i < 120; i++) {
      if (await fetch(appUrl).then((r) => r.ok).catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const { chromium } = createRequire(join(repoRoot, "package.json"))("playwright");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`${appUrl}/login?user=dana`);
      await page.goto(`${appUrl}/${chatPage.replace(/(^|\/)page\.tsx$/, "").replace(/\([^)]*\)\/?/g, "")}`);
      const box = page.getByRole("textbox").first();
      await box.waitFor({ timeout: 60_000 });
      await box.fill("Hello, can you check this month's invoices?");
      await box.press("Enter");
      await page.getByText(fake.replyText).first().waitFor({ timeout: 120_000 });
      log("the app's page signed Dana in through its own sign-in, and the chat answered");
    } finally {
      await browser.close();
    }
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
    // Next keeps writing .next/ after SIGTERM: the folder is removed only
    // once the whole group has exited.
    await stopProcessGroup(app);
    await stage?.stop();
    if (!args.keep) rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`coding-agent-door: FAILED\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
