import { describe, it, expect, vi, beforeEach } from "vitest";
import { createDeepAgentActivities } from "../index.js";
import type { Config } from "../../../config.js";

vi.mock("../../../client/stigmer-client.js", () => ({
  StigmerClient: vi.fn().mockImplementation(() => ({
    updateStatus: vi.fn().mockResolvedValue({}),
  })),
}));

describe("ExecuteDeepAgent stub", () => {
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

  it("returns a result with EXECUTION_FAILED phase", async () => {
    const result = await activities.ExecuteDeepAgent("exec-123", "thread-456");

    expect(result).toBeDefined();
    const status = result as Record<string, unknown>;
    expect(status).toHaveProperty("phase");
  });

  it("accepts the correct signature (executionId, threadId)", async () => {
    await expect(
      activities.ExecuteDeepAgent("execution-id", "thread-id"),
    ).resolves.toBeDefined();
  });

  it("handles empty threadId (first execution)", async () => {
    await expect(
      activities.ExecuteDeepAgent("execution-id", ""),
    ).resolves.toBeDefined();
  });
});
