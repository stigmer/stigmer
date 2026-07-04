/**
 * Tests for the per-workspace turn lock (workspace-lock.ts).
 *
 * These run against the real proper-lockfile substrate on tmp directories —
 * the lock's correctness IS its filesystem behavior, so mocking it would
 * test nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, rm, symlink, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireWorkspaceLock,
  WorkspaceLockTimeoutError,
  WorkspaceLockCancelledError,
} from "../workspace-lock.js";

let baseDir: string;
let workspaceDir: string;
let lockDir: string;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), "stigmer-workspace-lock-"));
  workspaceDir = join(baseDir, "workspace");
  lockDir = join(baseDir, "locks");
  await mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

/** Resolves true once `promise` settles; used to assert "still pending". */
function settled(promise: Promise<unknown>): { get: () => boolean } {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  return { get: () => done };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("acquireWorkspaceLock", () => {
  it("serializes two concurrent acquires on the same workspace", async () => {
    const release1 = await acquireWorkspaceLock(workspaceDir, { lockDir });

    const second = acquireWorkspaceLock(workspaceDir, {
      lockDir,
      pollIntervalMs: 25,
    });
    const secondSettled = settled(second);

    await sleep(120);
    expect(secondSettled.get()).toBe(false);

    await release1();
    const release2 = await second;
    expect(secondSettled.get()).toBe(true);
    await release2();
  });

  it("converges symlink aliases of one directory onto one lock", async () => {
    const alias = join(baseDir, "workspace-alias");
    await symlink(workspaceDir, alias);

    const release = await acquireWorkspaceLock(workspaceDir, { lockDir });
    await expect(
      acquireWorkspaceLock(alias, {
        lockDir,
        pollIntervalMs: 20,
        timeoutMs: 100,
      }),
    ).rejects.toBeInstanceOf(WorkspaceLockTimeoutError);
    await release();
  });

  it("does not contend across distinct workspaces", async () => {
    const otherDir = join(baseDir, "other-workspace");
    await mkdir(otherDir, { recursive: true });

    const release1 = await acquireWorkspaceLock(workspaceDir, { lockDir });
    const release2 = await acquireWorkspaceLock(otherDir, {
      lockDir,
      timeoutMs: 200,
      pollIntervalMs: 20,
    });
    await release1();
    await release2();
  });

  it("recovers a stale lock left by a crashed holder", async () => {
    const release = await acquireWorkspaceLock(workspaceDir, {
      lockDir,
      staleMs: 5_000,
    });
    // Simulate a crashed holder: the artifact exists but its mtime refresh
    // has stopped. Backdate it past the staleness bound.
    const [artifact] = await readdir(lockDir);
    const past = new Date(Date.now() - 60_000);
    await utimes(join(lockDir, artifact), past, past);

    const release2 = await acquireWorkspaceLock(workspaceDir, {
      lockDir,
      staleMs: 5_000,
      timeoutMs: 2_000,
      pollIntervalMs: 20,
    });
    await release2();
    await release(); // original holder's release must not throw (idempotent wrapper)
  });

  it("times out with a typed, actionable error when the workspace stays busy", async () => {
    const release = await acquireWorkspaceLock(workspaceDir, { lockDir });
    const err = await acquireWorkspaceLock(workspaceDir, {
      lockDir,
      timeoutMs: 120,
      pollIntervalMs: 25,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceLockTimeoutError);
    expect(String(err)).toContain("in use by another session");
    await release();
  });

  it("aborts the wait immediately on cancellation", async () => {
    const release = await acquireWorkspaceLock(workspaceDir, { lockDir });
    const controller = new AbortController();

    const waiting = acquireWorkspaceLock(workspaceDir, {
      lockDir,
      pollIntervalMs: 5_000, // long poll: proves abort wakes the sleep early
      timeoutMs: 60_000,
      signal: controller.signal,
    });

    await sleep(50);
    const before = Date.now();
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(WorkspaceLockCancelledError);
    expect(Date.now() - before).toBeLessThan(1_000);
    await release();
  });

  it("invokes onWaiting exactly once and heartbeats on every poll", async () => {
    const release1 = await acquireWorkspaceLock(workspaceDir, { lockDir });

    let waitingCalls = 0;
    let heartbeats = 0;
    const second = acquireWorkspaceLock(workspaceDir, {
      lockDir,
      pollIntervalMs: 25,
      onWaiting: () => { waitingCalls += 1; },
      heartbeat: () => { heartbeats += 1; },
    });

    // Deterministic under load: hold the lock until the waiter has provably
    // polled at least twice, rather than sleeping a fixed wall-clock time.
    while (heartbeats < 2) {
      await sleep(20);
    }
    await release1();
    const release2 = await second;

    expect(waitingCalls).toBe(1);
    expect(heartbeats).toBeGreaterThanOrEqual(2);
    await release2();
  });

  it("never invokes onWaiting on an uncontended acquire", async () => {
    let waitingCalls = 0;
    const release = await acquireWorkspaceLock(workspaceDir, {
      lockDir,
      onWaiting: () => { waitingCalls += 1; },
    });
    expect(waitingCalls).toBe(0);
    await release();
  });

  it("release is idempotent", async () => {
    const release = await acquireWorkspaceLock(workspaceDir, { lockDir });
    await release();
    await expect(release()).resolves.toBeUndefined();
    // Lock is actually free again.
    const release2 = await acquireWorkspaceLock(workspaceDir, {
      lockDir,
      timeoutMs: 200,
      pollIntervalMs: 20,
    });
    await release2();
  });

  it("keeps every lock artifact outside the workspace (issue #173)", async () => {
    const release = await acquireWorkspaceLock(workspaceDir, { lockDir });
    expect(await readdir(workspaceDir)).toEqual([]);
    expect((await readdir(lockDir)).length).toBeGreaterThan(0);
    await release();
  });
});
