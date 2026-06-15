import { describe, it, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { utcTimestamp, persistStatus, reportSetupProgress, slimStatus } from "../status.js";

describe("utcTimestamp", () => {
  it("returns an ISO 8601 string ending in Z", () => {
    const ts = utcTimestamp();
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/);
  });

  it("returns current time within 1 second tolerance", () => {
    const before = Date.now();
    const ts = utcTimestamp();
    const after = Date.now();
    const parsed = new Date(ts).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

describe("slimStatus", () => {
  it("preserves phase, error, timestamps, and pendingApprovals", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      error: "test error",
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:01:00Z",
    });
    const result = slimStatus(full) as Record<string, unknown>;
    expect(result).toHaveProperty("phase");
    expect(result).toHaveProperty("error", "test error");
    expect(result).toHaveProperty("startedAt", "2026-01-01T00:00:00Z");
    expect(result).toHaveProperty("completedAt", "2026-01-01T00:01:00Z");
  });

  it("excludes heavy fields like messages", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const result = slimStatus(full) as Record<string, unknown>;
    expect(result).not.toHaveProperty("messages");
    expect(result).not.toHaveProperty("todos");
  });

  it("returns a plain JSON-serializable object (not a protobuf Message)", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_FAILED,
    });
    const result = slimStatus(full);
    const json = JSON.stringify(result);
    expect(json).toBeTruthy();
    expect(JSON.parse(json)).toEqual(result);
  });

  it("preserves structuredOutput when present on the full status", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      structuredOutput: {
        executive_summary: "DAU stable at 7175",
        dau: 7175,
        cohorts: [
          { name: "D1 New Players", size: 10, action_needed: true },
          { name: "D3 Drop-offs", size: 3589, action_needed: true },
        ],
      },
    });
    const result = slimStatus(full) as Record<string, unknown>;
    expect(result).toHaveProperty("structuredOutput");
    const output = (result as any).structuredOutput;
    expect(output.executive_summary).toBe("DAU stable at 7175");
    expect(output.dau).toBe(7175);
    expect(output.cohorts).toHaveLength(2);
  });

  it("omits structuredOutput when not present on full status", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
    });
    const result = slimStatus(full) as Record<string, unknown>;
    expect(result).not.toHaveProperty("structuredOutput");
  });

  it("activity return contains structuredOutput accessible by Go buildCallbackResult", () => {
    const full = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_COMPLETED,
      structuredOutput: {
        cohorts: [{ name: "D1", size: 500 }],
      },
    });
    const slim = slimStatus(full) as Record<string, unknown>;
    expect(slim["structuredOutput"]).toBeDefined();
    expect((slim["structuredOutput"] as any).cohorts).toHaveLength(1);
  });
});

describe("persistStatus", () => {
  it("returns the control signal from the backend", async () => {
    const mockClient = {
      updateStatus: vi.fn().mockResolvedValue({
        signal: ExecutionControlSignal.STOP,
      }),
    } as any;
    const status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const signal = await persistStatus(mockClient, "exec-1", status);
    expect(signal).toBe(ExecutionControlSignal.STOP);
    expect(mockClient.updateStatus).toHaveBeenCalledWith("exec-1", status);
  });

  it("returns UNSPECIFIED and logs on error", async () => {
    const mockClient = {
      updateStatus: vi.fn().mockRejectedValue(new Error("network")),
    } as any;
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const signal = await persistStatus(mockClient, "exec-2", status);
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("hard-elides and retries once on a resource_exhausted (code 8) failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const updateStatus = vi
      .fn()
      .mockRejectedValueOnce({ code: 8, message: "resource_exhausted: exceeds maximum size" })
      .mockResolvedValueOnce({ signal: ExecutionControlSignal.STOP });
    const mockClient = { updateStatus } as any;
    const status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });

    const signal = await persistStatus(mockClient, "exec-too-big", status);
    expect(signal).toBe(ExecutionControlSignal.STOP);
    expect(updateStatus).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });

  it("offloads oversized tool outputs before persisting when given an offload context", async () => {
    const uploaded: string[] = [];
    const offload = {
      executionId: "exec-off",
      artifactStorage: {
        upload: vi.fn(async (key: string) => { uploaded.push(key); return key; }),
        getDownloadUrl: vi.fn(async (key: string) => `https://artifacts.local/${key}`),
        exists: vi.fn(async () => true),
      },
      maxInlineBytes: 256,
    };
    const mockClient = {
      updateStatus: vi.fn().mockResolvedValue({ signal: ExecutionControlSignal.UNSPECIFIED }),
    } as any;
    const { AgentMessageSchema, ToolCallSchema } = await import(
      "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb"
    );
    const status = create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      messages: [
        create(AgentMessageSchema, {
          toolCalls: [create(ToolCallSchema, { id: "t", name: "Shell", result: "X".repeat(5000) })],
        }),
      ],
    });

    await persistStatus(mockClient, "exec-off", status, { offload });

    expect(uploaded).toHaveLength(1);
    const [, persisted] = mockClient.updateStatus.mock.calls[0];
    expect(persisted.messages[0].toolCalls[0].outputRef).toBeDefined();
    expect(persisted.messages[0].toolCalls[0].result.length).toBeLessThan(5000);
  });
});

