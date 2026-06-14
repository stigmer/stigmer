// A single-instance file lock built on atomic O_EXCL file creation.
//
// Node has no portable `flock`, so the lock is a file whose existence is the
// lock and whose contents are the owning PID. Creation uses the "wx" flag
// (O_CREAT | O_EXCL), which is atomic on POSIX and Windows, so two racing
// acquirers cannot both win. If the file already exists we read the owner PID:
// a dead owner means a stale lock we may reclaim; a live owner means the lock
// is genuinely held. This guards the Temporal dev server against double-start
// the way the Go CLI's flock does, without a native dependency.

import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isProcessAlive } from "./proc.js";

/** A held lock. Call release() exactly once when done. */
export interface FileLock {
  readonly path: string;
  release(): void;
}

/**
 * Try to acquire the lock at `path`. Returns a FileLock on success, or null if
 * the lock is held by a live process. A lock left behind by a dead process is
 * reclaimed automatically.
 */
export function acquireLock(path: string): FileLock | null {
  mkdirSync(dirname(path), { recursive: true });

  if (tryCreate(path)) return makeLock(path);

  // The lock file exists. Reclaim it only if its owner is gone.
  const owner = readOwner(path);
  if (owner !== null && isProcessAlive(owner)) {
    return null; // genuinely held by a live process
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
  let released = false;
  return {
    path,
    release(): void {
      if (released) return;
      released = true;
      // Only remove the file if we still own it, so we never delete a lock a
      // different process acquired after ours was (somehow) gone.
      if (readOwner(path) === process.pid) rmSync(path, { force: true });
    },
  };
}
