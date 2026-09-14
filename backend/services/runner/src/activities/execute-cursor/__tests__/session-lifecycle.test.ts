/**
 * Unit tests for the local agent's create/resume options and the
 * transport-recovery wrapper (`session-lifecycle.ts`).
 *
 * The SDK module is a `vi.fn` stub so the assertions read the exact options
 * the adapter hands `Agent.create` / `Agent.resume`. The SDK's sqlite entry is
 * NOT mocked here on purpose: `createAgent` opens the session's REAL
 * `SqliteLocalAgentStore` (`node:sqlite`, no network) under a temp workspace
 * volume, so this file is also where the store the runner ships with is
 * proven to open, be reused, and dispose — the hermetic goldens double it.
 * The store's keying and lifetime rules have their own arms in
 * `session-store.test.ts`.
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
import type { AgentOptions } from "@cursor/sdk";
import { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";
import {
  createAgent,
  resumeAgent,
  resolveAgentWithTransportRecovery,
} from "../session-lifecycle.js";
import type { CreateAgentOptions } from "../session-lifecycle.js";
import { releaseAllSessionStores } from "../session-store.js";

const tempRoots: string[] = [];

function freshWorkspaceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-stateroot-test-"));
  tempRoots.push(dir);
  return dir;
}

afterEach(async () => {
  // Release every store before its directory goes, so the sqlite handles are
  // closed when the temp roots are removed (and no test inherits a store).
  await releaseAllSessionStores();
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function lastCreateOptions(): AgentOptions {
  return vi.mocked(Agent.create).mock.calls.at(-1)![0];
}

function lastResumeCall(): [string, Partial<AgentOptions> | undefined] {
  return vi.mocked(Agent.resume).mock.calls.at(-1)! as [string, Partial<AgentOptions> | undefined];
}

// ---------------------------------------------------------------------------
// The local options across create/resume
//
// Regression: Agent.resume() does not persist local.cwd. When resumeAgent()
// omitted it, the SDK fell back to process.cwd() — re-rooting the resumed
// agent in the runner's own working directory and loading the "project"
// setting source (the .cursor/hooks.json carrying the HITL approval hook)
// from that wrong directory. Result: on every resumed turn, file edits and
// shell commands ran unguarded with no approval card (observed in production
// execution aex_01ktr5na07f5xtmn0dz3mfjtdp). The same rule now covers the
// store (#1053): a resume without it would look the agent up in a default
// store derived from cwd, not the one the session's records are in.
// ---------------------------------------------------------------------------

describe("local options on create/resume", () => {
  const baseOptions = {
    apiKey: "key",
    sessionId: "ses-cwd-test",
    model: "gpt-test",
  };

  it("createAgent passes the single workspace dir as local.cwd, with no dirs", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await createAgent({
      ...baseOptions,
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    const { local } = lastCreateOptions();
    expect(local?.cwd).toBe("/work/repo-a");
    expect(local).not.toHaveProperty("dirs");
    expect(local?.settingSources).toContain("project");
  });

  it("createAgent opens the session's real SQLite store under the workspace volume and passes it as local.store", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await createAgent({
      ...baseOptions,
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    const store = lastCreateOptions().local?.store;
    expect(store).toBeInstanceOf(SqliteLocalAgentStore);
    const sqlite = store as SqliteLocalAgentStore;
    expect(sqlite.workspaceRef).toBe("stigmer-session:ses-cwd-test");
    expect(sqlite.stateRoot).toBe(join(workspaceRootDir, ".stigmer", "cursor-sdk-state", "ses-cwd-test"));
    // The SDK's layout lands where the runner said, not under $HOME.
    expect(existsSync(sqlite.stateRoot)).toBe(true);
  });

  it("createAgent pins the SDK's own retries off (the runner is the retry authority)", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await createAgent({
      ...baseOptions,
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    // 1.0.31 defaults this to true for headless embedders; an absent field
    // would silently stack the SDK's transport retries under the runner's.
    expect(lastCreateOptions().local?.enableAgentRetries).toBe(false);
  });

  it("resumeAgent re-supplies cwd, settingSources, store and the retry pin (nothing under local survives Agent.resume)", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await createAgent({
      ...baseOptions,
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });
    const createdWith = lastCreateOptions().local?.store;

    await resumeAgent({
      ...baseOptions,
      agentId: "agent-123",
      workspaceDirs: ["/work/repo-a"],
      workspaceRootDir,
    });

    const [agentId, callOptions] = lastResumeCall();
    expect(agentId).toBe("agent-123");
    // The load-bearing assertions: without cwd the SDK re-roots the agent at
    // process.cwd() and the project HITL hook never loads on resumed turns;
    // without the SAME store it looks the agent up somewhere else.
    expect(callOptions?.local?.cwd).toBe("/work/repo-a");
    expect(callOptions?.local?.settingSources).toContain("project");
    expect(callOptions?.local?.store).toBe(createdWith);
    expect(callOptions?.local?.enableAgentRetries).toBe(false);
  });

  it("passes a multi-root workspace as cwd (the first dir) plus dirs (the rest)", async () => {
    const workspaceRootDir = freshWorkspaceRoot();
    await resumeAgent({
      ...baseOptions,
      agentId: "agent-456",
      workspaceDirs: ["/work/repo-a", "/work/repo-b", "/work/repo-c"],
      workspaceRootDir,
    });

    const [, callOptions] = lastResumeCall();
    // The SDK merges cwd-first with duplicates dropped, so this is the array
    // the SDK took whole at 1.0.13, in the same order.
    expect(callOptions?.local?.cwd).toBe("/work/repo-a");
    expect(callOptions?.local?.dirs).toEqual(["/work/repo-b", "/work/repo-c"]);
  });
});

// ---------------------------------------------------------------------------
// Transport recovery on agent-resolution timeout
//
// Regression: a stale HTTP/2 session to the proxy hangs Agent.create/resume
// forever (prod incident, Jul 2026). The wrapper bounds each attempt, resets
// the transport on the first expiry, and retries once. Only TimeoutError
// triggers recovery — deterministic failures must propagate untouched.
// ---------------------------------------------------------------------------

describe("resolveAgentWithTransportRecovery", () => {
  const TIMEOUT_MS = 1_000;
  const hang = () => new Promise<never>(() => {});

  function recoveryOptions(overrides?: {
    harnessStateId?: string;
    resetTransport?: () => void;
  }) {
    const createOptions: CreateAgentOptions = {
      apiKey: "key",
      model: "gpt-test",
      workspaceDirs: ["/work/repo-a"],
      sessionId: "ses-recovery-test",
      workspaceRootDir: freshWorkspaceRoot(),
    };
    return {
      harnessStateId: overrides?.harnessStateId ?? "",
      createOptions,
      mode: "local" as const,
      timeoutMs: TIMEOUT_MS,
      buildTimeoutMessage: (finalAttempt: boolean) =>
        finalAttempt ? "final attempt timed out" : "first attempt timed out",
      resetTransport: overrides?.resetTransport ?? vi.fn(),
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the resolution through untouched when the first attempt succeeds", async () => {
    const resetTransport = vi.fn();

    const resolution = await resolveAgentWithTransportRecovery(
      recoveryOptions({ resetTransport }),
    );

    expect(resolution.agentId).toBe("agent-created");
    expect(resolution.reason).toBe("created_first_execution");
    expect(resetTransport).not.toHaveBeenCalled();
  });

  it("resets the transport exactly once and recovers when the first attempt hangs", async () => {
    vi.useFakeTimers();
    const resetTransport = vi.fn();
    vi.mocked(Agent.create).mockImplementationOnce(hang as any);

    const promise = resolveAgentWithTransportRecovery(recoveryOptions({ resetTransport }));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    const resolution = await promise;

    expect(resolution.agentId).toBe("agent-created");
    expect(resetTransport).toHaveBeenCalledTimes(1);
  });

  it("retries resume-first so a transport hiccup does not discard conversation context", async () => {
    vi.useFakeTimers();
    const resetTransport = vi.fn();
    vi.mocked(Agent.resume).mockImplementationOnce(hang as any);

    const promise = resolveAgentWithTransportRecovery(
      recoveryOptions({ harnessStateId: "agent-prior-turn", resetTransport }),
    );

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    const resolution = await promise;

    // The load-bearing assertion: the retry went through Agent.resume again
    // (only the transport was suspect, not the agent handle), so the native
    // conversation context survives the recovery.
    expect(resolution.reason).toBe("resumed_successfully");
    expect(resolution.agentId).toBe("agent-resumed");
    expect(resetTransport).toHaveBeenCalledTimes(1);
  });

  it("rejects with the final-attempt message when both attempts hang; transport reset only once", async () => {
    vi.useFakeTimers();
    const resetTransport = vi.fn();
    vi.mocked(Agent.create)
      .mockImplementationOnce(hang as any)
      .mockImplementationOnce(hang as any);

    const promise = resolveAgentWithTransportRecovery(recoveryOptions({ resetTransport }));
    const rejection = expect(promise).rejects.toThrow("final attempt timed out");

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1); // first attempt expires
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1); // retry expires
    await rejection;

    expect(resetTransport).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-timeout error immediately without touching the transport", async () => {
    const resetTransport = vi.fn();
    const authFailure = new Error("401 unauthorized");
    vi.mocked(Agent.create).mockRejectedValueOnce(authFailure);

    await expect(
      resolveAgentWithTransportRecovery(recoveryOptions({ resetTransport })),
    ).rejects.toBe(authFailure);

    expect(resetTransport).not.toHaveBeenCalled();
  });
});
