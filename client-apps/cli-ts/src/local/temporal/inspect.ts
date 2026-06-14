// Process-identity check guarding against PID reuse.
//
// A PID file can outlive the process it named; the OS may then assign that PID
// to something unrelated. Before trusting a PID as "our Temporal", we confirm
// the live process's command line actually looks like the Temporal dev server.
// POSIX-only (uses `ps`); returns false on any uncertainty.

import { execFileSync } from "node:child_process";

/** Full command line of a process via `ps`, or null if it cannot be read. */
export function processCommandLine(pid: number): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Heuristically confirm that `pid` is the Temporal server we manage: its command
 * line mentions "temporal" and either our binary path or a "server" subcommand.
 */
export function isLikelyTemporal(pid: number, binPath: string): boolean {
  const cmd = processCommandLine(pid);
  if (cmd === null) return false;
  const lower = cmd.toLowerCase();
  if (!lower.includes("temporal")) return false;
  return cmd.includes(binPath) || lower.includes("server");
}
