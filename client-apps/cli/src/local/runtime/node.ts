// Resolution of the Node.js runtime used to launch the runner subprocess.
//
// We reuse the very Node that is running the CLI (process.execPath). The CLI is
// itself an npm package with `engines: node >= 20`, so a suitable Node is always
// present by construction — there is deliberately no hermetic Node download
// (DD-002: keep the base install lean; nothing to acquire that the host already
// guarantees). This is exactly what the conformance harness does
// (`spawn(process.execPath, ...)`). An explicit STIGMER_NODE_BIN override is
// honored and version-checked for advanced/multi-runtime setups.

import { execFileSync } from "node:child_process";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";

/** Minimum Node major version the runner requires. */
export const MIN_NODE_MAJOR = 20;

/**
 * Resolve the Node binary to launch the runner with. Honors STIGMER_NODE_BIN
 * (version-checked); otherwise returns the current runtime.
 */
export function resolveNode(): string {
  const override = process.env.STIGMER_NODE_BIN;
  if (override !== undefined && override !== "") {
    assertVersion(override, probeNodeMajor(override));
    return override;
  }
  // The CLI's own runtime: major is readable directly, no subprocess needed.
  assertVersion(process.execPath, currentMajor());
  return process.execPath;
}

function currentMajor(): number | null {
  return parseMajor(process.versions.node);
}

function probeNodeMajor(bin: string): number | null {
  try {
    const out = execFileSync(bin, ["--version"], { encoding: "utf8" });
    return parseMajor(out.trim());
  } catch {
    return null;
  }
}

// Parses "v22.22.2" or "22.22.2" to its major number.
function parseMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version.trim());
  if (match === null) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isInteger(major) ? major : null;
}

function assertVersion(bin: string, major: number | null): void {
  if (major === null) {
    throw new CliExitError(`could not determine the Node version of ${bin}`, ExitCode.General, [
      `Ensure ${bin} is a working Node >= ${MIN_NODE_MAJOR} runtime.`,
    ]);
  }
  if (major < MIN_NODE_MAJOR) {
    throw new CliExitError(
      `Node >= ${MIN_NODE_MAJOR} is required to run the runner (found major ${major} at ${bin})`,
      ExitCode.General,
      [`Upgrade Node to ${MIN_NODE_MAJOR} or newer, or point STIGMER_NODE_BIN at one.`],
    );
  }
}
