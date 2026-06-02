import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { GetSessionUsageReportOutput } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import { useStigmer } from "../../hooks";
import { useSessionUsage } from "../useSessionUsage";

// ── Test data builders ───────────────────────────────────────────────────

const SESSION_ID = "sess-1";

function makeExecution(
  phase: ExecutionPhase,
  streamingUsage?: Record<string, unknown>,
): AgentExecution {
  return {
    spec: { sessionId: SESSION_ID },
    status: { phase, streamingUsage },
  } as unknown as AgentExecution;
}

function streamingUsage(costUsd: number): Record<string, unknown> {
  return {
    inputTokens: 100n,
    outputTokens: 20n,
    cacheReadTokens: 0n,
    cacheWriteTokens: 0n,
    totalTokens: 120n,
    turnCount: 1,
    estimatedCostUsd: costUsd,
    model: "claude-sonnet-4-6",
    observedAt: "",
  };
}

function authoritativeReport(billableMicros: bigint): GetSessionUsageReportOutput {
  return {
    totalUsage: {
      llmCallCount: 2,
      totalTokens: 120n,
      billableCostMicros: billableMicros,
      inputTokens: 60n,
      outputTokens: 40n,
      cacheReadInputTokens: 0n,
      cacheCreationInputTokens: 0n,
      primaryModel: "claude-sonnet-4-6",
      primaryProvider: "cursor",
    },
    modelBreakdown: [],
    isEstimated: false,
  } as unknown as GetSessionUsageReportOutput;
}

function emptyReport(): GetSessionUsageReportOutput {
  return {
    totalUsage: {
      llmCallCount: 0,
      totalTokens: 0n,
      billableCostMicros: 0n,
      inputTokens: 0n,
      outputTokens: 0n,
      cacheReadInputTokens: 0n,
      cacheCreationInputTokens: 0n,
      primaryModel: "",
      primaryProvider: "",
    },
    modelBreakdown: [],
    isEstimated: true,
  } as unknown as GetSessionUsageReportOutput;
}

function mockStigmer(getSessionUsageReport: ReturnType<typeof vi.fn>) {
  const stigmer = { agentExecution: { getSessionUsageReport } };
  (useStigmer as ReturnType<typeof vi.fn>).mockReturnValue(stigmer);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useSessionUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to the streaming estimate when no billing record exists yet", async () => {
    const getReport = vi.fn(async () => emptyReport());
    mockStigmer(getReport);

    const executions = [makeExecution(ExecutionPhase.EXECUTION_IN_PROGRESS, streamingUsage(0.05))];
    const { result } = renderHook(() => useSessionUsage(executions));

    await flush();

    expect(result.current.isEstimated).toBe(true);
    expect(result.current.totalCostUsd).toBeCloseTo(0.05);
    expect(result.current.primaryProvider).toBe("cursor");
  });

  it("prefers the authoritative billing report once records exist", async () => {
    const getReport = vi.fn(async () => authoritativeReport(60_000n));
    mockStigmer(getReport);

    const executions = [makeExecution(ExecutionPhase.EXECUTION_IN_PROGRESS, streamingUsage(0.05))];
    const { result } = renderHook(() => useSessionUsage(executions));

    await flush();

    expect(result.current.isEstimated).toBe(false);
    // 60_000 micros = $0.06 billable, replacing the $0.05 estimate.
    expect(result.current.totalCostUsd).toBeCloseTo(0.06);
    expect(result.current.llmCallCount).toBe(2);
  });

  it("polls the usage report while an execution is in progress", async () => {
    vi.useFakeTimers();
    const getReport = vi.fn(async () => authoritativeReport(60_000n));
    mockStigmer(getReport);

    const executions = [makeExecution(ExecutionPhase.EXECUTION_IN_PROGRESS, streamingUsage(0.05))];
    renderHook(() => useSessionUsage(executions));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReport).toHaveBeenCalledTimes(1);

    // Each poll interval triggers a fresh fetch so the settled cost climbs live.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getReport).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getReport).toHaveBeenCalledTimes(3);
  });

  it("stops polling once all executions are terminal, after one final refetch", async () => {
    vi.useFakeTimers();
    const getReport = vi.fn(async () => authoritativeReport(60_000n));
    mockStigmer(getReport);

    let executions = [makeExecution(ExecutionPhase.EXECUTION_IN_PROGRESS, streamingUsage(0.05))];
    const { rerender } = renderHook(() => useSessionUsage(executions));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReport).toHaveBeenCalledTimes(1);

    // Execution settles — polling stops, and a single final refetch fires to
    // capture the last turn's authoritative record promptly.
    executions = [makeExecution(ExecutionPhase.EXECUTION_COMPLETED, streamingUsage(0.05))];
    rerender();
    await act(async () => {
      await Promise.resolve();
    });
    expect(getReport).toHaveBeenCalledTimes(2);

    // No further polling once terminal.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getReport).toHaveBeenCalledTimes(2);
  });
});
