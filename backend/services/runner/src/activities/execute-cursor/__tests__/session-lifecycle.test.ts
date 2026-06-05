/**
 * Unit tests for resolvePlatformOptions — the Cursor SDK stateRoot derivation.
 *
 * stateRoot is keyed by sessionId and rooted at the durable workspace volume so
 * native Agent.resume() survives restart/snapshot-restore and so sessions that
 * share one volume (e.g. a workflow sandbox's child agent executions) never
 * collide. These invariants are correctness-critical, hence the explicit tests.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolvePlatformOptions } from "../session-lifecycle.js";

const tempRoots: string[] = [];

function freshWorkspaceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-stateroot-test-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolvePlatformOptions", () => {
  it("derives stateRoot under the workspace volume (not $HOME)", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const opts = resolvePlatformOptions("ses-123", workspaceRootDir);

    expect(opts.stateRoot).toBe(
      join(workspaceRootDir, ".stigmer", "cursor-sdk-state", "ses-123"),
    );
    expect(opts.stateRoot.startsWith(workspaceRootDir)).toBe(true);
    // Created eagerly to prevent ENOENT on first SDK write.
    expect(existsSync(opts.stateRoot!)).toBe(true);
    expect(opts.workspaceRef).toBe("stigmer-session:ses-123");
  });

  it("isolates two sessions sharing one workspace volume into distinct stores", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    const a = resolvePlatformOptions("ses-aaa", workspaceRootDir);
    const b = resolvePlatformOptions("ses-bbb", workspaceRootDir);

    expect(a.stateRoot).not.toBe(b.stateRoot);
    expect(a.workspaceRef).not.toBe(b.workspaceRef);
    // Both live under the same shared volume but in session-keyed subdirs.
    expect(a.stateRoot!.startsWith(join(workspaceRootDir, ".stigmer"))).toBe(true);
    expect(b.stateRoot!.startsWith(join(workspaceRootDir, ".stigmer"))).toBe(true);
  });

  it("throws on an empty sessionId (would collide across sessions on a shared volume)", () => {
    const workspaceRootDir = freshWorkspaceRoot();
    expect(() => resolvePlatformOptions("", workspaceRootDir)).toThrow(/sessionId is required/);
  });

  it("throws on an empty workspaceRootDir (state must live on the durable volume)", () => {
    expect(() => resolvePlatformOptions("ses-123", "")).toThrow(/workspaceRootDir is required/);
  });
});
