// Races on the Temporal start lock (state/lock.ts), stigmer#2993: two
// acquirers must never both come away holding it.
//
// A real second process cannot be timed into a window a few syscalls wide, so
// a partial node:fs mock plays the peer at the exact moment it would act: a
// reader that looks at the lock between each file call of a create, a peer
// that reclaims the same stale lock or moves it aside just before this
// acquirer does, an owner that releases between a lost create and the read, a
// filesystem without hard links. Each case is judged by what is on disk and
// what acquireLock answers, never by which file calls the lock makes.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "../lock.js";
import { readPidFile } from "../pidfile.js";
import { processStartTime } from "../proc.js";

interface Hooks {
  /** The lock path the hooks watch; null watches nothing. */
  lockPath: string | null;
  /** Look at the lock's path before and after every file call of a create. */
  watchVisibility: boolean;
  /** What a reader saw at the lock's path while it held no parseable record. */
  seenUnowned: string[];
  /** Runs once, just before the first removal or move of the lock's path. */
  beforeFirstRemoval: (() => void) | null;
  /** Runs once, just after the first removal or move of the lock's path. */
  afterFirstRemoval: (() => void) | null;
  /** Runs once, when a create of the lock's path finds it already there. */
  onCreateLost: (() => void) | null;
  /** Error codes the next call of each named file function throws. */
  failNext: Map<string, string>;
}

