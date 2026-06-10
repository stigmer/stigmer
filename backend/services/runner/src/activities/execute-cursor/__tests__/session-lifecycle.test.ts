/**
 * Unit tests for resolvePlatformOptions — the Cursor SDK stateRoot derivation.
 *
 * stateRoot is keyed by sessionId and rooted at the durable workspace volume so
 * native Agent.resume() survives restart/snapshot-restore and so sessions that
 * share one volume (e.g. a workflow sandbox's child agent executions) never
 * collide. These invariants are correctness-critical, hence the explicit tests.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

vi.mock("@cursor/sdk", () => ({
  Agent: {
    create: vi.fn(async () => ({ agentId: "agent-created" })),
    resume: vi.fn(async () => ({ agentId: "agent-resumed" })),
  },
}));

import { Agent } from "@cursor/sdk";
import { resolvePlatformOptions, createAgent, resumeAgent } from "../session-lifecycle.js";

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

// ---------------------------------------------------------------------------
// Workspace binding across create/resume
//
// Regression: Agent.resume() does not persist local.cwd. When resumeAgent()
// omitted it, the SDK fell back to process.cwd() — re-rooting the resumed
// agent in the runner's own working directory and loading the "project"
// setting source (the .cursor/hooks.json carrying the HITL approval hook)
// from that wrong directory. Result: on every resumed turn, file edits and
// shell commands ran unguarded with no approval card (observed in production
// execution aex_01ktr5na07f5xtmn0dz3mfjtdp).
// ---------------------------------------------------------------------------

describe("workspace binding on create/resume", () => {
  const baseOptions = {
    apiKey: "key",
    sessionId: "ses-cwd-test",
    model: "gpt-test",
  };

  it("createAgent passes the single workspace dir as local.cwd", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await createAgent({
      ...baseOptions,
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    const callOptions = vi.mocked(Agent.create).mock.calls.at(-1)![0] as any;
    expect(callOptions.local.cwd).toBe("/work/repo-a");
    expect(callOptions.local.settingSources).toContain("project");
  });

  it("resumeAgent re-supplies local.cwd (not persisted by Agent.resume)", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await resumeAgent({
      ...baseOptions,
      agentId: "agent-123",
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    const [agentId, callOptions] = vi.mocked(Agent.resume).mock.calls.at(-1)! as [string, any];
    expect(agentId).toBe("agent-123");
    // The load-bearing assertion: without cwd the SDK re-roots the agent at
    // process.cwd() and the project HITL hook never loads on resumed turns.
    expect(callOptions.local.cwd).toBe("/work/repo-a");
    expect(callOptions.local.settingSources).toContain("project");
  });

  it("resumeAgent passes multiple workspace dirs as an array cwd", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await resumeAgent({
      ...baseOptions,
      agentId: "agent-456",
      workspaceDirs: ["/work/repo-a", "/work/repo-b"],
      workspaceRootDir,
    });

    const callOptions = vi.mocked(Agent.resume).mock.calls.at(-1)![1] as any;
    expect(callOptions.local.cwd).toEqual(["/work/repo-a", "/work/repo-b"]);
  });
});
