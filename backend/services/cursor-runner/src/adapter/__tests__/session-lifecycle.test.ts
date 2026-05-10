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
  createCloudAgent,
  resumeCloudAgent,
  resolveAgent,
  disposeAgent,
} from "../session-lifecycle.js";
import type { AgentResolution, AgentResolutionReason } from "../session-lifecycle.js";

const FAKE_SESSION_ID = "sess_01J3XYZABC123DEF456";
const FAKE_API_KEY = "crsr_test_key";
const FAKE_AGENT_ID = "agent-abc123";
const FAKE_CLOUD_AGENT_ID = "bc-cloud-abc123";

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

describe("createCloudAgent", () => {
  it("passes cloud.repos without platform options", async () => {
    const fakeAgent = mockAgent("bc-new-123");
    vi.mocked(Agent.create).mockResolvedValue(fakeAgent as any);

    await createCloudAgent({
      apiKey: FAKE_API_KEY,
      model: "composer-2",
      repos: [{ url: "https://github.com/org/repo", startingRef: "main" }],
      sessionId: FAKE_SESSION_ID,
    });

    expect(Agent.create).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.cloud).toEqual({
      repos: [{ url: "https://github.com/org/repo", startingRef: "main" }],
    });
    expect(callArgs.platform).toBeUndefined();
    expect(callArgs.local).toBeUndefined();
  });

  it("omits model when not provided (server resolves default)", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("bc-x") as any);

    await createCloudAgent({
      apiKey: FAKE_API_KEY,
      repos: [{ url: "https://github.com/org/repo" }],
      sessionId: FAKE_SESSION_ID,
    });

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.model).toBeUndefined();
  });

  it("passes multiple repos", async () => {
    vi.mocked(Agent.create).mockResolvedValue(mockAgent("bc-multi") as any);

    await createCloudAgent({
      apiKey: FAKE_API_KEY,
      repos: [
        { url: "https://github.com/org/repo-a" },
        { url: "https://github.com/org/repo-b", startingRef: "develop" },
      ],
      sessionId: FAKE_SESSION_ID,
    });

    const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
    expect(callArgs.cloud!.repos).toHaveLength(2);
  });
});

describe("resumeCloudAgent", () => {
  it("resumes without platform options", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_CLOUD_AGENT_ID) as any);

    await resumeCloudAgent({
      apiKey: FAKE_API_KEY,
      agentId: FAKE_CLOUD_AGENT_ID,
      model: "composer-2",
    });

    expect(Agent.resume).toHaveBeenCalledTimes(1);
    const [agentId, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(agentId).toBe(FAKE_CLOUD_AGENT_ID);
    expect(options!.platform).toBeUndefined();
  });

  it("omits model when not provided", async () => {
    vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_CLOUD_AGENT_ID) as any);

    await resumeCloudAgent({
      apiKey: FAKE_API_KEY,
      agentId: FAKE_CLOUD_AGENT_ID,
    });

    const [, options] = vi.mocked(Agent.resume).mock.calls[0];
    expect(options!.model).toBeUndefined();
  });
});