// Migrated from grpc-retry.test.ts: the transient-backoff loop now lives inside
// persistStatus so every persist (streaming + terminal, every harness) shares
// one chokepoint that bounds size AND retries transient transport errors.
describe("persistStatus — transient retry", () => {
  const noDelay = async () => {};
  const emptyStatus = () => create(AgentExecutionStatusSchema, {});
  function retryClient(impl: () => Promise<{ signal: ExecutionControlSignal }>) {
    return { updateStatus: vi.fn(impl) } as any;
  }

  it("returns the signal on the first successful attempt", async () => {
    const client = retryClient(async () => ({ signal: ExecutionControlSignal.STOP }));
    const signal = await persistStatus(client, "exec-1", emptyStatus(), {
      retry: { delayFn: noDelay },
    });
    expect(signal).toBe(ExecutionControlSignal.STOP);
    expect(client.updateStatus).toHaveBeenCalledOnce();
  });

  it("retries a transient UNAVAILABLE and then succeeds", async () => {
    let attempt = 0;
    const client = retryClient(async () => {
      attempt++;
      if (attempt === 1) throw new ConnectError("down", Code.Unavailable);
      return { signal: ExecutionControlSignal.UNSPECIFIED };
    });
    const signal = await persistStatus(client, "exec-2", emptyStatus(), {
      retry: { delayFn: noDelay },
    });
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(attempt).toBe(2);
  });

  it("does not retry terminal errors (NOT_FOUND)", async () => {
    let attempt = 0;
    const client = retryClient(async () => {
      attempt++;
      throw new ConnectError("gone", Code.NotFound);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistStatus(client, "exec-3", emptyStatus(), {
      retry: { delayFn: noDelay },
    });
    errorSpy.mockRestore();
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(attempt).toBe(1);
  });

  it("does not retry INTERNAL (neither retryable nor terminal)", async () => {
    let attempt = 0;
    const client = retryClient(async () => {
      attempt++;
      throw new ConnectError("internal", Code.Internal);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistStatus(client, "exec-int", emptyStatus(), {
      retry: { maxRetries: 3, delayFn: noDelay },
    });
    errorSpy.mockRestore();
    expect(attempt).toBe(1);
  });

  it("applies exponential backoff and gives up after the retry budget", async () => {
    const delays: number[] = [];
    const client = retryClient(async () => {
      throw new ConnectError("down", Code.Unavailable);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistStatus(client, "exec-5", emptyStatus(), {
      retry: {
        baseDelayMs: 100,
        backoffFactor: 2,
        maxRetries: 3,
        delayFn: async (ms) => { delays.push(ms); },
      },
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    expect(delays).toEqual([100, 200, 400]);
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
  });

  it("respects a custom backoff factor", async () => {
    const delays: number[] = [];
    const client = retryClient(async () => {
      throw new ConnectError("down", Code.Unavailable);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistStatus(client, "exec-bf", emptyStatus(), {
      retry: {
        baseDelayMs: 50,
        backoffFactor: 3,
        maxRetries: 3,
        delayFn: async (ms) => { delays.push(ms); },
      },
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    expect(delays).toEqual([50, 150, 450]);
  });

  it("maxRetries = 0 means a single attempt", async () => {
    let attempt = 0;
    const client = retryClient(async () => {
      attempt++;
      throw new ConnectError("down", Code.Unavailable);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistStatus(client, "exec-0", emptyStatus(), {
      retry: { maxRetries: 0, delayFn: noDelay },
    });
    errorSpy.mockRestore();
    expect(attempt).toBe(1);
  });

  it("handles a mixed sequence: transient then terminal", async () => {
    let attempt = 0;
    const client = retryClient(async () => {
      attempt++;
      if (attempt === 1) throw new ConnectError("down", Code.Unavailable);
      throw new ConnectError("gone", Code.NotFound);
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistStatus(client, "exec-mix", emptyStatus(), {
      retry: { delayFn: noDelay },
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    expect(attempt).toBe(2);
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
  });

  it("never throws regardless of error type", async () => {
    const client = retryClient(async () => {
      throw new ConnectError("server exploded", Code.Internal);
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      persistStatus(client, "exec-7", emptyStatus(), { retry: { delayFn: noDelay } }),
    ).resolves.toBe(ExecutionControlSignal.UNSPECIFIED);
    errorSpy.mockRestore();
  });
});

describe("reportSetupProgress", () => {
  it("persists a status with the given phase name", async () => {
    const mockClient = {
      updateStatus: vi.fn().mockResolvedValue({
        signal: ExecutionControlSignal.UNSPECIFIED,
      }),
    } as any;
    await reportSetupProgress(mockClient, "exec-3", "Resolving MCP servers");
    expect(mockClient.updateStatus).toHaveBeenCalledOnce();
    const [id, status] = mockClient.updateStatus.mock.calls[0];
    expect(id).toBe("exec-3");
    expect(status.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(status.setupProgress?.currentPhase).toBe("Resolving MCP servers");
  });
});
