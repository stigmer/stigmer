#!/usr/bin/env node

/**
 * CLI E2E smoke (born as the D4 #24 cutover gate): `stigmer up` → apply →
 * run → stream → `stigmer down`, against an ISOLATED home, proving the
 * daemon launches the packaged server end-to-end. Nothing else exercises
 * `stigmer up` whole — the e2e suites boot the server entry directly,
 * bypassing the CLI (verified during #24 planning).
 *
 * The script stages the SLIM server artifact (dist-slim) as a server
 * package and launches it through the daemon's node+entry path — the exact
 * packaged entry users get from @stigmer/server-slim. (The script's second
 * arm — the STIGMER_SERVER_BIN Go rollback — retired with #25
 * go-server-retirement.)
 *
 * The launch is verified, not assumed: after `up`, the server child's real
 * command line (via its PID file) must be a node+entry process.
 *
 * The workflow under test is a single deterministic set_vars task — no LLM,
 * no API keys, no network beyond npm/Temporal's own machinery. What it
 * proves: CLI daemon → server (gRPC gate) → bootstrap → workflow apply
 * → Temporal orchestration → runner execution → event streaming → clean
 * shutdown. Then an agent is applied and run with `stigmer run <agent> -m`:
 * the shell `stigmer up` starts from carries the model settings a user
 * exports (ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL), pointed at a fake
 * Anthropic API on loopback (scripts/lib/fake-model.mjs), and the streamed
 * run must carry the fake's reply — what a CLI user sees as the answer.
 * Since the console restoration (DD-012) it also proves the
 * unified port serves the bundled web console: /config.json synthesis, a
 * dynamic deep link, and the 404 posture — the P3 acceptance's
 * "`stigmer up` serves the console end-to-end" arm.
 *
 * The CLI itself runs from source under tsx — the repo's documented dev
 * launch (its `start` script; the daemon re-exec replays the loader via
 * process.execArgv, see daemon/launch.ts). The packaged artifact under test
 * here is the SERVER slim bundle, staged byte-for-byte.
 *
 * Prereqs (the gate's build steps): backend/services/runner built (dist/)
 * and the server's dist-slim/ (make smoke-cli-cutover builds both).
 *
 * Usage:
 *   node scripts/smoke-cli-cutover.mjs
 *       The CLI from source, the staged slim server (the gate's mode).
 *   node scripts/smoke-cli-cutover.mjs --published --version=X.Y.Z
 *       The published CLI, installed by site/public/install.sh into the
 *       isolated home, which acquires its own published server and runner
 *       on `up` — a user's install, end to end.
 *   --fake-model=error   the fake answers every model call with an error,
 *       so the agent run must fail (its red-first check).
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { assertConsoleServed } from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliDir = join(repoRoot, "client-apps", "cli");
const cliEntry = join(cliDir, "src", "cli", "stigmer.ts");
// tsx is hoisted to the workspace root's bin by npm workspaces.
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const runnerEntry = join(
  repoRoot,
  "backend",
  "services",
  "runner",
  "dist",
  "main.js",
);
const slimDir = join(
  repoRoot,
  "backend",
  "services",
  "stigmer-server",
  "dist-slim",
);
const installScript = join(repoRoot, "site", "public", "install.sh");

/** The org `stigmer up`'s bootstrap creates — the CLI's fallback on a local backend. */
const ORG = "stigmer";
const UP_TIMEOUT_MS = 300_000; // first `up` may download the Temporal CLI
const RUN_TIMEOUT_MS = 120_000;
// The published install downloads Node and the CLI from npm.
const INSTALL_TIMEOUT_MS = 300_000;
/** The agent the smoke applies and runs by slug. */
const AGENT = "cutover-smoke-agent";

// Set once the smoke reaches the point where a daemon COULD exist. fail()
// exits the process directly, which would otherwise leak a live daemon
// holding port 7234 into the next run. Teardown is unconditional once the
// `up` attempt starts (panel finding): `up` spawns the daemon DETACHED
// before its readiness wait, so even a failed/timed-out `up` can leave a
// live stack behind — and `stigmer down` is idempotent when nothing runs.
let upAttempted = false;

function fail(message) {
  console.error(`smoke-cli-cutover: ${message}`);
  if (upAttempted) teardownBestEffort();
  process.exit(1);
}

// ─── Arguments and preflight ─────────────────────────────────────────────────

function parseArgs() {
  const parsed = { published: false, version: "", fakeModel: "reply" };
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) parsed.fakeModel = fakeModelMode;
    else if (arg === "--published") parsed.published = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else
      fail(
        `unknown argument: ${arg} (usage: node scripts/smoke-cli-cutover.mjs [--published --version=X.Y.Z] [--fake-model=error])`,
      );
  }
  if (parsed.published && parsed.version === "") fail("--published requires --version=X.Y.Z (the published @stigmer/cli)");
  if (!parsed.published && parsed.version !== "") fail("--version applies only with --published");
  return parsed;
}

