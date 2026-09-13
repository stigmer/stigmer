// Process-identity check guarding against PID reuse.
//
// A PID file can outlive the process it named; the OS may then assign that PID
// to something unrelated. Before trusting a PID as "our Temporal", we confirm
// the live process's command line actually looks like the Temporal dev server.
//
// Two readers, in order. On Linux the kernel publishes every process's command
// line at /proc/<pid>/cmdline (NUL-separated argv), which needs no external
// program — the reader that works inside a minimal container. Everywhere else
// (and on a Linux where /proc is unreadable) we shell out to `ps`, the
// POSIX-portable answer. Returns null on any uncertainty; callers treat null
// as "not Temporal", which is the safe direction for a PID-reuse guard.
//
// Why the /proc reader exists: `node:22-slim` and its kin ship no `ps`. With
// `ps` as the only reader, every liveness probe answered "not Temporal", the
// supervisor restarted a healthy dev server every tick, and each restart spawned
// a second process that failed to bind while the first kept the port. A
// dependency on a userland tool is the wrong shape for a liveness check that
// the kernel can answer directly.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Where the kernel publishes process metadata on Linux; null where it does not. */
const DEFAULT_PROC_ROOT: string | null = process.platform === "linux" ? "/proc" : null;

export interface ProcessInspectOptions {
  /**
   * Root of a procfs tree to read `<pid>/cmdline` from. Defaults to `/proc` on
   * Linux and to none elsewhere; tests point it at a fixture directory.
   */
  procRoot?: string | null;
}

/** Full command line of a process, or null if it cannot be read. */
export function processCommandLine(pid: number, options: ProcessInspectOptions = {}): string | null {
  const procRoot = options.procRoot === undefined ? DEFAULT_PROC_ROOT : options.procRoot;
  if (procRoot !== null) {
    const fromProc = readProcCmdline(procRoot, pid);
    if (fromProc !== null) return fromProc;
  }
  return psCommandLine(pid);
}

/**
 * Heuristically confirm that `pid` is the Temporal server we manage: its command
 * line mentions "temporal" and either our binary path or a "server" subcommand.
 */
export function isLikelyTemporal(pid: number, binPath: string, options: ProcessInspectOptions = {}): boolean {
  const cmd = processCommandLine(pid, options);
  if (cmd === null) return false;
  const lower = cmd.toLowerCase();
  if (!lower.includes("temporal")) return false;
  return cmd.includes(binPath) || lower.includes("server");
}

// /proc/<pid>/cmdline is argv joined by NUL bytes (with a trailing NUL). An
// empty file means a zombie or a kernel thread — nothing we can name, so null
// lets the caller fall through to `ps`.
function readProcCmdline(procRoot: string, pid: number): string | null {
  try {
    const raw = readFileSync(join(procRoot, String(pid), "cmdline"), "utf8");
    const argv = raw.split("\0").filter((arg) => arg !== "");
    return argv.length === 0 ? null : argv.join(" ");
  } catch {
    return null;
  }
}

function psCommandLine(pid: number): string | null {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}
