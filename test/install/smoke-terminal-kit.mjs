#!/usr/bin/env node

/**
 * The terminal kit as a developer adopts it, run from its own pages: the
 * packed @stigmer/ink-ui installed into an empty folder, its `stigmer-ink`
 * started with Node alone, the README's `runInTerminal` example and the CLI
 * guide's Go, Python and Rust bridges (docs/sdk/ink/cli-integration.mdx)
 * written and run as the pages show them, against `stigmer up` with the
 * fake model. The pages are read by test/install/lib/doc-steps.mjs; there is
 * no copy of them here, so a page edit that breaks a step breaks this smoke.
 *
 * Each job (the README's example, each bridge) runs twice:
 *   - on a pseudo-terminal (test/install/lib/pty-run.py), with CI and
 *     CONTINUOUS_INTEGRATION removed from its environment so Ink draws live
 *     on a CI runner too: the agent asks to run a command, the driver presses
 *     `y` at "Approval required", and the turn completes with exit code 0;
 *   - through a pipe, with no terminal: the view is read-only, the ask is
 *     denied by the default and the view says so, the turn still completes,
 *     and the frame is written once at exit.
 * A run that cannot reach a server is worded for a person and exits 3.
 *
 * The model is test/support's fake, scripted per run: the conversation's
 * title, then an `execute` tool use (the shell, which always asks first),
 * then a closing line after the answer.
 *
 * The harness performs the lines the pages name as the install's
 * (doc-steps.mjs HARNESS_LINES): the CLI is the build under test, the
 * model key the fake's, and the kit (`npm install @stigmer/ink-ui ...` and
 * `npm install --global @stigmer/ink-ui`) the tarballs this build packs, or
 * in the published mode the version npm serves. `stigmer up` refuses a taken
 * port 7234, so this refuses before anything starts when one is.
 *
 * Its cases are top-level `node:test` cases titled with the UX bar's
 * promises (test/ux-bar.json), read by scripts/ux-bar.mjs and the scorecard.
 *
 * Usage:
 *   node test/install/smoke-terminal-kit.mjs [--skip-build] [--tarballs=<dir>] [--docs=<dir>]
 *   node test/install/smoke-terminal-kit.mjs --published --version=X.Y.Z
 *   --tarballs=<dir>  install the kit from tarballs already packed there.
 *   --docs=<dir>      read cli-integration.mdx from <dir> (a scratch copy with
 *                     a step broken is how the smoke is shown red).
 *   --keep            keep the folder (each run's terminal log is pty-<n>.log there).
 * Needs node, python3, go and cargo on PATH.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { anthropicText, anthropicToolUse } from "../support/src/llm-wire.ts";
import { docSteps } from "./lib/doc-steps.mjs";
import { fakeModelEnv, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";
import { configuredRegistry, installGap, waitForRegistry } from "../../scripts/publish-standalone.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const KIT = "@stigmer/ink-ui";
const SOURCE_VERSION = "0.0.0-terminal-kit";
const COMMAND_TIMEOUT_MS = 300_000;
const PTY_RUN = join(repoRoot, "test", "install", "lib", "pty-run.py");
/** The kit and its @stigmer/* peers, at the release's version in the published mode. */
const PUBLISHED_PACKAGES = [KIT, "@stigmer/react-core", "@stigmer/client", "@stigmer/apis"];

/** A job's command: it runs a turn, so the smoke runs it on a terminal and through a pipe. */
const JOB = /^(?:npx tsx run-agent\.mts|go run \.|python3 bridge\.py|cargo run --quiet --) /;
/** What the scripted agent says when it is done, whichever way its command was answered. */
const CLOSING = "v2.3 looks safe to ship.";

function log(step) {
  console.log(`smoke-terminal-kit: ${step}`);
}

