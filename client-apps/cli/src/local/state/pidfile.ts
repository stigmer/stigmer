// PID-file read/write/remove helpers.
//
// PID files are how the daemon, its children, and a fresh CLI invocation find
// each other across process boundaries. Some PID files written by other tools
// (notably Temporal's) carry extra lines after the PID; readPidFile reads only
// the first line so it tolerates both single-line and multi-line formats.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Write a PID file (creating its directory if needed). */
export function writePidFile(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${pid}\n`, "utf8");
}

/**
 * Read a PID from a PID file. Returns null if the file is missing or its first
 * line is not a positive integer, so callers branch on presence rather than
 * catching exceptions.
 */
export function readPidFile(path: string): number | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const firstLine = raw.split("\n", 1)[0]?.trim() ?? "";
  const pid = Number.parseInt(firstLine, 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Remove a PID file. Best-effort: a missing file is not an error. */
export function removePidFile(path: string): void {
  rmSync(path, { force: true });
}
