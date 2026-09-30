/**
 * The CLI's `stigmer up` stack as an install a script can bring up, move to
 * another release, and take down, in an isolated home: the one place that
 * knows how the CLI is installed and started, shared by its smoke
 * (scripts/smoke-cli-cutover.mjs) and the upgrade rehearsal
 * (scripts/rehearse-upgrade.mjs).
 *
 * Two ways to have a `stigmer`:
 *   - a published release, installed by site/public/install.sh into the
 *     isolated home, whose launcher acquires the matching server and runner
 *     on `up` (a user's install, end to end);
 *   - this checkout: the CLI from source under tsx (its documented dev
 *     launch; the daemon re-exec replays the loader through
 *     process.execArgv), with the server's slim bundle staged byte for byte
 *     as the server package it resolves, and the runner from the tree.
 *
 * The home is a fresh HOME, so the CLI's ~/.stigmer (its data, its
 * runtimes, its Temporal) is the install's own; the caller's shell cannot
 * contaminate it. The model is handed over the way a user exports one for
 * `stigmer up`: ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL in the environment.
 *
 * An upgrade is what a user must do: `stigmer down`, then the new CLI (the
 * installer re-run, or this checkout), then `stigmer up` on the same home. A
 * running daemon keeps the server it started, and `up` refuses while one
 * runs, so the installer alone does not move a running stack (#1562).
 *
 * Plain node, no dependencies, like its neighbours. Commands run
 * asynchronously on purpose: a model the caller serves from its own event
 * loop must keep answering while a CLI command waits on it.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const cliEntry = join(repoRoot, "client-apps", "cli", "src", "cli", "stigmer.ts");
// tsx is hoisted to the workspace root's bin by npm workspaces.
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const runnerEntry = join(repoRoot, "backend", "services", "runner", "dist", "main.js");
const slimDir = join(repoRoot, "backend", "services", "stigmer-server", "dist-slim");
const installScript = join(repoRoot, "site", "public", "install.sh");

/** The port `stigmer up` serves the API and the console on. */
export const CLI_SERVER_PORT = 7234;

const UP_TIMEOUT_MS = 300_000; // first `up` may download the Temporal CLI and the runtimes
// The published install downloads Node and the CLI from npm.
const INSTALL_TIMEOUT_MS = 300_000;

/** Why this checkout cannot run as a `stigmer` yet, or "" when it can. */
export function sourceCliMissing() {
  if (!existsSync(cliEntry)) return `CLI source not found: ${cliEntry}`;
  if (!existsSync(tsxBin)) return `tsx not installed: ${tsxBin} (npm ci)`;
  if (!existsSync(runnerEntry)) return `runner not built: ${runnerEntry} (make build-runner)`;
  if (!existsSync(join(slimDir, "main.js"))) {
    return `slim server artifact not built: ${slimDir}/main.js (node scripts/bundle-slim.mjs in the server package)`;
  }
  return "";
}

/**
 * A CLI install in a fresh home, configured with `model`. Nothing is
 * installed until `start`, so a caller holds the home and can stop the
 * daemon however far a start got.
 */
