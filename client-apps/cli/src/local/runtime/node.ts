// Resolution of the Node.js runtime used to launch the runner subprocess.
//
// We reuse the very Node that is running the CLI (process.execPath). The CLI is
// itself an npm package with `engines: node >= 22.13`, so a suitable Node is
// always present by construction — there is deliberately no hermetic Node
// download (DD-002: keep the base install lean; nothing to acquire that the host
// already guarantees). This is exactly what the conformance harness does
// (`spawn(process.execPath, ...)`). An explicit STIGMER_NODE_BIN override is
// honored and version-checked for advanced/multi-runtime setups.

import { execFileSync } from "node:child_process";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";

/**
 * Minimum Node version the runner requires: 22.13. The runner's durable local
 * checkpointer imports Node's built-in `node:sqlite`, which is only available
 * WITHOUT the --experimental-sqlite flag from v22.13 (and v23.4) onward. A
 * major-only gate would let 22.0-22.12 pass and then crash at checkpointer
 * creation, so the minor is enforced when the major is exactly 22.
 */
export const MIN_NODE_MAJOR = 22;
export const MIN_NODE_MINOR_ON_MAJOR = 13;

interface NodeVersion {
  major: number;
  minor: number;
}

/**
 * Resolve the Node binary to launch the runner with. Honors STIGMER_NODE_BIN
 * (version-checked); otherwise returns the current runtime.
 */
export function resolveNode(): string {
  const override = process.env.STIGMER_NODE_BIN;
  if (override !== undefined && override !== "") {
    assertVersion(override, probeNodeVersion(override));
    return override;
  }
  // The CLI's own runtime: version is readable directly, no subprocess needed.
  assertVersion(process.execPath, parseVersion(process.versions.node));
  return process.execPath;
}

function probeNodeVersion(bin: string): NodeVersion | null {
  try {
    const out = execFileSync(bin, ["--version"], { encoding: "utf8" });
    return parseVersion(out.trim());
  } catch {
    return null;
  }
}

// Parses "v22.22.2" or "22.22.2" to its major/minor numbers.
function parseVersion(version: string): NodeVersion | null {
  const match = /^v?(\d+)\.(\d+)\./.exec(version.trim());
  if (match === null) return null;
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return null;
  return { major, minor };
}

// True when the version is at or above the 22.13 floor.
function meetsFloor(v: NodeVersion): boolean {
  if (v.major > MIN_NODE_MAJOR) return true;
  return v.major === MIN_NODE_MAJOR && v.minor >= MIN_NODE_MINOR_ON_MAJOR;
}

function assertVersion(bin: string, version: NodeVersion | null): void {
  const floor = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR_ON_MAJOR}`;
  if (version === null) {
    throw new CliExitError(`could not determine the Node version of ${bin}`, ExitCode.General, [
      `Ensure ${bin} is a working Node >= ${floor} runtime.`,
    ]);
  }
  if (!meetsFloor(version)) {
    throw new CliExitError(
      `Node >= ${floor} is required to run the runner ` +
        `(found ${version.major}.${version.minor} at ${bin})`,
      ExitCode.General,
      [`Upgrade Node to ${floor} or newer, or point STIGMER_NODE_BIN at one.`],
    );
  }
}