const hooks = vi.hoisted<Hooks>(() => ({
  lockPath: null,
  watchVisibility: false,
  seenUnowned: [],
  beforeFirstRemoval: null,
  afterFirstRemoval: null,
  onCreateLost: null,
  failNext: new Map(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();

  const isLock = (path: unknown): boolean => hooks.lockPath !== null && String(path) === hooks.lockPath;

  // A reader that finds the lock's name holding no PID takes it as unowned.
  const look = (when: string): void => {
    if (!hooks.watchVisibility || hooks.lockPath === null) return;
    let text: string;
    try {
      text = actual.readFileSync(hooks.lockPath, "utf8");
    } catch {
      return; // absent: a reader creates its own, and only one create can win
    }
    const pid = Number.parseInt(text.split("\n")[0] ?? "", 10);
    if (!Number.isInteger(pid) || pid <= 0) hooks.seenUnowned.push(`${when}: ${JSON.stringify(text)}`);
  };

  const failIfAsked = (name: string): void => {
    const code = hooks.failNext.get(name);
    if (code === undefined) return;
    hooks.failNext.delete(name);
    throw Object.assign(new Error(`${code}: simulated by the test`), { code });
  };

  const once = (key: "beforeFirstRemoval" | "afterFirstRemoval" | "onCreateLost"): void => {
    const hook = hooks[key];
    hooks[key] = null;
    hook?.();
  };

  const createLost = (err: unknown, path: unknown): never => {
    if ((err as NodeJS.ErrnoException).code === "EEXIST" && isLock(path)) once("onCreateLost");
    throw err;
  };

  const openSync: typeof actual.openSync = (path, flags, mode) => {
    failIfAsked("openSync");
    look("before openSync");
    let fd: number;
    try {
      fd = actual.openSync(path, flags, mode);
    } catch (err) {
      return createLost(err, path);
    }
    look("after openSync");
    return fd;
  };
  const writeFileSync: typeof actual.writeFileSync = (file, data, options) => {
    look("before writeFileSync");
    actual.writeFileSync(file, data, options);
    look("after writeFileSync");
  };
  const linkSync: typeof actual.linkSync = (existingPath, newPath) => {
    failIfAsked("linkSync");
    look("before linkSync");
    try {
      actual.linkSync(existingPath, newPath);
    } catch (err) {
      createLost(err, newPath);
    }
    look("after linkSync");
  };
  const closeSync: typeof actual.closeSync = (fd) => {
    look("before closeSync");
    actual.closeSync(fd);
    look("after closeSync");
  };
  const rmSync: typeof actual.rmSync = (path, options) => {
    if (isLock(path)) once("beforeFirstRemoval");
    actual.rmSync(path, options);
    if (isLock(path)) once("afterFirstRemoval");
  };
  const renameSync: typeof actual.renameSync = (oldPath, newPath) => {
    if (isLock(oldPath)) once("beforeFirstRemoval");
    actual.renameSync(oldPath, newPath);
    if (isLock(oldPath)) once("afterFirstRemoval");
  };

  const wrapped = { openSync, writeFileSync, linkSync, closeSync, rmSync, renameSync };
  return { ...actual, ...wrapped, default: { ...actual, ...wrapped } };
});

afterEach(() => {
  hooks.lockPath = null;
  hooks.watchVisibility = false;
  hooks.seenUnowned = [];
  hooks.beforeFirstRemoval = null;
  hooks.afterFirstRemoval = null;
  hooks.onCreateLost = null;
  hooks.failNext.clear();
});

// A PID that is exceedingly unlikely to belong to a live process.
const DEAD_PID = 2 ** 31 - 1;

/** A fresh lock path the hooks watch, in a directory of its own. */
function watchedLock(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-lock-race-"));
  const path = join(dir, "temporal.lock");
  hooks.lockPath = path;
  return { dir, path };
}

/** A lock record naming the live parent process, as a running peer writes it. */
function livePeerRecord(): string {
  const started = processStartTime(process.ppid);
  expect(started, "the parent's start time is readable here").not.toBeNull();
  return `${process.ppid}\nstarted=${started}\nlock=00000000feedface\n`;
}

/** No temporary or moved-aside sibling is left beside the lock. */
function expectOnlyTheLock(dir: string): void {
  expect(readdirSync(dir).filter((name) => name !== "temporal.lock")).toEqual([]);
}

describe("lock races (stigmer#2993)", () => {
  it("never shows a racing reader the lock's name without an owner while creating it", () => {
    const { dir, path } = watchedLock();
    hooks.watchVisibility = true;

    const lock = acquireLock(path);
    hooks.watchVisibility = false;

    expect(lock).not.toBeNull();
    expect(hooks.seenUnowned).toEqual([]);
    expect(readPidFile(path)).toBe(process.pid);
    expectOnlyTheLock(dir);
    lock?.release();
  });

  it("never shows a racing reader the lock's name without an owner while reclaiming a stale one", () => {
    const { dir, path } = watchedLock();
    writeFileSync(path, `${DEAD_PID}\n`);
    hooks.watchVisibility = true;

    const lock = acquireLock(path);
    hooks.watchVisibility = false;

    expect(lock).not.toBeNull();
    expect(hooks.seenUnowned).toEqual([]);
    expect(readPidFile(path)).toBe(process.pid);
    expectOnlyTheLock(dir);
    lock?.release();
  });

  // The reclaim race: two acquirers judge the same dead owner's lock stale; the
  // peer clears it and takes the lock first. Clearing it again here would
  // delete the peer's live lock, and both would start Temporal.
  it("leaves a live peer's lock alone when the peer reclaimed the stale lock first", () => {
    const { dir, path } = watchedLock();
    writeFileSync(path, `${DEAD_PID}\n`);
    const peer = livePeerRecord();
    hooks.beforeFirstRemoval = () => writeFileSync(path, peer);

    const lock = acquireLock(path);

    expect(lock).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(peer);
    expectOnlyTheLock(dir);
  });

  it("takes the lock when a peer cleared the stale lock first and has not created its own yet", () => {
    const { dir, path } = watchedLock();
    writeFileSync(path, `${DEAD_PID}\n`);
    hooks.beforeFirstRemoval = () => rmSync(path);

    const lock = acquireLock(path);

    expect(lock).not.toBeNull();
    expect(readPidFile(path)).toBe(process.pid);
    expectOnlyTheLock(dir);
    lock?.release();
  });

  it("answers held when a peer creates the lock right after the stale one is cleared", () => {
    const { dir, path } = watchedLock();
    writeFileSync(path, `${DEAD_PID}\n`);
    const peer = livePeerRecord();
    hooks.afterFirstRemoval = () => writeFileSync(path, peer);

    const lock = acquireLock(path);

    expect(lock).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(peer);
    expectOnlyTheLock(dir);
  });

  it("takes the lock when its owner releases it between our lost create and our look", () => {
    const { dir, path } = watchedLock();
    writeFileSync(path, livePeerRecord());
    hooks.onCreateLost = () => rmSync(path);

    const lock = acquireLock(path);

    expect(lock).not.toBeNull();
    expect(readPidFile(path)).toBe(process.pid);
    expectOnlyTheLock(dir);
    lock?.release();
  });

  it("refuses a live peer's lock and leaves nothing beside it", () => {
    const { dir, path } = watchedLock();
    const peer = livePeerRecord();
    writeFileSync(path, peer);

    expect(acquireLock(path)).toBeNull();

    expect(readFileSync(path, "utf8")).toBe(peer);
    expectOnlyTheLock(dir);
  });

  describe("on a filesystem without hard links", () => {
    for (const code of ["EPERM", "ENOTSUP", "ENOSYS"]) {
      it(`still takes the lock, with its record, when linking answers ${code}`, () => {
        const { dir, path } = watchedLock();
        hooks.failNext.set("linkSync", code);

        const lock = acquireLock(path);

        expect(lock).not.toBeNull();
        expect(readPidFile(path)).toBe(process.pid);
        expectOnlyTheLock(dir);
        lock?.release();
      });
    }

    it("still refuses a live peer's lock", () => {
      const { dir, path } = watchedLock();
      const peer = livePeerRecord();
      writeFileSync(path, peer);
      hooks.failNext.set("linkSync", "EPERM");

      expect(acquireLock(path)).toBeNull();

      expect(readFileSync(path, "utf8")).toBe(peer);
      expectOnlyTheLock(dir);
    });

    it("raises an error the fallback create meets, rather than calling the lock held", () => {
      const { dir, path } = watchedLock();
      hooks.failNext.set("linkSync", "EPERM");
      hooks.failNext.set("openSync", "EACCES");

      expect(() => acquireLock(path)).toThrow(/EACCES/);

      expectOnlyTheLock(dir);
    });
  });

  it("raises a link error that does not mean 'no hard links', rather than calling the lock held", () => {
    const { dir, path } = watchedLock();
    hooks.failNext.set("linkSync", "EIO");

    expect(() => acquireLock(path)).toThrow(/EIO/);

    expect(readdirSync(dir)).toEqual([]);
  });

  it("raises an error for a directory at the lock's path, and leaves it there", () => {
    const { path } = watchedLock();
    mkdirSync(path);

    expect(() => acquireLock(path)).toThrow();

    expect(readdirSync(path)).toEqual([]);
  });

  // release() removes only the file this lock wrote; one rewritten since, even
  // by a process that has our PID, is not ours to remove.
  it("release leaves a lock rewritten with our PID but another token", () => {
    const { path } = watchedLock();
    const lock = acquireLock(path);
    expect(lock).not.toBeNull();
    const other = `${process.pid}\nlock=0123456789abcdef\n`;
    writeFileSync(path, other);

    lock?.release();

    expect(readFileSync(path, "utf8")).toBe(other);
  });

  it("release after the lock file is already gone removes nothing and throws nothing", () => {
    const { dir, path } = watchedLock();
    const lock = acquireLock(path);
    expect(lock).not.toBeNull();
    rmSync(path);

    lock?.release();

    expect(readdirSync(dir)).toEqual([]);
    expect(acquireLock(path)).not.toBeNull();
  });
});