export function createCliInstall({ model, log }) {
  const home = mkdtempSync(join(tmpdir(), "stigmer-smoke-"));
  log(`home=${home}`);
  seedTemporal(home);
  const env = { ...process.env, HOME: home, ...model };
  // The caller's shell must not contaminate the resolution.
  for (const key of ["STIGMER_SERVER_DIR", "STIGMER_RUNNER_DIR", "STIGMER_HOME", "STIGMER_BIN_DIR", "STIGMER_RUNTIMES_DIR"]) {
    delete env[key];
  }
  /** The command a user runs as `stigmer`: the source CLI, or the installed launcher. */
  let command = [];

  const install = (release) => {
    if (release.kind === "published") {
      const binDir = join(home, "bin");
      log(`install.sh STIGMER_VERSION=${release.version}`);
      const result = spawnSync("sh", [installScript], {
        env: { ...env, STIGMER_VERSION: release.version, STIGMER_BIN_DIR: binDir },
        encoding: "utf8",
        timeout: INSTALL_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      if (result.status !== 0) {
        throw new Error(`install.sh exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }
      delete env.STIGMER_SERVER_DIR;
      command = [join(binDir, "stigmer")];
      return;
    }
    const missing = sourceCliMissing();
    if (missing !== "") throw new Error(missing);
    // Stage the slim artifact in the server-package shape the CLI resolves
    // (dist/main.js under a package dir). The staged dist keeps the
    // artifact's own siblings (workflow bundles, worker-thread entry, staged
    // node_modules, its untyped package.json, the CJS marker) exactly as an
    // acquired @stigmer/server-slim install lays them out.
    const pkgDir = join(home, "server-pkg");
    rmSync(pkgDir, { recursive: true, force: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "@stigmer/server", private: true }, null, 2));
    cpSync(slimDir, join(pkgDir, "dist"), { recursive: true });
    env.STIGMER_SERVER_DIR = pkgDir;
    command = [tsxBin, cliEntry];
  };

  const stack = {
    home,
    env,
    baseUrl: `http://127.0.0.1:${CLI_SERVER_PORT}`,
    /**
     * Run `stigmer <args>` to its exit. Resolves `{ status, stdout, stderr }`;
     * a non-zero exit or a timeout throws unless `allowFailure`.
     */
    async cli(args, { timeoutMs = 60_000, allowFailure = false } = {}) {
      const label = `stigmer ${args.join(" ")}`;
      log(label);
      const result = await runAsync(command, args, env, timeoutMs);
      if (allowFailure) return result;
      if (result.error) throw new Error(`${label} failed: ${result.error.message}`);
      if (result.status !== 0) {
        throw new Error(`${label} exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      }
      return result;
    },
    /** Install `release`, then `stigmer up`. */
    async start(release) {
      install(release);
      await stack.cli(["up", "--no-web"], { timeoutMs: UP_TIMEOUT_MS });
    },
    /** `stigmer down`, the new CLI, `stigmer up` on the same home: the whole of a CLI upgrade. */
    async upgrade(release) {
      await stack.cli(["down"]);
      install(release);
      await stack.cli(["up", "--no-web"], { timeoutMs: UP_TIMEOUT_MS });
    },
    /** The running server's command line, from the daemon's own PID file. */
    serverCommand() {
      const pidFile = join(home, ".stigmer", "data", "stigmer-server.pid");
      const pid = readFileSync(pidFile, "utf8").trim().split("\n")[0].trim();
      return { pid, command: execFileSync("ps", ["-p", pid, "-o", "command="], { encoding: "utf8" }).trim() };
    },
    /** What the stack runs: the server process's entry (a runtime directory, or the staged package). */
    async images() {
      return { server: stack.serverCommand().command };
    },
    diagnostics() {
      const logsDir = join(home, ".stigmer", "data", "logs");
      if (!existsSync(logsDir)) return `--- no logs under ${logsDir} ---`;
      return readdirSync(logsDir)
        .filter((file) => file.endsWith(".log"))
        .map((file) => {
          const lines = readFileSync(join(logsDir, file), "utf8").trimEnd().split("\n");
          return [`--- ${file} (last 40 lines) ---`, ...lines.slice(-40)].join("\n");
        })
        .join("\n");
    },
    /** `stigmer down` (idempotent when nothing runs), then the home removed unless `keepHome`. */
    async stop({ keepHome = false } = {}) {
      if (command.length > 0) {
        const [bin, ...prefix] = command;
        spawnSync(bin, [...prefix, "down"], { env, encoding: "utf8", timeout: 60_000 });
      }
      if (keepHome) log(`home kept for debugging: ${home}`);
      else rmSync(home, { recursive: true, force: true });
    },
  };
  return stack;
}

/**
 * Seed a PATH-resolvable Temporal binary into the managed location when the
 * host has one, so `up` skips the manager's one-time download. Purely an
 * accelerator: absent it, `up` downloads exactly as a real first run does.
 */
function seedTemporal(home) {
  try {
    const hostTemporal = execFileSync("which", ["temporal"], { encoding: "utf8" }).trim();
    if (hostTemporal !== "") {
      mkdirSync(join(home, ".stigmer", "bin"), { recursive: true });
      cpSync(hostTemporal, join(home, ".stigmer", "bin", "temporal"));
    }
  } catch {
    // No host temporal — the manager downloads its own.
  }
}

/**
 * One command to its exit, in its own process group so a timeout kills the
 * whole tree: tsx runs the CLI in a child node process, and a killed tsx
 * alone leaves that child holding the output pipes open.
 */
function runAsync([bin, ...prefix], args, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(bin, [...prefix, ...args], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
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
      resolve({ status, stdout, stderr, error: timedOut ? new Error(`timed out after ${timeoutMs}ms`) : undefined });
    });
  });
}
