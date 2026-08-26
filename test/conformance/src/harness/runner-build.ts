// Builds the TypeScript unified runner (@stigmer/runner) from source so the
// execution harness always tests HEAD.
// Domain: conformance harness (execution engine).
//
// We delegate to `make build-runner` rather than re-encode
// the npm ordering here: that target is the maintained single entry that builds
// the @stigmer/protos dist, installs the runner's own node_modules (the runner
// is NOT a root npm workspace member), and compiles dist/ — including the
// dist/.build-fingerprint that the runner's stale-build guard checks. Building
// fresh in setup is what keeps that guard from refusing to start (exit 78).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Repo root is four levels up from test/conformance/src/harness/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const RUNNER_DIR = join(REPO_ROOT, "backend", "services", "runner");

// The compiled static-mode entry point the runner-process launcher spawns.
export function runnerEntryPath(): string {
  return join(RUNNER_DIR, "dist", "main.js");
}

export function runnerDir(): string {
  return RUNNER_DIR;
}

export async function buildRunner(): Promise<string> {
  await execFileAsync("make", ["build-runner"], {
    cwd: REPO_ROOT,
    // The build pulls a large dependency graph (protos + runner install +
    // tsc); raise the stdio buffer so a verbose toolchain stream cannot abort
    // the build.
    maxBuffer: 64 * 1024 * 1024,
  });
  return runnerEntryPath();
}

// Used as a fallback when a single suite file runs without global-setup (e.g.
// from an editor). Reuse an existing build if present; otherwise build fresh.
export async function ensureRunnerBuilt(): Promise<string> {
  const entry = runnerEntryPath();
  if (existsSync(entry)) return entry;
  return buildRunner();
}
