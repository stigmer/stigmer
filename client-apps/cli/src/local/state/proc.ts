// OS-level process queries used by supervision and status.
//
// Liveness is a signal-0 probe (no signal delivered, only permission/existence
// checked). The port-based lookup is a
// fallback for locating the daemon when its PID file is missing; it shells to
// `lsof`, so it is POSIX-only and best-effort (returns null on any failure).
//
// A live PID is not yet an identity: once a process is gone the OS may hand
// its number to anything (stigmer#2750). processStartTime reads when a process
// started, which together with its PID names one process for the life of the
// machine; the PID files record it so a reader can tell the process it started
// from a stranger that inherited the number.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Report whether `pid` names a live process OTHER than this one — the question
 * every stale-state reader (a PID file, a lock file's owner) actually asks.
 *
 * A recorded PID equal to our own can never be a live peer: we did not write it
 * in this life, so it is a leftover from a previous process that happened to
 * get the same number. That happens deterministically in a container (every
 * start is a fresh PID namespace, so the daemon lands on the same low PID it
 * had before the unclean stop) and occasionally on a laptop after a reboot.
 * Treating such a PID as "alive" makes a launcher SIGTERM itself or refuse a
 * lock it could never have been holding.
 */
export function isOtherLiveProcess(pid: number): boolean {
  return pid !== process.pid && isProcessAlive(pid);
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

/**
 * The command line of a live process via `ps`, or null when it cannot be read.
 * POSIX-only and best-effort, like findProcessByPort, whose answer it names.
 */
export function processCommand(pid: number): string | null {
  let output: string;
  try {
    output = execFileSync("ps", ["-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const command = output.trim();
  return command === "" ? null : command;
}

/** Where the kernel publishes process metadata on Linux; null where it does not. */
const DEFAULT_PROC_ROOT: string | null = process.platform === "linux" ? "/proc" : null;

export interface ProcessStartOptions {
  /**
   * Root of a procfs tree to read `<pid>/stat` and `sys/kernel/random/boot_id`
   * from. Defaults to `/proc` on Linux and to none elsewhere; tests point it at
   * a fixture directory, or pass null to force the `ps` reader.
   */
  procRoot?: string | null;
}

/**
 * When `pid` started, as an opaque token compared only for equality with a
 * token read earlier for the same PID, or null when it cannot be read.
 *
 * Two readers, in order, the same shape as `temporal/inspect.ts` and for the
 * same reason (a minimal container has no `ps`):
 *
 * - Linux: `<boot id>:<start ticks>`. Field 22 of `/proc/<pid>/stat` counts
 *   clock ticks since boot, so a machine that boots the same way every time (a
 *   CI image, a VM) can give a new process the old PID and the old tick; the
 *   boot id tells two boots apart. A procfs that hides the boot id (a sandbox)
 *   gives the ticks alone, a weaker token rather than none.
 * - Elsewhere, or where `/proc` is unreadable: `ps -o lstart=`, the start
 *   second in wall-clock time. `ps` prints it in the caller's zone and locale,
 *   and the writer (the daemon) and a later reader (a CLI in another shell) may
 *   differ in both, so it is always read under `TZ=UTC LC_ALL=C`.
 */
export function processStartTime(pid: number, options: ProcessStartOptions = {}): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const procRoot = options.procRoot === undefined ? DEFAULT_PROC_ROOT : options.procRoot;
  if (procRoot !== null) {
    const fromProc = procStartTime(procRoot, pid);
    if (fromProc !== null) return fromProc;
  }
  return psStartTime(pid);
}

// The command name (field 2) sits in parentheses and may itself hold spaces
// and parentheses, so fields are counted after the LAST ")": the first one
// there is field 3 (state), which puts field 22 (starttime) at index 19.
function procStartTime(procRoot: string, pid: number): string | null {
  let stat: string;
  try {
    stat = readFileSync(join(procRoot, String(pid), "stat"), "utf8");
  } catch {
    return null;
  }
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const ticks = stat.slice(close + 1).trim().split(/\s+/)[19];
  if (ticks === undefined || !/^\d+$/.test(ticks)) return null;
  let bootId = "";
  try {
    bootId = readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim();
  } catch {
    // Hidden boot id: the ticks alone.
  }
  return bootId === "" ? ticks : `${bootId}:${ticks}`;
}

function psStartTime(pid: number): string | null {
  let output: string;
  try {
    output = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      env: { ...process.env, TZ: "UTC", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
  const started = output.trim().replace(/\s+/g, " ");
  return started === "" ? null : started;
}
