#!/usr/bin/env node

/**
 * CLI cutover E2E smoke (D4 #24): `stigmer up` → apply → run → stream →
 * `stigmer down`, against an ISOLATED home, proving the daemon launches the
 * intended server implementation end-to-end. Nothing before this script
 * exercised `stigmer up` whole — the e2e suites boot the server binary
 * directly, bypassing the CLI (verified during #24 planning).
 *
 * Two arms, same assertions — the rollback exercise the cutover gate
 * requires is literally this script's other arm:
 *
 *   --arm=ts (default): stages the SLIM server artifact (dist-slim) as a
 *     server package and launches it through the daemon's node+entry path —
 *     the exact packaged entry users get from @stigmer/server-slim.
 *   --arm=go: sets STIGMER_SERVER_BIN to the repo's Go build — the
 *     no-code-change rollback lever, proven live.
 *
 * The arm is verified, not assumed: after `up`, the server child's real
 * command line (via its PID file) must match the arm.
 *
 * The workflow under test is a single deterministic set_vars task — no LLM,
 * no API keys, no network beyond npm/Temporal's own machinery. What it
 * proves: CLI daemon → server (gRPC gate) → seedpack apply → workflow apply
 * → Temporal orchestration → runner execution → event streaming → clean
 * shutdown.
 *
 * The CLI itself runs from source under tsx — the repo's documented dev
 * launch (its `start` script; the daemon re-exec replays the loader via
 * process.execArgv, see daemon/launch.ts). The CLI's own packaging is
 * unchanged by the cutover; the packaged artifact under test here is the
 * SERVER slim bundle, which the ts arm stages byte-for-byte.
 *
 * Prereqs (the gate's build steps): backend/services/runner built (dist/),
 * and per arm: stigmer-server-ts dist-slim/ (ts) or bin/stigmer-server (go).
 *
 * Usage: node scripts/smoke-cli-cutover.mjs [--arm=ts|go]
 */

import { execFileSync, spawnSync } from "node:child_process";
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
  "stigmer-server-ts",
  "dist-slim",
);
const goBinary = join(repoRoot, "bin", "stigmer-server");

/** The seedpack's default local org — created by `stigmer up` itself. */
const ORG = "stigmer";
const UP_TIMEOUT_MS = 300_000; // first `up` may download the Temporal CLI
const RUN_TIMEOUT_MS = 120_000;

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

function parseArm() {
  let arm = "ts";
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--arm=(ts|go)$/);
    if (m) arm = m[1];
    else fail(`unknown argument: ${arg} (usage: --arm=ts|go)`);
  }
  return arm;
}

const arm = parseArm();

// ─── Preflight ───────────────────────────────────────────────────────────────

if (!existsSync(cliEntry)) fail(`CLI source not found: ${cliEntry}`);
if (!existsSync(tsxBin)) fail(`tsx not installed: ${tsxBin} (npm ci)`);
if (!existsSync(runnerEntry))
  fail(`runner not built: ${runnerEntry} (make build-runner)`);
if (arm === "ts" && !existsSync(join(slimDir, "main.js"))) {
  fail(
    `slim server artifact not built: ${slimDir}/main.js (npm run build:slim in stigmer-server-ts)`,
  );
}
if (arm === "go" && !existsSync(goBinary)) {
  fail(`Go server not built: ${goBinary} (make build)`);
}

// ─── Isolated home ───────────────────────────────────────────────────────────

const home = mkdtempSync(join(tmpdir(), "stigmer-smoke-"));
console.log(`smoke-cli-cutover: arm=${arm} home=${home}`);

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

const env = { ...process.env, HOME: home };
// The arms must not cross-contaminate through the caller's shell.
delete env.STIGMER_SERVER_BIN;
delete env.STIGMER_SERVER_DIR;
delete env.STIGMER_RUNNER_DIR;

