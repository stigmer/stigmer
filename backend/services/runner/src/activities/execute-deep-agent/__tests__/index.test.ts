import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDeepAgentActivities } from "../index.js";
import type { Config } from "../../../config.js";

vi.mock("../../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn().mockResolvedValue({ signal: 0 }),
    getExecution: vi.fn().mockRejectedValue(new Error("not mocked")),
  })),
}));

describe("ExecuteDeepAgent activity", () => {
  const mockConfig: Config = {
    taskQueue: "test-queue",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    stigmerBackendEndpoint: "http://localhost:7234",
    stigmerToken: null,
    cursorApiKey: "",
    workspaceRootDir: "/tmp/test",
    mode: "local",
    proxyEndpoint: null,
    maxConcurrentActivities: 5,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    runnerId: null,
    checkpointerType: "memory",
    checkpointerProxyEndpoint: null,
  };

  let activities: ReturnType<typeof createDeepAgentActivities>;

  beforeEach(() => {
    activities = createDeepAgentActivities(mockConfig);
  });

  it("registers ExecuteDeepAgent activity", () => {
    expect(activities).toHaveProperty("ExecuteDeepAgent");
    expect(typeof activities.ExecuteDeepAgent).toBe("function");
  });

  it("returns EXECUTION_FAILED status when setup fails", async () => {
    const result = await activities.ExecuteDeepAgent("exec-123", "thread-456");

    expect(result).toBeDefined();
    const status = result as Record<string, unknown>;
    expect(status).toHaveProperty("phase");
    expect(status.phase).toBe("EXECUTION_FAILED");
  });

  it("includes error message in failed status", async () => {
    const result = await activities.ExecuteDeepAgent("exec-123", "thread-456");
    const status = result as Record<string, unknown>;
    expect(status.error).toContain("not mocked");
  });

  it("accepts the correct signature (executionId, threadId)", async () => {
    await expect(
      activities.ExecuteDeepAgent("execution-id", "thread-id"),
    ).resolves.toBeDefined();
  });

  it("handles empty threadId gracefully", async () => {
    await expect(
      activities.ExecuteDeepAgent("execution-id", ""),
    ).resolves.toBeDefined();
  });

  it("always returns a serializable result", async () => {
    const result = await activities.ExecuteDeepAgent("exec-err", "thread-1");
    expect(() => JSON.stringify(result)).not.toThrow();
  });
});