describe("resolveAgent", () => {
  const localCreateOptions = {
    apiKey: FAKE_API_KEY,
    model: "composer-2",
    workspaceDirs: ["/workspace"],
    sessionId: FAKE_SESSION_ID,
  };

  const cloudCreateOptions = {
    apiKey: FAKE_API_KEY,
    model: "composer-2",
    repos: [{ url: "https://github.com/org/repo" }],
    sessionId: FAKE_SESSION_ID,
  };

  describe("local mode — first execution (empty threadId)", () => {
    it("creates a new agent and returns created_first_execution", async () => {
      const fakeAgent = mockAgent("agent-new-456");
      vi.mocked(Agent.create).mockResolvedValue(fakeAgent as any);

      const result = await resolveAgent("", localCreateOptions, "local");

      expect(result.reason).toBe("created_first_execution");
      expect(result.isNew).toBe(true);
      expect(result.resumed).toBe(false);
      expect(result.mode).toBe("local");
      expect(result.agent).toBe(fakeAgent);
      expect(result.agentId).toBe("agent-new-456");
      expect(result.resumeFailureDetail).toBeUndefined();
      expect(Agent.create).toHaveBeenCalledTimes(1);
      expect(Agent.resume).not.toHaveBeenCalled();
    });

    it("passes sessionId through to createAgent for platform derivation", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("new") as any);

      await resolveAgent("", localCreateOptions, "local");

      const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
      expect(callArgs.platform).toEqual({
        workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
        stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
      });
    });

    it("propagates createAgent failures (infrastructure error)", async () => {
      vi.mocked(Agent.create).mockRejectedValue(new Error("Connection refused"));

      await expect(resolveAgent("", localCreateOptions, "local")).rejects.toThrow("Connection refused");
    });

    it("defaults to local mode when mode parameter is omitted", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("a") as any);

      const result = await resolveAgent("", localCreateOptions);

      expect(result.mode).toBe("local");
      const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
      expect(callArgs.local).toBeDefined();
    });
  });

  describe("local mode — subsequent execution (non-empty threadId) — resume success", () => {
    it("resumes the agent and returns resumed_successfully", async () => {
      const fakeAgent = mockAgent(FAKE_AGENT_ID);
      vi.mocked(Agent.resume).mockResolvedValue(fakeAgent as any);

      const result = await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(result.reason).toBe("resumed_successfully");
      expect(result.isNew).toBe(false);
      expect(result.resumed).toBe(true);
      expect(result.mode).toBe("local");
      expect(result.agent).toBe(fakeAgent);
      expect(result.agentId).toBe(FAKE_AGENT_ID);
      expect(result.resumeFailureDetail).toBeUndefined();
      expect(Agent.resume).toHaveBeenCalledTimes(1);
      expect(Agent.create).not.toHaveBeenCalled();
    });

    it("passes sessionId through to resumeAgent for platform derivation", async () => {
      vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_AGENT_ID) as any);

      await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      const [, options] = vi.mocked(Agent.resume).mock.calls[0];
      expect(options!.platform).toEqual({
        workspaceRef: `stigmer-session:${FAKE_SESSION_ID}`,
        stateRoot: join(homedir(), ".stigmer/cursor-sdk-state", FAKE_SESSION_ID),
      });
    });
  });

  describe("local mode — subsequent execution — resume failure (graceful fallback)", () => {
    it("creates a fresh agent when resume fails with 'Agent not found'", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent not found"));
      const fallbackAgent = mockAgent("agent-fallback-789");
      vi.mocked(Agent.create).mockResolvedValue(fallbackAgent as any);

      const result = await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(result.reason).toBe("created_after_resume_failure");
      expect(result.isNew).toBe(true);
      expect(result.resumed).toBe(false);
      expect(result.mode).toBe("local");
      expect(result.agent).toBe(fallbackAgent);
      expect(result.agentId).toBe("agent-fallback-789");
      expect(result.resumeFailureDetail).toBe("Agent not found");
    });

    it("creates a fresh agent when resume fails with network error", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("ECONNREFUSED"));
      const fallbackAgent = mockAgent("agent-fallback-net");
      vi.mocked(Agent.create).mockResolvedValue(fallbackAgent as any);

      const result = await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(result.reason).toBe("created_after_resume_failure");
      expect(result.resumeFailureDetail).toBe("ECONNREFUSED");
    });

    it("creates a fresh agent when resume fails with non-Error rejection", async () => {
      vi.mocked(Agent.resume).mockRejectedValue("string rejection");
      const fallbackAgent = mockAgent("agent-fallback-str");
      vi.mocked(Agent.create).mockResolvedValue(fallbackAgent as any);

      const result = await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(result.reason).toBe("created_after_resume_failure");
      expect(result.resumeFailureDetail).toBe("string rejection");
    });

    it("calls both Agent.resume and Agent.create", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("expired"));
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("new") as any);

      await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(Agent.resume).toHaveBeenCalledTimes(1);
      expect(Agent.create).toHaveBeenCalledTimes(1);
    });

    it("propagates createAgent failures even during fallback", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent not found"));
      vi.mocked(Agent.create).mockRejectedValue(new Error("Cursor API down"));

      await expect(resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local")).rejects.toThrow(
        "Cursor API down",
      );
    });

    it("logs a warning with the original error and session context", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent not found"));
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("new") as any);

      await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`resume failed for local agent "${FAKE_AGENT_ID}"`),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Agent not found"),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(FAKE_SESSION_ID),
      );
      warnSpy.mockRestore();
    });

    it("logs the fallback agent creation with old and new agent IDs", async () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(Agent.resume).mockRejectedValue(new Error("expired"));
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("agent-new-xyz") as any);

      await resolveAgent(FAKE_AGENT_ID, localCreateOptions, "local");

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(`oldAgentId=${FAKE_AGENT_ID}`),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("newAgentId=agent-new-xyz"),
      );
      logSpy.mockRestore();
    });
  });

  describe("cloud mode — first execution", () => {
    it("creates a cloud agent and returns mode cloud", async () => {
      const fakeAgent = mockAgent("bc-new-456");
      vi.mocked(Agent.create).mockResolvedValue(fakeAgent as any);

      const result = await resolveAgent("", cloudCreateOptions, "cloud");

      expect(result.reason).toBe("created_first_execution");
      expect(result.isNew).toBe(true);
      expect(result.resumed).toBe(false);
      expect(result.mode).toBe("cloud");
      expect(result.agentId).toBe("bc-new-456");
    });

    it("passes cloud.repos without platform options", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("bc-x") as any);

      await resolveAgent("", cloudCreateOptions, "cloud");

      const callArgs = vi.mocked(Agent.create).mock.calls[0][0];
      expect(callArgs.cloud).toBeDefined();
      expect(callArgs.platform).toBeUndefined();
      expect(callArgs.local).toBeUndefined();
    });

    it("propagates createCloudAgent failures", async () => {
      vi.mocked(Agent.create).mockRejectedValue(new Error("Cloud API unavailable"));

      await expect(resolveAgent("", cloudCreateOptions, "cloud")).rejects.toThrow(
        "Cloud API unavailable",
      );
    });
  });

  describe("cloud mode — subsequent execution — resume success", () => {
    it("resumes the cloud agent and returns mode cloud", async () => {
      const fakeAgent = mockAgent(FAKE_CLOUD_AGENT_ID);
      vi.mocked(Agent.resume).mockResolvedValue(fakeAgent as any);

      const result = await resolveAgent(FAKE_CLOUD_AGENT_ID, cloudCreateOptions, "cloud");

      expect(result.reason).toBe("resumed_successfully");
      expect(result.isNew).toBe(false);
      expect(result.resumed).toBe(true);
      expect(result.mode).toBe("cloud");
      expect(result.agentId).toBe(FAKE_CLOUD_AGENT_ID);
    });

    it("resumes without platform options", async () => {
      vi.mocked(Agent.resume).mockResolvedValue(mockAgent(FAKE_CLOUD_AGENT_ID) as any);

      await resolveAgent(FAKE_CLOUD_AGENT_ID, cloudCreateOptions, "cloud");

      const [, options] = vi.mocked(Agent.resume).mock.calls[0];
      expect(options!.platform).toBeUndefined();
    });
  });

  describe("cloud mode — resume failure (graceful fallback)", () => {
    it("creates a fresh cloud agent when resume fails (expired)", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent expired"));
      const fallbackAgent = mockAgent("bc-fallback-789");
      vi.mocked(Agent.create).mockResolvedValue(fallbackAgent as any);

      const result = await resolveAgent(FAKE_CLOUD_AGENT_ID, cloudCreateOptions, "cloud");

      expect(result.reason).toBe("created_after_resume_failure");
      expect(result.isNew).toBe(true);
      expect(result.resumed).toBe(false);
      expect(result.mode).toBe("cloud");
      expect(result.agentId).toBe("bc-fallback-789");
      expect(result.resumeFailureDetail).toBe("Agent expired");
    });

    it("propagates createCloudAgent failures during fallback", async () => {
      vi.mocked(Agent.resume).mockRejectedValue(new Error("Agent expired"));
      vi.mocked(Agent.create).mockRejectedValue(new Error("Cloud API down"));

      await expect(
        resolveAgent(FAKE_CLOUD_AGENT_ID, cloudCreateOptions, "cloud"),
      ).rejects.toThrow("Cloud API down");
    });
  });

  describe("AgentResolution type contract", () => {
    it("every resolution has required fields", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("a") as any);

      const result = await resolveAgent("", localCreateOptions, "local");

      expect(result).toHaveProperty("agent");
      expect(result).toHaveProperty("agentId");
      expect(result).toHaveProperty("isNew");
      expect(result).toHaveProperty("resumed");
      expect(result).toHaveProperty("mode");
      expect(result).toHaveProperty("reason");
    });

    it("mode reflects the requested mode parameter", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("a") as any);

      const local = await resolveAgent("", localCreateOptions, "local");
      const cloud = await resolveAgent("", cloudCreateOptions, "cloud");

      expect(local.mode).toBe("local");
      expect(cloud.mode).toBe("cloud");
    });

    it("agentId matches the agent handle's agentId property", async () => {
      vi.mocked(Agent.create).mockResolvedValue(mockAgent("agent-xyz") as any);

      const result = await resolveAgent("", localCreateOptions, "local");

      expect(result.agentId).toBe("agent-xyz");
      expect(result.agentId).toBe(result.agent.agentId);
    });
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
