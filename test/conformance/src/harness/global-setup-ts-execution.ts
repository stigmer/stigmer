// Vitest global setup for the local-ts-execution roster (Class B on the
// TS server): global-setup-execution.ts's twin with the TS-server build in
// place of the Go build.
// Domain: conformance harness (execution engine).
//
// Pays the cold builds (TS server + TS runner) once here, off the per-file
// hook budget, and fails fast with an actionable message if the `temporal`
// CLI is missing — far clearer than a mid-suite connection timeout.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRunner } from "./runner-build";
import { buildTsServer } from "./ts-build";

const execFileAsync = promisify(execFile);

export default async function setup(): Promise<void> {
  await assertTemporalCli();
  // Build fresh so both entries are HEAD and the runner's stale-build guard
  // (dist/.build-fingerprint vs src) is satisfied for the from-dist launch.
  await buildTsServer();
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
