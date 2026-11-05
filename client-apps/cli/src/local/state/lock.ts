// A single-instance file lock built on atomic O_EXCL file creation.
//
// Node has no portable `flock`, so the lock is a file whose existence is the
// lock and whose contents are the owner's PID record (state/pidfile.ts): its
// PID, and when that process started. Creation uses the "wx" flag
// (O_CREAT | O_EXCL), which is atomic on POSIX and Windows, so two racing
// acquirers cannot both win. If the file already exists the owner is judged as
// every PID reader judges a record, through recordedLiveProcess: a live peer
// that is still the process recorded holds the lock; anything else is stale
// and reclaimed. That covers a dead owner, our own PID from a previous life
// (we hold a lock only if it is tracked in-process), and a number the OS has
// since handed to another program, which would otherwise hold the lock until
// the file was deleted by hand (stigmer#2900). This guards the Temporal dev
// server against double-start without a native dependency.

import { closeSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pidRecordText, readPidFile, recordedLiveProcess } from "./pidfile.js";

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
 * while we hold it fails). A lock left behind by a dead process, by a past
 * process that had our pid, or by a process whose number now belongs to
 * another program is reclaimed automatically.
 */
export function acquireLock(path: string): FileLock | null {
  mkdirSync(dirname(path), { recursive: true });

  if (heldInProcess.has(path)) return null; // held right here, by us

  if (tryCreate(path)) return makeLock(path);

  // The lock file exists. It is held only while it names another live
  // process that is still the one recorded; recordedLiveProcess answers null
  // for our own pid (we just established we are not holding it), a dead
  // owner, an unreadable file, and a number now owned by another program.
  if (recordedLiveProcess(path) !== null) {
    return null; // genuinely held by a live peer
  }

  // Stale (or unreadable) lock: remove and retry exactly once. A failure on the
  // retry means another process raced us to it — treat the lock as held.
  rmSync(path, { force: true });
  return tryCreate(path) ? makeLock(path) : null;
}

function tryCreate(path: string): boolean {
  // Read before the create: the file is empty, and so unowned to a racing
  // reader, from the open until the write, and reading the start time can
  // spawn `ps`.
  const record = pidRecordText(process.pid);
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, record, "utf8");
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
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
      if (readPidFile(path) === process.pid) rmSync(path, { force: true });
    },
  };
}
