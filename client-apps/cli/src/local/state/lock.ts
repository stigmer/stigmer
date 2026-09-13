// A single-instance file lock built on atomic O_EXCL file creation.
//
// Node has no portable `flock`, so the lock is a file whose existence is the
// lock and whose contents are the owning PID. Creation uses the "wx" flag
// (O_CREAT | O_EXCL), which is atomic on POSIX and Windows, so two racing
// acquirers cannot both win. If the file already exists we read the owner PID:
// a live peer means the lock is genuinely held; a dead owner means a stale
// lock we may reclaim; an owner PID that is OUR OWN is held only if this
// process is actually holding it (tracked in-process), otherwise it is a
// leftover from a previous life of the PID (see isOtherLiveProcess) and stale.
// This guards the Temporal dev server against double-start the way the Go
// CLI's flock does, without a native dependency.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isOtherLiveProcess } from "./proc.js";

/** A held lock. Call release() exactly once when done. */
export interface FileLock {
  readonly path: string;
  release(): void;
}

// Lock paths this process currently holds. A lock file naming OUR pid is
// genuinely held only if it is in here; otherwise it is a leftover from a
// previous life of the pid (a restarted container, a rebooted laptop) and is
// reclaimed like any other stale lock.
const heldInProcess = new Set<string>();

/**
 * Try to acquire the lock at `path`. Returns a FileLock on success, or null if
 * the lock is held by a live process (this one included — a second acquire
 * while we hold it fails). A lock left behind by a dead process, or by a past
 * process that had our pid, is reclaimed automatically.
 */
export function acquireLock(path: string): FileLock | null {
  mkdirSync(dirname(path), { recursive: true });

  if (heldInProcess.has(path)) return null; // held right here, by us

  if (tryCreate(path)) return makeLock(path);

  // The lock file exists. Reclaim it only if its owner is gone, or is our own
  // pid from a previous life (we just established we are not holding it).
  const owner = readOwner(path);
  if (owner !== null && isOtherLiveProcess(owner)) {
    return null; // genuinely held by a live peer
  }

  // Stale (or unreadable) lock: remove and retry exactly once. A failure on the
  // retry means another process raced us to it — treat the lock as held.
  rmSync(path, { force: true });
  return tryCreate(path) ? makeLock(path) : null;
}

function tryCreate(path: string): boolean {
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, `${process.pid}\n`, "utf8");
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

function readOwner(path: string): number | null {
  try {
    const firstLine = readFileSync(path, "utf8").split("\n", 1)[0]?.trim() ?? "";
    const pid = Number.parseInt(firstLine, 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function makeLock(path: string): FileLock {
  heldInProcess.add(path);
  let released = false;
  return {
    path,
    release(): void {
      if (released) return;
      released = true;
      heldInProcess.delete(path);
      // Only remove the file if we still own it, so we never delete a lock a
      // different process acquired after ours was (somehow) gone.
      if (readOwner(path) === process.pid) rmSync(path, { force: true });
    },
  };
}
