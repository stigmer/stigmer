/**
 * useSessionUsage reads the session usage report alone: it maps the report's
 * tokens, model rows, per-run rows, served-by rows and `is_estimated`
 * as given, shows nothing until the report has tokens (it never sums run
 * statuses itself, so a run's streaming numbers do not leak in), polls
 * while a run is in flight and fetches once more when the last run settles.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  GetSessionUsageReportOutputSchema,
  type GetSessionUsageReportOutput,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { ProviderKeySource } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import { useStigmer } from "../../hooks";
import { useSessionUsage } from "../useSessionUsage";

// ── Test data builders ───────────────────────────────────────────────────

const SESSION_ID = "sess-1";

function makeRun(phase: RunPhase, streamingTokens = 0n): Run {
  return {
    spec: { target: { case: "sessionId", value: SESSION_ID } },
    status: {
      phase,
      streamingUsage: streamingTokens > 0n
        ? { totalTokens: streamingTokens, inputTokens: streamingTokens, turnCount: 1, model: "claude-sonnet-4-6" }
        : undefined,
    },
  } as unknown as Run;
}

function meteredReport(): GetSessionUsageReportOutput {
  return create(GetSessionUsageReportOutputSchema, {
    sessionId: SESSION_ID,
    totalUsage: {
      llmCallCount: 2,
      totalTokens: 1_200n,
      inputTokens: 600n,
      outputTokens: 400n,
      cacheReadInputTokens: 200n,
      primaryModel: "claude-sonnet-4-6",
      primaryProvider: "anthropic",
      workingSeconds: 95n,
      servedBy: [{ providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 1_200n, llmCallCount: 2 }],
    },
    modelBreakdown: [
      {
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        inputTokens: 600n,
        outputTokens: 400n,
        cacheReadInputTokens: 200n,
        callCount: 2,
        totalTokens: 1_200n,
      },
    ],
    runs: [{ runId: "run_1", primaryModel: "claude-sonnet-4-6", totalTokens: 1_200n, isEstimated: false, workingSeconds: 95n }],
    isEstimated: false,
  });
}

function emptyReport(): GetSessionUsageReportOutput {
  return create(GetSessionUsageReportOutputSchema, { sessionId: SESSION_ID, totalUsage: {} });
}

function mockStigmer(getSessionUsageReport: ReturnType<typeof vi.fn>) {
  const stigmer = { run: { getSessionUsageReport } };
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

  it("maps the report's tokens, models, runs and served-by rows", async () => {
    mockStigmer(vi.fn(async () => meteredReport()));

    const runs = [makeRun(RunPhase.RUN_COMPLETED)];
    const { result } = renderHook(() => useSessionUsage(runs));
    await flush();

    expect(result.current).toEqual({
      totalTokens: 1_200,
      inputTokens: 600,
      outputTokens: 400,
      cacheReadTokens: 200,
      cacheCreationTokens: 0,
      llmCallCount: 2,
      workingSeconds: 95,
      modelBreakdown: [
        {
          model: "claude-sonnet-4-6",
          provider: "anthropic",
          totalTokens: 1_200,
          inputTokens: 600,
          outputTokens: 400,
          cacheCreationTokens: 0,
          cacheReadTokens: 200,
          callCount: 2,
        },
      ],
      runBreakdown: [
        { runId: "run_1", resolvedModel: "claude-sonnet-4-6", totalTokens: 1_200, isEstimated: false, workingSeconds: 95 },
      ],
      servedBy: [{ providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 1_200, llmCallCount: 2 }],
      primaryModel: "claude-sonnet-4-6",
      primaryProvider: "anthropic",
      hasUsage: true,
      isEstimated: false,
    });
  });

  it("counts a session with working time and no tokens as having usage", async () => {
    const report = create(GetSessionUsageReportOutputSchema, {
      sessionId: SESSION_ID,
      totalUsage: { workingSeconds: 30n },
      runs: [{ runId: "run_1", workingSeconds: 30n }],
    });
    mockStigmer(vi.fn(async () => report));

    const { result } = renderHook(() => useSessionUsage([makeRun(RunPhase.RUN_COMPLETED)]));
    await flush();

    expect(result.current.hasUsage).toBe(true);
    expect(result.current.workingSeconds).toBe(30);
    expect(result.current.runBreakdown.map((r) => r.workingSeconds)).toEqual([30]);
  });

  it("passes the report's estimated flag through for runner-reported runs", async () => {
    const report = create(GetSessionUsageReportOutputSchema, {
      sessionId: SESSION_ID,
      totalUsage: { totalTokens: 900n, llmCallCount: 0, primaryModel: "claude-sonnet-4-6" },
      runs: [{ runId: "run_1", primaryModel: "claude-sonnet-4-6", totalTokens: 900n, isEstimated: true }],
      isEstimated: true,
    });
    mockStigmer(vi.fn(async () => report));

    const runs = [makeRun(RunPhase.RUN_COMPLETED)];
    const { result } = renderHook(() => useSessionUsage(runs));
    await flush();

    expect(result.current.hasUsage).toBe(true);
    expect(result.current.isEstimated).toBe(true);
    expect(result.current.totalTokens).toBe(900);
    expect(result.current.llmCallCount).toBe(0);
  });

  it("never sums run statuses: an empty report shows no usage despite streaming numbers", async () => {
    mockStigmer(vi.fn(async () => emptyReport()));

    const runs = [makeRun(RunPhase.RUN_IN_PROGRESS, 5_000n)];
    const { result } = renderHook(() => useSessionUsage(runs));
    await flush();

    expect(result.current.hasUsage).toBe(false);
    expect(result.current.totalTokens).toBe(0);
    expect(result.current.primaryProvider).toBe("");
  });

  it("polls the usage report while a run is in progress", async () => {
    vi.useFakeTimers();
    const getReport = vi.fn(async () => meteredReport());
    mockStigmer(getReport);

    const runs = [makeRun(RunPhase.RUN_IN_PROGRESS)];
    renderHook(() => useSessionUsage(runs));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReport).toHaveBeenCalledTimes(1);

    // Each poll interval triggers a fresh fetch so the tokens climb live.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getReport).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(getReport).toHaveBeenCalledTimes(3);
  });

  it("stops polling once all runs are terminal, after one final refetch", async () => {
    vi.useFakeTimers();
    const getReport = vi.fn(async () => meteredReport());
    mockStigmer(getReport);

    let runs = [makeRun(RunPhase.RUN_IN_PROGRESS)];
    const { rerender } = renderHook(() => useSessionUsage(runs));

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReport).toHaveBeenCalledTimes(1);

    // Run settles — polling stops, and a single final refetch fires to
    // capture the last turn's numbers promptly.
    runs = [makeRun(RunPhase.RUN_COMPLETED)];
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