function parseArgs() {
  const parsed = { published: false, version: "", tarballs: "", skipBuild: false, keep: false, docs: join(repoRoot, "docs", "sdk", "ink") };
  for (const arg of process.argv.slice(2)) {
    let m;
    if (arg === "--published") parsed.published = true;
    else if (arg === "--skip-build") parsed.skipBuild = true;
    else if (arg === "--keep") parsed.keep = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else if ((m = arg.match(/^--tarballs=(.+)$/)) !== null) parsed.tarballs = resolve(m[1]);
    else if ((m = arg.match(/^--docs=(.+)$/)) !== null) parsed.docs = resolve(m[1]);
    else {
      console.error(`smoke-terminal-kit: unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (parsed.published !== (parsed.version !== "")) {
    console.error("smoke-terminal-kit: --published and --version=X.Y.Z go together");
    process.exit(2);
  }
  return parsed;
}

/** A `go env` value, or undefined when Go is not installed (the bridge step then says so). */
function goEnv(key) {
  const result = spawnSync("go", ["env", key], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

const args = parseArgs();
const pages = [
  { name: "cli-integration", dir: "guide", steps: docSteps(readFileSync(join(args.docs, "cli-integration.mdx"), "utf8")) },
  { name: "README", dir: "readme", steps: docSteps(readFileSync(join(repoRoot, "sdk", "ink", "README.md"), "utf8")) },
];

const scratch = mkdtempSync(join(tmpdir(), "stigmer-terminal-kit-"));
const bin = join(scratch, "bin");
let fake;
let stack;
let shell;
let failed = false;
/** Each page's job commands, with the folder they run in. */
const jobs = [];

/** Runs a line in bash in `cwd` with the reader's shell; throws on a non-zero exit. */
async function run(line, cwd, env = shell) {
  log(`$ ${line}`);
  const result = await spawnCommand(["bash", "-c", 'cd "$0" || exit 1; eval "$1"'], [cwd, line], env, COMMAND_TIMEOUT_MS).done;
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`the page's command failed: ${line} (${result.error?.message ?? `exit ${result.status}`})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

/** The kit's install: this build's tarballs (its @stigmer/* closure) or the published version. */
function kitTargets() {
  if (args.published) return [...PUBLISHED_PACKAGES.map((name) => `${name}@${args.version}`), "@bufbuild/protobuf", "ink@^7", "react@^19"];
  let dir = args.tarballs;
  if (dir === "") {
    dir = join(scratch, "tarballs");
    log(`packing ${KIT} and its @stigmer/* closure into ${dir}`);
    const packed = spawnSync(
      process.execPath,
      [join(repoRoot, "scripts", "publish-libs.mjs"), "--version", SOURCE_VERSION, "--pack-dir", dir, "--only", KIT, ...(args.skipBuild ? ["--skip-build"] : [])],
      { cwd: repoRoot, stdio: "inherit" },
    );
    if (packed.status !== 0) throw new Error(`publish-libs.mjs --pack-dir exited ${packed.status ?? packed.signal}`);
  }
  const tarballs = readdirSync(dir).filter((name) => name.endsWith(".tgz")).map((name) => join(dir, name));
  // The kit's peers from npm, as a reader's install line names them.
  return [...tarballs, "@bufbuild/protobuf", "ink@^7", "react@^19"];
}

// The conversation's title, then a command that asks first, then the closing line.
function scriptRun() {
  fake.enqueue({ kind: "anthropic", body: anthropicText("Release check"), matches: isTitleCall });
  const turn = (request) => !isTitleCall(request);
  fake.enqueue({ kind: "anthropic", matches: turn, body: anthropicToolUse(`toolu_check_${Date.now()}`, "execute", { command: "echo all checks pass" }) });
  fake.enqueue({ kind: "anthropic", matches: turn, body: anthropicText(CLOSING) });
}

// The runner's title call: its system prompt is the title generator's.
function isTitleCall(request) {
  return JSON.stringify(request.body?.system ?? "").includes("session title generator");
}

/** The reader's shell without CI flags, on a real terminal type: Ink draws live there. */
function terminalEnv() {
  const env = { ...shell, TERM: "xterm-256color" };
  delete env.CI;
  delete env.CONTINUOUS_INTEGRATION;
  return env;
}

before(async () => {
  try {
    await assertPortFree(CLI_SERVER_PORT);
    if (args.published) {
      const registry = configuredRegistry();
      await waitForRegistry(PUBLISHED_PACKAGES, args.version, { gapOf: (name, version) => installGap(name, version, { registry }), log });
    }
    const targets = kitTargets();
    fake = await startFakeModel();
    stack = createCliInstall({ model: fakeModelEnv(fake), log });
    await stack.install(args.published ? { kind: "published", version: args.version } : { kind: "build" });

    mkdirSync(bin, { recursive: true });
    const [stigmerBin, ...stigmerPrefix] = stack.command();
    writeFileSync(join(bin, "stigmer"), `#!/bin/sh\nexec ${[stigmerBin, ...stigmerPrefix].map(shellQuote).join(" ")} "$@"\n`, { mode: 0o755 });
    shell = {
      ...stack.env,
      PATH: `${bin}:${stack.env.PATH ?? ""}`,
      npm_config_cache: process.env.npm_config_cache ?? join(homedir(), ".npm"),
      // The bridges' toolchains read their settings and caches from the
      // machine's own home, not the stack's isolated one: rustup its default
      // toolchain, cargo and Go their downloaded crates and modules.
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? join(homedir(), ".rustup"),
      CARGO_HOME: process.env.CARGO_HOME ?? join(homedir(), ".cargo"),
      GOPATH: process.env.GOPATH ?? join(homedir(), "go"),
      GOCACHE: process.env.GOCACHE ?? goEnv("GOCACHE"),
      npm_config_yes: "true",
      npm_config_fund: "false",
      npm_config_audit: "false",
    };

    const performs = {
      cli: async () => log("CLI install: the build under test is installed in the isolated home"),
      "model-key": async () => log("model key: the fake model's key and address are in the shell"),
      "ink-kit": async (cwd) => run(`npm install ${targets.map(shellQuote).join(" ")}`, cwd),
      // A global install is a folder of its own with the bin on PATH.
      "ink-bin": async () => {
        const global = join(scratch, "global");
        mkdirSync(global, { recursive: true });
        writeFileSync(join(global, "package.json"), '{ "name": "global-ink", "private": true }\n');
        await run(`npm install ${targets.map(shellQuote).join(" ")}`, global);
        symlinkSync(join(global, "node_modules", ".bin", "stigmer-ink"), join(bin, "stigmer-ink"));
      },
    };

    for (const page of pages) {
      const cwd = join(scratch, page.dir);
      mkdirSync(cwd, { recursive: true });
      log(`page ${page.name}: ${page.steps.length} steps`);
      for (const step of page.steps) {
        if (step.kind === "file") {
          log(`write ${step.path}`);
          mkdirSync(dirname(join(cwd, step.path)), { recursive: true });
          writeFileSync(join(cwd, step.path), step.content);
        } else if (step.kind === "harness") {
          await performs[step.performs](cwd);
        } else if (JOB.test(step.line)) {
          jobs.push({ page: page.name, line: step.line, cwd });
        } else {
          await run(step.line, cwd);
        }
      }
    }
    if (jobs.length !== 4) throw new Error(`expected the README's example and three bridges, found ${jobs.map((j) => j.line).join("; ")}`);
  } catch (error) {
    failed = true;
    throw error;
  }
});

after(async () => {
  if (stack !== undefined) {
    if (failed) console.error(stack.diagnostics());
    await stack.stop({ keepHome: failed });
  }
  await fake?.close();
  if (failed || args.keep) log(`folder kept: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
});

/** A case's body, marking the run failed when it throws so the folder is kept. */
async function guarded(body) {
  try {
    await body();
  } catch (error) {
    failed = true;
    throw error;
  }
}

test("INK-03 the published stigmer-ink starts with Node alone", () =>
  guarded(async () => {
    const script = readFileSync(join(bin, "stigmer-ink"), "utf8");
    if (!script.startsWith("#!/usr/bin/env node\n")) throw new Error(`the bin's first line is not a node shebang: ${script.split("\n")[0]}`);
    // Node's own folder and the system's, and nothing else: no tsx anywhere.
    const env = { ...shell, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin` };
    const help = await run("stigmer-ink --help", scratch, env);
    if (!help.stdout.includes("stigmer-ink --agent <org/slug> --message <text>")) throw new Error(`--help printed no usage:\n${help.stdout}`);
    log("stigmer-ink --help ran with node alone");
  }));

test("INK-05 a run that cannot reach a server says what was tried and what to do, and exits 3", () =>
  guarded(async () => {
    const result = await spawnCommand(["stigmer-ink"], ["--agent", "stigmer/release-checker", "--message", "hi", "--base-url", "http://127.0.0.1:1"], shell, 60_000).done;
    if (result.status !== 3) throw new Error(`expected exit 3, got ${result.status}:\n${result.stderr}`);
    for (const text of ["Could not start the run at http://127.0.0.1:1.", "Is the server running? Start one with `stigmer up`"]) {
      if (!result.stderr.includes(text)) throw new Error(`stderr lacks "${text}":\n${result.stderr}`);
    }
  }));

test("INK-06 the README's example and the guide's three bridges run a turn on a terminal and return its exit code", () =>
  guarded(async () => {
    const env = terminalEnv();
    for (const job of jobs) {
      scriptRun();
      const logPath = join(scratch, `pty-${jobs.indexOf(job)}.log`);
      log(`on a terminal: ${job.line}`);
      const result = await spawnCommand(
        ["python3", PTY_RUN, "--answer", "Approval required=y", "--log", logPath, "--timeout", "240", "--"],
        ["bash", "-c", `cd ${shellQuote(job.cwd)} && ${job.line}`],
        env,
        COMMAND_TIMEOUT_MS,
      ).done;
      if (result.status !== 0) throw new Error(`${job.line} on a terminal exited ${result.status}:\n${result.stdout.slice(-4000)}\n${result.stderr}`);
      if (!result.stdout.includes(CLOSING)) throw new Error(`${job.line} on a terminal never showed the agent's answer:\n${result.stdout.slice(-4000)}`);
      log(`${job.page}: approved at the prompt, exit 0`);
    }
  }));

test("INK-04 off a terminal the same runs render read-only, deny the ask by default, and return", () =>
  guarded(async () => {
    for (const job of jobs) {
      scriptRun();
      log(`through a pipe: ${job.line}`);
      const result = await spawnCommand(["bash", "-c", 'cd "$0" || exit 1; eval "$1" < /dev/null'], [job.cwd, job.line], shell, COMMAND_TIMEOUT_MS).done;
      if (result.status !== 0) throw new Error(`${job.line} through a pipe exited ${result.status}:\n${result.stdout.slice(-4000)}\n${result.stderr}`);
      for (const text of ["Denied execute: no terminal to ask on (set approveDefault to approve)", CLOSING]) {
        if (!result.stdout.includes(text)) throw new Error(`${job.line} through a pipe lacks "${text}":\n${result.stdout.slice(-4000)}`);
      }
      if (/\x1b\[[0-9;]*[ABCDGHJK]/.test(result.stdout)) throw new Error(`${job.line} through a pipe moved the cursor`);
      log(`${job.page}: denied by default, exit 0`);
    }
  }));

if (!existsSync(PTY_RUN)) throw new Error(`no pseudo-terminal driver at ${PTY_RUN}`);