if (arm === "ts") {
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
} else {
  env.STIGMER_SERVER_BIN = goBinary;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cli(args, opts = {}) {
  const label = `stigmer ${args.join(" ")}`;
  console.log(`smoke-cli-cutover: ${label}`);
  const result = spawnSync(tsxBin, [cliEntry, ...args], {
    env,
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 60_000,
    // A timed-out child must not outlive the smoke (the go arm EXPECTS a
    // lingering client after COMPLETED, #884 — SIGTERM alone might not do).
    killSignal: "SIGKILL",
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
  spawnSync(tsxBin, [cliEntry, "down"], {
    env,
    encoding: "utf8",
    timeout: 60_000,
  });
}

// ─── The smoke ───────────────────────────────────────────────────────────────

try {
  // 1. Up — the daemon resolves the arm's server, gates on the gRPC port,
  //    and applies the seedpack (which creates the org).
  upAttempted = true;
  cli(["up", "--no-web"], { timeoutMs: UP_TIMEOUT_MS });

  // 2. Prove WHICH server is running: the server child's command line must
  //    match the arm. The PID file is the daemon's own record.
  const pidFile = join(home, ".stigmer", "data", "stigmer-server.pid");
  const pid = readFileSync(pidFile, "utf8").trim().split("\n")[0].trim();
  const command = execFileSync("ps", ["-p", pid, "-o", "command="], {
    encoding: "utf8",
  }).trim();
  console.log(`smoke-cli-cutover: server pid ${pid}: ${command}`);
  if (arm === "ts") {
    if (!(command.includes("node") && command.includes("main.js"))) {
      fail(`expected a node+entry server process for arm=ts, got: ${command}`);
    }
  } else if (!command.includes("stigmer-server")) {
    fail(`expected the Go stigmer-server binary for arm=go, got: ${command}`);
  }

  // 3. Apply the deterministic workflow.
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
  cli(["--org", ORG, "apply", "-f", workflowPath]);

  // 4. Run it and stream to completion (JSON events on stdout).
  //
  // The ts arm requires a CLEAN EXIT — the cutover's behavior. The go arm
  // tolerates a lingering process after the completed result: the shipped
  // CLI never exits after runs against the Go server (pre-existing,
  // stigmer/stigmer#884 — found by this smoke; the server side is clean),
  // so the rollback arm asserts the streamed COMPLETED result within a
  // bounded wait instead.
  const run = cli(
    ["--org", ORG, "run", "workflow", "cutover-smoke", "--json"],
    {
      timeoutMs: RUN_TIMEOUT_MS,
      allowFailure: arm === "go",
    },
  );
  if (arm === "go" && run.status !== 0) {
    const timedOut =
      run.error !== undefined && /ETIMEDOUT/.test(String(run.error));
    if (!(timedOut && /completed/i.test(run.stdout))) {
      fail(
        `go-arm run neither exited cleanly nor streamed COMPLETED within the bounded wait\n` +
          `status=${run.status} error=${run.error}\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
      );
    }
    console.log(
      "smoke-cli-cutover: go arm streamed COMPLETED; lingering process tolerated (stigmer/stigmer#884)",
    );
  }
  if (!/completed/i.test(run.stdout)) {
    fail(
      `run did not reach COMPLETED\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }

  // 5. Down — clean teardown, port released.
  cli(["down"]);
  const status = cli(["status"], { allowFailure: true });
  if (
    /running/i.test(status.stdout) &&
    !/not running|stopped/i.test(status.stdout)
  ) {
    fail(`stack still reports running after down\n${status.stdout}`);
  }

  console.log(`smoke-cli-cutover: PASS (arm=${arm})`);
  // Success-path hygiene: the isolated home carries a full slim copy plus a
  // Temporal binary (~100 MB per arm) — keep failures around for debugging,
  // never successes.
  rmSync(home, { recursive: true, force: true });
} catch (err) {
  teardownBestEffort();
  throw err;
}
