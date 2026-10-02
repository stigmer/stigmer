// A run's state file: what a harness's global setup hands to its workers and
// to its own teardown, stamped with the process that wrote it.
// Domain: test support (stack spawns).
//
// The stamp is what lets a teardown tell its own run's file from one an
// earlier run left behind. A run that is killed, or whose teardown fails
// before the file is removed, leaves the file in place; a later run that
// boots nothing (an external target, a setup that refuses early) would
// otherwise read it as its own and report a stack it never started
// (stigmer#1594). takeRunState hands a teardown only the file its own process
// wrote; it removes a file whose writer has exited, and leaves one whose
// writer is still running, since that run's workers may still be reading it.

import * as fs from "node:fs";

/** The field the stamp is written under. A state never carries its own. */
const WRITER = "writerPid";

/** What a teardown found where its run's state file goes. */
export type RunStateTake<T> =
  /** No file: this run wrote none. */
  | { readonly kind: "none" }
  /** This process wrote it; it has been removed. */
  | { readonly kind: "own"; readonly state: T }
  /** A process that has exited wrote it, or it has no stamp or does not parse; it has been removed. */
  | { readonly kind: "stale"; readonly writerPid: number | undefined }
  /** Another process that is still running wrote it; it is left in place. */
  | { readonly kind: "live-elsewhere"; readonly writerPid: number };

/** Writes `state` to `file`, stamped with this process's pid. */
export function writeRunState(file: string, state: object): void {
  fs.writeFileSync(file, JSON.stringify({ ...state, [WRITER]: process.pid }, null, 2));
}

/**
 * The state in `file` without its stamp, for a worker reading what setup
 * recorded: undefined when there is no file or it does not parse.
 */
export function readRunState<T>(file: string): T | undefined {
  const stamped = readStamped(file);
  return stamped === undefined ? undefined : (stamped.state as T);
}

/**
 * Takes the state in `file` for a teardown: this process's own file is
 * removed and returned; any other is reported, and removed only when no
 * running process can still be using it.
 */
export function takeRunState<T>(file: string): RunStateTake<T> {
  if (!fs.existsSync(file)) return { kind: "none" };
  const stamped = readStamped(file);
  const writerPid = stamped?.writerPid;
  if (writerPid === process.pid && stamped !== undefined) {
    fs.rmSync(file, { force: true });
    return { kind: "own", state: stamped.state as T };
  }
  if (writerPid !== undefined && isRunning(writerPid)) return { kind: "live-elsewhere", writerPid };
  fs.rmSync(file, { force: true });
  return { kind: "stale", writerPid };
}

function readStamped(file: string): { state: object; writerPid: number | undefined } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const { [WRITER]: writer, ...state } = parsed as Record<string, unknown>;
  return { state, writerPid: typeof writer === "number" ? writer : undefined };
}

/** Whether a process with this pid exists: signal 0 checks without sending; EPERM means it exists under another user. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
