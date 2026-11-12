// A single-instance file lock built on atomic file creation.
//
// Node has no portable `flock`, so the lock is a file whose existence is the
// lock and whose contents are the owner's PID record (state/pidfile.ts): its
// PID, when that process started, and a `lock=` token drawn once per
// acquisition, so no two lock files are ever byte-identical (a Windows record
// has no start time, and a reused PID would otherwise read the same). If the
// file already exists the owner is judged as every PID reader judges a record,
// through liveRecordedProcess: a live peer that is still the process recorded
// holds the lock; anything else is stale and reclaimed. That covers a dead
// owner, our own PID from a previous life (we hold a lock only if it is tracked
// in-process), and a number the OS has since handed to another program, which
// would otherwise hold the lock until the file was deleted by hand
// (stigmer#2900). This guards the Temporal dev server against double-start
// without a native dependency.
//
// Two races once let two acquirers both hold it (stigmer#2993):
//
// - Create. Opening with O_EXCL and then writing left the lock's name empty in
//   between, and a racing acquirer reads an empty lock as unowned and reclaims
//   it. The record is now written beside the lock and hard-linked into place;
//   a link fails with EEXIST like O_EXCL, and the name is never seen empty. A
//   filesystem without hard links (EPERM, ENOTSUP, ENOSYS: FAT, some SMB and
//   FUSE mounts) falls back to the open-then-write, and keeps its empty window.
// - Reclaim. Two acquirers that judged the same stale lock both removed it, and
//   the second removal could take the first's fresh lock. A reclaimer now
//   renames the lock aside, which only one can do to a given file, and keeps it
//   gone only if the moved file holds exactly the bytes it judged; otherwise a
//   peer had already reclaimed it, and the peer's lock is put back.
//
// One window remains: a third acquirer that creates the lock between a
// reclaimer's move-aside and its put-back loses its file to the put-back, and
// two would hold the lock. It takes three `stigmer up` runs within
// microseconds over a dead owner's leftover lock; closing it needs a kernel
// lock, which Node has no portable way to take.

import { randomBytes } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { liveRecordedProcess, parsePidRecord, pidRecordText } from "./pidfile.js";

/** A held lock. Call release() exactly once when done. */
export interface FileLock {
  readonly path: string;
  release(): void;
}

// What a hard link answers on a filesystem that has none.
const NO_HARD_LINKS = new Set(["EPERM", "ENOTSUP", "ENOSYS"]);

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

  // Composed before any create: reading the start time can spawn `ps`.
  const text = `${pidRecordText(process.pid)}lock=${randomBytes(8).toString("hex")}\n`;
  if (tryCreate(path, text)) return makeLock(path, text);

  // The lock file exists. Read it once and judge those bytes: it is held only
  // while it names another live process that is still the one recorded.
  // liveRecordedProcess answers null for our own pid (we just established we
  // are not holding it), a dead owner, an unreadable record, and a number now
  // owned by another program.
  const judged = unlessMissing(() => readFileSync(path, "utf8"));
  if (judged === null) return createOnce(path, text); // its owner released it just now
  if (liveRecordedProcess(parsePidRecord(judged), basename(path)) !== null) {
    return null; // genuinely held by a live peer
  }

  // Stale: move it aside, which only one reclaimer can do to a given file.
  const aside = `${path}.${process.pid}.stale`;
  const moved = unlessMissing(() => {
    renameSync(path, aside);
    return true;
  });
  if (moved === null) return createOnce(path, text); // a peer moved it first
  if (readFileSync(aside, "utf8") !== judged) {
    // Not the file judged: a peer reclaimed the stale lock and holds it now.
    renameSync(aside, path);
    return null;
  }
  rmSync(aside, { force: true });
  return createOnce(path, text);
}

/** One more create; losing it means a peer took the lock first. */
function createOnce(path: string, text: string): FileLock | null {
  return tryCreate(path, text) ? makeLock(path, text) : null;
}

/** Create the lock holding `text` in one step; false when it already exists. */
function tryCreate(path: string, text: string): boolean {
  const temp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temp, text, "utf8");
    try {
      linkSync(temp, path);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (code === "EEXIST") return false;
      if (!NO_HARD_LINKS.has(code)) throw err;
    }
  } finally {
    rmSync(temp, { force: true });
  }
  return createInPlace(path, text);
}

/** The create without hard links: the name is empty from the open until the write. */
function createInPlace(path: string, text: string): boolean {
  try {
    const fd = openSync(path, "wx");
    try {
      writeFileSync(fd, text, "utf8");
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

/** `act`'s answer, or null when the file it touches is gone (ENOENT). */
function unlessMissing<T>(act: () => T): T | null {
  try {
    return act();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function makeLock(path: string, text: string): FileLock {
  heldInProcess.add(path);
  let released = false;
  return {
    path,
    release(): void {
      if (released) return;
      released = true;
      heldInProcess.delete(path);
      // Only remove the file while it is still the one this lock wrote, token
      // and all, so we never delete a lock another process acquired after ours
      // was (somehow) gone, even one that has our PID.
      let current: string | null = null;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        // gone already, or unreadable: nothing of ours to remove
      }
      if (current === text) rmSync(path, { force: true });
    },
  };
}
