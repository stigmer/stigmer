import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSessionWorkspaceRoot } from "../session-root.js";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "stigmer-session-root-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("resolveSessionWorkspaceRoot", () => {
  it("returns the shared root untouched when the session has workspace entries", async () => {
    const resolved = await resolveSessionWorkspaceRoot(rootDir, [{}], "ses_1");
    expect(resolved).toBe(rootDir);
  });

  it("creates and returns a per-session directory when the session has no entries", async () => {
    const resolved = await resolveSessionWorkspaceRoot(rootDir, [], "ses_1");
    expect(resolved).toBe(join(rootDir, "sessions", "ses_1"));
    expect((await stat(resolved)).isDirectory()).toBe(true);
  });

  it("is deterministic across calls (stable across turns and retries)", async () => {
    const first = await resolveSessionWorkspaceRoot(rootDir, [], "ses_1");
    const second = await resolveSessionWorkspaceRoot(rootDir, [], "ses_1");
    expect(second).toBe(first);
  });

  it("rejects an empty sessionId for a no-entry session", async () => {
    // An empty id would collapse every no-entry session onto one directory —
    // the exact cross-session leakage this helper exists to prevent.
    await expect(resolveSessionWorkspaceRoot(rootDir, [], "")).rejects.toThrow(
      /sessionId is required/,
    );
  });
});
