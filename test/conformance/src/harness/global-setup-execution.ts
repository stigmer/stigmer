// Vitest global setup for the execution-engine suites (Class B).
// Domain: conformance harness (execution engine).
//
// Pays the cold builds (Go server + TS runner) once here, off the per-file hook
// budget, and fails fast with an actionable message if the `temporal` CLI is
// missing — far clearer than a mid-suite connection timeout. The CRUD slice's
// global-setup.ts is deliberately left untouched (server-only, no Temporal), so
// the dependency-light Class A signal stays fast (DD-002).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildServer } from "./go-build";
import { buildRunner } from "./runner-build";

const execFileAsync = promisify(execFile);

export default async function setup(): Promise<void> {
  await assertTemporalCli();
  // Build fresh so both binaries are HEAD and the runner's stale-build guard
  // (dist/.build-fingerprint vs src) is satisfied for the from-dist launch.
  await buildServer();
  await buildRunner();
}

async function assertTemporalCli(): Promise<void> {
  try {
    await execFileAsync("temporal", ["--version"]);
  } catch (err) {
    throw new Error(
      "the `temporal` CLI is required for the execution suites but was not found on PATH " +
        "(install it with `brew install temporal`, or see https://docs.temporal.io/cli). " +
        `underlying error: ${String(err)}`,
    );
  }
}
