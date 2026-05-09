import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";

vi.mock("@cursor/sdk", () => ({
  Agent: {
    create: vi.fn(),
    resume: vi.fn(),
    archive: vi.fn(),
  },
}));

vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...original, mkdirSync: vi.fn() };
});

import { Agent } from "@cursor/sdk";
import { mkdirSync } from "node:fs";
import {
  resolvePlatformOptions,
  createAgent,
  resumeAgent,
  resolveAgent,
  disposeAgent,
} from "../session-lifecycle.js";

const FAKE_SESSION_ID = "sess_01J3XYZABC123DEF456";
const FAKE_API_KEY = "crsr_test_key";
const FAKE_AGENT_ID = "agent-abc123";

function mockAgent(agentId: string) {
  return { agentId, send: vi.fn(), close: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePlatformOptions", () => {
  it("returns deterministic workspaceRef and stateRoot for a given sessionId", () => {
    const result = resolvePlatformOptions(FAKE_SESSION_ID);

    expect(result.workspaceRef).toBe(`stigmer-session:${FAKE_SESSION_ID}`);
    expect(result.stateRoot).toBe(
      join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
    );
  });

  it("produces the same output on repeated calls with the same sessionId", () => {
    const first = resolvePlatformOptions(FAKE_SESSION_ID);
    const second = resolvePlatformOptions(FAKE_SESSION_ID);

    expect(first).toEqual(second);
  });

  it("produces different output for different sessionIds", () => {
    const a = resolvePlatformOptions("session-aaa");
    const b = resolvePlatformOptions("session-bbb");

    expect(a.workspaceRef).not.toBe(b.workspaceRef);
    expect(a.stateRoot).not.toBe(b.stateRoot);
  });

  it("creates the stateRoot directory eagerly", () => {
    resolvePlatformOptions(FAKE_SESSION_ID);

    expect(mkdirSync).toHaveBeenCalledWith(
      join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
      { recursive: true },
    );
  });
});

describe("createAgent", () => {
  it("passes platform options derived from sessionId to Agent.create", async () => {
    const fakeAgent = mockAgent("agent-new-123");
    vi.mocked(Agent.create).mockResolvedValue(fakeAgent as any);

    await createAgent({
      apiKey: FAKE_API_KEY,
      model: "composer-2",
      workspaceDirs: ["/workspace/project"],
      sessionId: FAKE_SESSION_ID,
    });

    expect(Agent.create).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.platform).toEqual({
      workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
      stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
    });
  });

  it("passes single cwd as string for single workspace dir", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("x") as any);

    await createAgent({
      apiKey: FAKE_API_KEY,
      model: "default",
      workspaceDirs: ["/single/dir"],
      sessionId: FAKE_SESSION_ID,
    });

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.local?.cwd).toBe("/single/dir");
  });

  it("passes cwd as string[] for multiple workspace dirs", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("x") as any);

    await createAgent({
      apiKey: FAKE_API_KEY,
      model: "default",
      workspaceDirs: ["/dir/a", "/dir/b"],
      sessionId: FAKE_SESSION_ID,
    });

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.local?.cwd).toEqual(["/dir/a", "/dir/b"]);
  });

  it("passes model and apiKey through", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("x") as any);

    await createAgent({
      apiKey: FAKE_API_KEY,
      model: "composer-2",
      workspaceDirs: ["/w"],
      sessionId: FAKE_SESSION_ID,
    });

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.apiKey).toBe(FAKE_API_KEY);
    expect(callArgs.model).toEqual({ id: "composer-2" });
  });
});

describe("resumeAgent", () => {
  it("passes platform options derived from sessionId to Agent.resume", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_AGENT_ID) as any);

    await resumeAgent({
      apiKey: FAKE_API_KEY,
      agentId: FAKE_AGENT_ID,
      sessionId: FAKE_SESSION_ID,
      model: "composer-2",
    });

    expect(Agent.resume).toHaveBeenCalledTimes(1);
    const [agentId, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(agentId).toBe(FAKE_AGENT_ID);
    expect(options!.platform).toEqual({
      workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
      stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
    });
  });

  it("passes model when provided", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_AGENT_ID) as any);

    await resumeAgent({
      apiKey: FAKE_API_KEY,
      agentId: FAKE_AGENT_ID,
      sessionId: FAKE_SESSION_ID,
      model: "composer-2",
    });

    const [, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(options!.model).toEqual({ id: "composer-2" });
  });

  it("omits model when not provided", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_AGENT_ID) as any);

    await resumeAgent({
      apiKey: FAKE_API_KEY,
      agentId: FAKE_AGENT_ID,
      sessionId: FAKE_SESSION_ID,
    });

    const [, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(options!.model).toBeUndefined();
  });
});

describe("resolveAgent", () => {
  const createOptions = {
    apiKey: FAKE_API_KEY,
    model: "composer-2",
    workspaceDirs: ["/workspace"],
    sessionId: FAKE_SESSION_ID,
  };

  it("creates a new agent when threadId is empty", async () => {
    const fakeAgent = mockAgent("agent-new-456");
    vi.mocked(Agent.create).mockResolvedValue(fakeAgent as any);

    const result = await resolveAgent("", createOptions);

    expect(result.isNew).toBe(true);
    expect(result.agent).toBe(fakeAgent);
    expect(Agent.create).toHaveBeenCalledTimes(1);
    expect(Agent.resume).not.toHaveBeenCalled();
  });

  it("resumes an existing agent when threadId is non-empty", async () => {
    const fakeAgent = mockAgent(FAKE_AGENT_ID);
    vi.mocked(Agent.resume).mockResolvedValue(fakeAgent as any);

    const result = await resolveAgent(FAKE_AGENT_ID, createOptions);

    expect(result.isNew).toBe(false);
    expect(result.agent).toBe(fakeAgent);
    expect(Agent.resume).toHaveBeenCalledTimes(1);
    expect(Agent.create).not.toHaveBeenCalled();
  });

  it("passes sessionId through to resumeAgent for platform derivation", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_AGENT_ID) as any);

    await resolveAgent(FAKE_AGENT_ID, createOptions);

    const [, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(options!.platform).toEqual({
      workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
      stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
    });
  });

  it("passes sessionId through to createAgent for platform derivation", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("new") as any);

    await resolveAgent("", createOptions);

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.platform).toEqual({
      workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
      stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
    });
  });

  it("throws a descriptive error when resume fails", async () => {
    vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent not found"));

    await expect(resolveAgent(FAKE_AGENT_ID, createOptions)).rejects.toThrow(
      /Failed to resume Cursor agent/,
    );
    await expect(resolveAgent(FAKE_AGENT_ID, createOptions)).rejects.toThrow(
      /Agent not found/,
    );
  });
});

describe("disposeAgent", () => {
  it("calls Agent.archive with the agentId", async () => {
    vi.mocked(Agent.archive).mockResolvedValue(undefined);

    await disposeAgent(FAKE_AGENT_ID, FAKE_API_KEY);

    expect(Agent.archive).toHaveBeenCalledWith(FAKE_AGENT_ID, {
      apiKey: FAKE_API_KEY,
    });
  });

  it("swallows errors gracefully", async () => {
    vi.mocked(Agent.archive).mockRejectedValue(new Error("network error"));

    await expect(disposeAgent(FAKE_AGENT_ID, FAKE_API_KEY)).resolves.toBeUndefined();
  });
});
