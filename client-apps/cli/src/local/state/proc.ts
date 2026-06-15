// OS-level process queries used by supervision and status.
//
// Liveness is a signal-0 probe (no signal delivered, only permission/existence
// checked) — the same mechanism the Go CLI uses. The port-based lookup is a
// fallback for locating the daemon when its PID file is missing; it shells to
// `lsof`, so it is POSIX-only and best-effort (returns null on any failure).

import { execFileSync } from "node:child_process";

/** Report whether a process with the given PID currently exists. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but is owned by another user — still alive.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Send a signal to a single process. Returns false if the process is gone. */
export function killProcess(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

/**
 * Signal an entire process group (POSIX: kill(-pid)). The target must have been
 * spawned as a group leader (`detached: true`) for this to reach its children.
 * Returns false if the group is already gone.
 */
export function killProcessGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // Fall back to signaling just the leader (e.g. non-POSIX or already reaped).
    return killProcess(pid, signal);
  }
}

/**
 * Find the PID of the process listening on a TCP port via `lsof`. Returns null
 * if nothing is listening or `lsof` is unavailable. POSIX-only fallback.
 */
export function findProcessByPort(port: number): number | null {
  let output: string;
  try {
    output = execFileSync("lsof", ["-t", "-i", `:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const firstLine = output.split("\n").find((line) => line.trim() !== "");
  if (firstLine === undefined) return null;
  const pid = Number.parseInt(firstLine.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}