const args = parseArgs();
if (args.published) {
  if (!existsSync(installScript)) fail(`installer not found: ${installScript}`);
} else {
  if (!existsSync(cliEntry)) fail(`CLI source not found: ${cliEntry}`);
  if (!existsSync(tsxBin)) fail(`tsx not installed: ${tsxBin} (npm ci)`);
  if (!existsSync(runnerEntry))
    fail(`runner not built: ${runnerEntry} (make build-runner)`);
  if (!existsSync(join(slimDir, "main.js"))) {
    fail(
      `slim server artifact not built: ${slimDir}/main.js (node scripts/bundle-slim.mjs in the server package)`,
    );
  }
}

// ─── Isolated home ───────────────────────────────────────────────────────────

const home = mkdtempSync(join(tmpdir(), "stigmer-smoke-"));
console.log(`smoke-cli-cutover: home=${home}`);

// Seed a PATH-resolvable Temporal binary into the managed location when the
// host has one, so the smoke skips the manager's one-time download. Purely an
// accelerator — absent it, `up` downloads exactly as a real first run does.
try {
  const hostTemporal = execFileSync("which", ["temporal"], {
    encoding: "utf8",
  }).trim();
  if (hostTemporal !== "") {
    mkdirSync(join(home, ".stigmer", "bin"), { recursive: true });
    cpSync(hostTemporal, join(home, ".stigmer", "bin", "temporal"));
  }
} catch {
  // No host temporal — the manager downloads its own.
}

// The model the stack is started with: the fake on loopback, configured the
// way a user exports a gateway for `stigmer up`.
const fake = await startFakeModel({ mode: args.fakeModel });
const env = { ...process.env, HOME: home, ...fakeModelEnv(fake) };
// The caller's shell must not contaminate the resolution.
delete env.STIGMER_SERVER_DIR;
delete env.STIGMER_RUNNER_DIR;
delete env.STIGMER_HOME;
delete env.STIGMER_BIN_DIR;
delete env.STIGMER_RUNTIMES_DIR;

/** The command a user runs as `stigmer`: the source CLI, or the installed launcher. */
let cliCommand = [tsxBin, cliEntry];
if (args.published) {
  // A user's install: the published CLI into the isolated home, by the
  // installer users run, whose launcher then acquires the matching server
  // and runner on `up`.
  const binDir = join(home, "bin");
  console.log(`smoke-cli-cutover: install.sh STIGMER_VERSION=${args.version}`);
  const install = spawnSync("sh", [installScript], {
    env: { ...env, STIGMER_VERSION: args.version, STIGMER_BIN_DIR: binDir },
    encoding: "utf8",
    timeout: INSTALL_TIMEOUT_MS,
    killSignal: "SIGKILL",
  });
  if (install.status !== 0) {
    fail(`install.sh exited ${install.status}\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`);
  }
  cliCommand = [join(binDir, "stigmer")];
} else {
  // Stage the slim artifact in the server-package shape resolveServerTs
  // expects (dist/main.js under a package dir). The staged dist keeps the
  // artifact's own siblings — workflow bundles, worker-thread entry, staged
  // node_modules, and its untyped package.json (the CJS marker) — exactly as
  // an acquired @stigmer/server-slim install lays them out.
  const pkgDir = join(home, "server-pkg");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: "@stigmer/server", private: true }, null, 2),
  );
  cpSync(slimDir, join(pkgDir, "dist"), { recursive: true });
  env.STIGMER_SERVER_DIR = pkgDir;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Asynchronous on purpose: the fake model is served by this process's own
