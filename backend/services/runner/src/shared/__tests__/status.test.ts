import { describe, it, expect, vi } from "vitest";
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
