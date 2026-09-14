/**
 * Unit tests for `session-store.ts`: where a session's Cursor SDK store lives,
 * and the lifetime the runner owns for it (stigmer/stigmer#1053).
 *
 * The location rules are correctness-critical: the state root is keyed by
 * sessionId and rooted at the durable workspace volume so native
 * Agent.resume() survives restart/snapshot-restore and so sessions that share
 * one volume (a workflow sandbox's child agent executions) never collide.
 *
 * The lifetime rules are what a revert of the adapter's release hooks would
 * break: one open per session however many activities ask, the SAME instance
 * on every ask, a release that disposes and forgets so the next ask reopens, a
 * failed open that is not remembered, and a re-acquire under a different root
 * that releases the store it held. `SessionStores` takes the opener, so these
 * run against a recording fake and no SQLite file.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionStores, resolveSessionStoreLocation, type ReleasableStore, type SessionStoreLocation } from "../session-store.js";

const tempRoots: string[] = [];

function freshWorkspaceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-session-store-test-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveSessionStoreLocation", () => {
  it("derives the state root under the workspace volume (not $HOME), created eagerly", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const location = resolveSessionStoreLocation("ses-123", workspaceRootDir);

    expect(location.stateRoot).toBe(join(workspaceRootDir, ".stigmer", "cursor-sdk-state", "ses-123"));
    expect(location.stateRoot.startsWith(workspaceRootDir)).toBe(true);
    // Created eagerly to prevent ENOENT on the SDK's first write.
    expect(existsSync(location.stateRoot)).toBe(true);
    expect(location.workspaceRef).toBe("stigmer-session:ses-123");
  });

  it("isolates two sessions sharing one workspace volume into distinct stores", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const a = resolveSessionStoreLocation("ses-aaa", workspaceRootDir);
    const b = resolveSessionStoreLocation("ses-bbb", workspaceRootDir);

    expect(a.stateRoot).not.toBe(b.stateRoot);
    expect(a.workspaceRef).not.toBe(b.workspaceRef);
    expect(a.stateRoot.startsWith(join(workspaceRootDir, ".stigmer"))).toBe(true);
    expect(b.stateRoot.startsWith(join(workspaceRootDir, ".stigmer"))).toBe(true);
  });

  it("throws on an empty sessionId (would collide across sessions on a shared volume)", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    expect(() => resolveSessionStoreLocation("", workspaceRootDir)).toThrow(/sessionId is required/);
  });

  it("throws on an empty workspaceRootDir (state must live on the durable volume)", () => {
    expect(() => resolveSessionStoreLocation("ses-123", "")).toThrow(/workspaceRootDir is required/);
  });
});

// ---------------------------------------------------------------------------
// The lifetime
// ---------------------------------------------------------------------------

class FakeStore implements ReleasableStore {
  disposeCalls = 0;
  constructor(readonly location: SessionStoreLocation) {}
  get stateRoot(): string {
    return this.location.stateRoot;
  }
  async dispose(): Promise<void> {
    this.disposeCalls++;
  }
}

/** A recording opener; `failNext` makes the next open reject once. */
function recordingOpener() {
  const opened: FakeStore[] = [];
  let failNext: Error | undefined;
  const open = async (location: SessionStoreLocation): Promise<FakeStore> => {
    if (failNext) {
      const err = failNext;
      failNext = undefined;
      throw err;
    }
    const store = new FakeStore(location);
    opened.push(store);
    return store;
  };
  return { open, opened, fail: (err: Error) => (failNext = err) };
}

describe("SessionStores", () => {
  it("opens once per session and hands the same instance to every later acquire, concurrent ones included", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    // Two activities racing on one session (the agent cache's documented race).
    const [a, b] = await Promise.all([
      stores.acquire("ses-1", workspaceRootDir),
      stores.acquire("ses-1", workspaceRootDir),
    ]);
    const c = await stores.acquire("ses-1", workspaceRootDir);

    expect(opened).toHaveLength(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.location.workspaceRef).toBe("stigmer-session:ses-1");
    expect(stores.size).toBe(1);
  });

  it("keeps one store per session, not one per process", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    const a = await stores.acquire("ses-a", workspaceRootDir);
    const b = await stores.acquire("ses-b", workspaceRootDir);

    expect(opened).toHaveLength(2);
    expect(a).not.toBe(b);
    expect(stores.size).toBe(2);
  });

  it("release disposes the session's store and forgets it, so a later acquire reopens", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    const first = await stores.acquire("ses-1", workspaceRootDir);
    await stores.release("ses-1");

    expect(first.disposeCalls).toBe(1);
    expect(stores.size).toBe(0);

    const second = await stores.acquire("ses-1", workspaceRootDir);
    expect(second).not.toBe(first);
    expect(opened).toHaveLength(2);
  });

  it("release of a session with no store is a no-op", async () => {
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    await expect(stores.release("ses-unknown")).resolves.toBeUndefined();
    expect(opened).toHaveLength(0);
  });

  it("releaseAll disposes every held store and empties the map (worker shutdown)", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    await stores.acquire("ses-a", workspaceRootDir);
    await stores.acquire("ses-b", workspaceRootDir);
    await stores.releaseAll();

    expect(opened.map((s) => s.disposeCalls)).toEqual([1, 1]);
    expect(stores.size).toBe(0);
  });

  it("does not remember a failed open: the next acquire retries", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const { open, opened, fail } = recordingOpener();
    const stores = new SessionStores(open);

    fail(new Error("disk full"));
    await expect(stores.acquire("ses-1", workspaceRootDir)).rejects.toThrow("disk full");
    expect(stores.size).toBe(0);

    const store = await stores.acquire("ses-1", workspaceRootDir);
    expect(opened).toEqual([store]);
    expect(stores.size).toBe(1);
  });

  it("a re-acquire under a different workspace volume releases the held store and opens the new one", async () => {
    const rootA = freshWorkspaceRoot();
    const rootB = freshWorkspaceRoot();
    const { open, opened } = recordingOpener();
    const stores = new SessionStores(open);

    const onA = await stores.acquire("ses-1", rootA);
    const onB = await stores.acquire("ses-1", rootB);

    // The handle for the old binding can never serve the new one (the same
    // rule the agent cache applies to a fingerprint mismatch).
    expect(onB).not.toBe(onA);
    expect(onA.disposeCalls).toBe(1);
    expect(onB.stateRoot.startsWith(rootB)).toBe(true);
    expect(opened).toHaveLength(2);
    expect(stores.size).toBe(1);
  });

  it("a dispose that throws is swallowed: the store is forgotten either way", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const stores = new SessionStores(async (location) => {
      const store = new FakeStore(location);
      store.dispose = async () => {
        throw new Error("handle already closed");
      };
      return store;
    });

    await stores.acquire("ses-1", workspaceRootDir);
    await expect(stores.release("ses-1")).resolves.toBeUndefined();
    expect(stores.size).toBe(0);
  });
});