// event loop, and the runner calls it while a CLI command is waiting (the
// agent run, and any background call during the others). A synchronous child
// would block the loop, and the model call would hang until the run's budget.
async function cli(args, opts = {}) {
  const label = `stigmer ${args.join(" ")}`;
  console.log(`smoke-cli-cutover: ${label}`);
  const [command, ...prefix] = cliCommand;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const result = await new Promise((resolve) => {
    // Its own process group, so a timeout kills the whole tree: tsx runs the
    // CLI in a child node process, and a killed tsx alone leaves that child
    // holding the output pipes open.
    const child = spawn(command, [...prefix, ...args], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    // A timed-out child must not outlive the smoke (SIGTERM alone might not do).
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr, error });
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolve({
        status,
        stdout,
        stderr,
        error: timedOut ? new Error(`timed out after ${timeoutMs}ms`) : undefined,
      });
    });
  });
  if (result.error && opts.allowFailure !== true)
    fail(`${label} failed: ${result.error}`);
  if (result.status !== 0 && opts.allowFailure !== true) {
    fail(
      `${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

function teardownBestEffort() {
  const [command, ...prefix] = cliCommand;
  spawnSync(command, [...prefix, "down"], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ─── The smoke ───────────────────────────────────────────────────────────────

try {
  // 1. Up — the daemon resolves the staged server, gates on the gRPC port,
  //    and bootstraps the backend (which creates the org).
  upAttempted = true;
  await cli(["up", "--no-web"], { timeoutMs: UP_TIMEOUT_MS });

  // 2. Prove WHICH server is running: the server child's command line must
  //    be the node+entry launch. The PID file is the daemon's own record.
  const pidFile = join(home, ".stigmer", "data", "stigmer-server.pid");
  const pid = readFileSync(pidFile, "utf8").trim().split("\n")[0].trim();
  const command = execFileSync("ps", ["-p", pid, "-o", "command="], {
    encoding: "utf8",
  }).trim();
  console.log(`smoke-cli-cutover: server pid ${pid}: ${command}`);
  if (!(command.includes("node") && command.includes("main.js"))) {
    fail(`expected a node+entry server process, got: ${command}`);
  }

  // 3. Console restoration (DD-012): the slim artifact ships the web
  //    console and the server serves it from the unified port. Probe the
  //    three load-bearing arms a browser exercises: the synthesized
  //    /config.json (the one trusted-local document, asserted by the shared
  //    probe in scripts/lib/stigmer-smoke.mjs together with / as HTML), a
  //    dynamic deep link resolving to its placeholder document, and the 404
  //    posture (the export's not-found page WITH a 404 status — never the
  //    blank app shell). `--no-web` only suppresses URL reporting; serving
  //    is unconditional. The probe's refusal goes through fail() so the
  //    detached daemon is torn down on this path like every other.
  const consoleBase = `http://127.0.0.1:7234`;
  await assertConsoleServed(consoleBase).catch((error) =>
    fail(`console ${error instanceof Error ? error.message : String(error)}`),
  );
  const deepLink = await fetch(`${consoleBase}/sessions/zz-smoke-probe`);
  if (
    deepLink.status !== 200 ||
    !(deepLink.headers.get("content-type") ?? "").includes("text/html")
  ) {
    fail(
      `console deep link answered ${deepLink.status} ${deepLink.headers.get("content-type")}`,
    );
  }
  const notFound = await fetch(`${consoleBase}/zz-no-such-route`);
  if (notFound.status !== 404) {
    fail(`console unknown URL answered ${notFound.status}, expected 404`);
  }
  console.log("smoke-cli-cutover: console serving verified");

  // 4. Apply the deterministic workflow.
  const workflowPath = join(home, "cutover-smoke.yaml");
  writeFileSync(
    workflowPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: cutover-smoke
spec:
  description: Deterministic no-LLM workflow for the CLI cutover smoke.
  document:
    dsl: "1.0.0"
    namespace: stigmer
    name: cutover-smoke
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: hello-from-the-cutover-smoke
      export:
        as: "\${ . }"
`,
  );
  // --org is a root-level global option, so it precedes the subcommand.
  await cli(["--org", ORG, "apply", "-f", workflowPath]);

  // 5. Run it and stream to completion (JSON events on stdout) — a clean
  //    exit is required.
  const run = await cli(["--org", ORG, "run", "workflow", "cutover-smoke", "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (!/completed/i.test(run.stdout)) {
    fail(
      `run did not reach COMPLETED\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }

  // 6. Apply an agent and run it by slug: the stream must carry the model's
  //    reply, which only happens when `stigmer up` handed the runner the
  //    model settings from its shell and the runner reached the model.
  const agentPath = join(home, "cutover-smoke-agent.yaml");
  writeFileSync(
    agentPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: ${AGENT}
spec:
  description: A tool-less agent for the CLI smoke; its model is the smoke's fake.
  instructions: Answer the message in one short sentence.
`,
  );
  await cli(["--org", ORG, "apply", "-f", agentPath]);
  const agentRun = await cli(["--org", ORG, "run", AGENT, "-m", "Say hello.", "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (!agentRun.stdout.includes(fake.replyText)) {
    fail(
      `the agent run's stream does not carry the model's reply (${fake.requests()} model calls)\n` +
        `stdout:\n${agentRun.stdout}\nstderr:\n${agentRun.stderr}`,
    );
  }
  console.log(`smoke-cli-cutover: agent run streamed the model's reply (${fake.requests()} model calls)`);

  // 7. Down — clean teardown, port released.
  await cli(["down"]);
  const status = await cli(["status"], { allowFailure: true });
  if (
    /running/i.test(status.stdout) &&
    !/not running|stopped/i.test(status.stdout)
  ) {
    fail(`stack still reports running after down\n${status.stdout}`);
  }

  await fake.close();
  console.log("smoke-cli-cutover: PASS");
  // Success-path hygiene: the isolated home carries a full slim copy plus a
  // Temporal binary (~100 MB) — keep failures around for debugging, never
  // successes.
  rmSync(home, { recursive: true, force: true });
} catch (err) {
  teardownBestEffort();
  throw err;
}
