import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  UsageMetricsSchema,
  ModelUsageSchema,
  LlmCallMetricsSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { aggregateUsage, useExecutionUsage } from "../useExecutionUsage";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeUsage(
  overrides: Partial<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    llmCallCount: number;
    estimatedCostUsd: number;
    primaryModel: string;
    primaryProvider: string;
    totalDurationMs: number;
    llmDurationMs: number;
    toolDurationMs: number;
    approvalWaitDurationMs: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    toolResultCharsTruncated: bigint;
    modelBreakdown: ReturnType<typeof makeModelUsage>[];
    llmCalls: ReturnType<typeof makeLlmCall>[];
  }> = {},
) {
  return create(UsageMetricsSchema, overrides);
}

function makeModelUsage(
  model: string,
  provider: string,
  overrides: Partial<{
    inputTokens: number;
    outputTokens: number;
    callCount: number;
    estimatedCostUsd: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    inputPricePerMillion: number;
    outputPricePerMillion: number;
  }> = {},
) {
  return create(ModelUsageSchema, { model, provider, ...overrides });
}

function makeLlmCall(
  sequence: number,
  timestamp: string,
  overrides: Partial<{
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number;
    durationMs: number;
  }> = {},
) {
  return create(LlmCallMetricsSchema, { sequence, timestamp, ...overrides });
}

function makeExecution(
  mainUsage?: ReturnType<typeof makeUsage>,
  subAgents: Array<{
    name: string;
    usage?: ReturnType<typeof makeUsage>;
  }> = [],
): AgentExecution {
  const status = create(AgentExecutionStatusSchema, {
    usage: mainUsage,
    subAgentExecutions: subAgents.map((s) =>
      create(SubAgentExecutionSchema, { name: s.name, usage: s.usage }),
    ),
  });
  return create(AgentExecutionSchema, { status });
}

// ---------------------------------------------------------------------------
// aggregateUsage — pure function tests
// ---------------------------------------------------------------------------

describe("aggregateUsage", () => {
  it("returns null when execution is null", () => {
    expect(aggregateUsage(null)).toBeNull();
  });

  it("returns null when status is undefined", () => {
    const exec = create(AgentExecutionSchema);
    expect(aggregateUsage(exec)).toBeNull();
  });

  it("returns null when status.usage is undefined", () => {
    const exec = create(AgentExecutionSchema, {
      status: create(AgentExecutionStatusSchema),
    });
    expect(aggregateUsage(exec)).toBeNull();
  });

  it("returns main-only usage when no sub-agents exist", () => {
    const usage = makeUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      llmCallCount: 3,
      estimatedCostUsd: 0.005,
      primaryModel: "claude-sonnet-4",
      primaryProvider: "anthropic",
    });
    const exec = makeExecution(usage);

    const result = aggregateUsage(exec);
    expect(result).toBe(usage);
  });

  it("returns main-only usage when sub-agents exist but none have usage", () => {
    const usage = makeUsage({ promptTokens: 100, totalTokens: 100 });
    const exec = makeExecution(usage, [
      { name: "researcher" },
      { name: "coder" },
    ]);

    const result = aggregateUsage(exec);
    expect(result).toBe(usage);
  });

  it("sums token counts across main and sub-agents", () => {
    const main = makeUsage({
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      cacheCreationTokens: 10,
      cacheReadTokens: 20,
    });
    const sub1 = makeUsage({
      promptTokens: 200,
      completionTokens: 80,
      totalTokens: 280,
      cacheCreationTokens: 5,
      cacheReadTokens: 30,
    });
    const sub2 = makeUsage({
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
    });

    const exec = makeExecution(main, [
      { name: "sub1", usage: sub1 },
      { name: "sub2", usage: sub2 },
    ]);

    const result = aggregateUsage(exec)!;
    expect(result.promptTokens).toBe(350);
    expect(result.completionTokens).toBe(150);
    expect(result.totalTokens).toBe(500);
    expect(result.cacheCreationTokens).toBe(15);
    expect(result.cacheReadTokens).toBe(50);
  });

  it("sums cost across main and sub-agents", () => {
    const main = makeUsage({ estimatedCostUsd: 0.01 });
    const sub = makeUsage({ estimatedCostUsd: 0.005 });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.estimatedCostUsd).toBeCloseTo(0.015);
  });

  it("sums durations across main and sub-agents", () => {
    const main = makeUsage({
      totalDurationMs: 5000,
      llmDurationMs: 3000,
      toolDurationMs: 1500,
      approvalWaitDurationMs: 500,
    });
    const sub = makeUsage({
      totalDurationMs: 2000,
      llmDurationMs: 1000,
      toolDurationMs: 800,
      approvalWaitDurationMs: 200,
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.totalDurationMs).toBe(7000);
    expect(result.llmDurationMs).toBe(4000);
    expect(result.toolDurationMs).toBe(2300);
    expect(result.approvalWaitDurationMs).toBe(700);
  });

  it("uses main agent primaryModel and primaryProvider", () => {
    const main = makeUsage({
      primaryModel: "claude-sonnet-4",
      primaryProvider: "anthropic",
    });
    const sub = makeUsage({
      primaryModel: "gpt-4o",
      primaryProvider: "openai",
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.primaryModel).toBe("claude-sonnet-4");
    expect(result.primaryProvider).toBe("anthropic");
  });

  it("merges modelBreakdown entries with same model+provider key", () => {
    const main = makeUsage({
      modelBreakdown: [
        makeModelUsage("claude-sonnet-4", "anthropic", {
          inputTokens: 100,
          outputTokens: 50,
          callCount: 2,
          estimatedCostUsd: 0.005,
        }),
      ],
    });
    const sub = makeUsage({
      modelBreakdown: [
        makeModelUsage("claude-sonnet-4", "anthropic", {
          inputTokens: 200,
          outputTokens: 80,
          callCount: 3,
          estimatedCostUsd: 0.008,
        }),
      ],
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.modelBreakdown).toHaveLength(1);
    expect(result.modelBreakdown[0].model).toBe("claude-sonnet-4");
    expect(result.modelBreakdown[0].provider).toBe("anthropic");
    expect(result.modelBreakdown[0].inputTokens).toBe(300);
    expect(result.modelBreakdown[0].outputTokens).toBe(130);
    expect(result.modelBreakdown[0].callCount).toBe(5);
    expect(result.modelBreakdown[0].estimatedCostUsd).toBeCloseTo(0.013);
  });

  it("keeps modelBreakdown entries with different models separate", () => {
    const main = makeUsage({
      modelBreakdown: [
        makeModelUsage("claude-sonnet-4", "anthropic", { callCount: 2 }),
      ],
    });
    const sub = makeUsage({
      modelBreakdown: [
        makeModelUsage("gpt-4o", "openai", { callCount: 1 }),
      ],
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.modelBreakdown).toHaveLength(2);

    const models = result.modelBreakdown.map((m) => m.model).sort();
    expect(models).toEqual(["claude-sonnet-4", "gpt-4o"]);
  });

  it("concatenates llmCalls from all agents sorted by timestamp", () => {
    const main = makeUsage({
      llmCalls: [
        makeLlmCall(1, "2026-03-19T10:00:00Z"),
        makeLlmCall(2, "2026-03-19T10:01:00Z"),
      ],
    });
    const sub = makeUsage({
      llmCalls: [
        makeLlmCall(1, "2026-03-19T10:00:30Z"),
      ],
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.llmCalls).toHaveLength(3);
    expect(result.llmCalls[0].timestamp).toBe("2026-03-19T10:00:00Z");
    expect(result.llmCalls[1].timestamp).toBe("2026-03-19T10:00:30Z");
    expect(result.llmCalls[2].timestamp).toBe("2026-03-19T10:01:00Z");
  });

  it("skips sub-agents with undefined usage gracefully", () => {
    const main = makeUsage({
      promptTokens: 100,
      llmCallCount: 2,
    });
    const subWithUsage = makeUsage({
      promptTokens: 50,
      llmCallCount: 1,
    });
    const exec = makeExecution(main, [
      { name: "has-usage", usage: subWithUsage },
      { name: "no-usage" },
    ]);

    const result = aggregateUsage(exec)!;
    expect(result.promptTokens).toBe(150);
    expect(result.llmCallCount).toBe(3);
  });

  it("sums toolResultCharsTruncated as bigint", () => {
    const main = makeUsage({ toolResultCharsTruncated: 1000n });
    const sub = makeUsage({ toolResultCharsTruncated: 500n });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.toolResultCharsTruncated).toBe(1500n);
  });

  it("preserves pricing rates from first model entry", () => {
    const main = makeUsage({
      modelBreakdown: [
        makeModelUsage("claude-sonnet-4", "anthropic", {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 15.0,
          callCount: 1,
        }),
      ],
    });
    const sub = makeUsage({
      modelBreakdown: [
        makeModelUsage("claude-sonnet-4", "anthropic", {
          inputPricePerMillion: 3.0,
          outputPricePerMillion: 15.0,
          callCount: 1,
        }),
      ],
    });
    const exec = makeExecution(main, [{ name: "sub", usage: sub }]);

    const result = aggregateUsage(exec)!;
    expect(result.modelBreakdown[0].inputPricePerMillion).toBe(3.0);
    expect(result.modelBreakdown[0].outputPricePerMillion).toBe(15.0);
  });
});

// ---------------------------------------------------------------------------
// useExecutionUsage — hook tests
// ---------------------------------------------------------------------------

describe("useExecutionUsage", () => {
  it("returns null usage and zero metadata for null execution", () => {
    const { result } = renderHook(() => useExecutionUsage(null));

    expect(result.current.usage).toBeNull();
    expect(result.current.hasSubAgentUsage).toBe(false);
    expect(result.current.subAgentUsageCount).toBe(0);
  });

  it("returns aggregated UsageMetrics for valid execution", () => {
    const main = makeUsage({
      promptTokens: 100,
      estimatedCostUsd: 0.01,
      primaryModel: "claude-sonnet-4",
    });
    const exec = makeExecution(main);

    const { result } = renderHook(() => useExecutionUsage(exec));

    expect(result.current.usage).not.toBeNull();
    expect(result.current.usage!.promptTokens).toBe(100);
    expect(result.current.usage!.estimatedCostUsd).toBeCloseTo(0.01);
    expect(result.current.usage!.primaryModel).toBe("claude-sonnet-4");
    expect(result.current.hasSubAgentUsage).toBe(false);
    expect(result.current.subAgentUsageCount).toBe(0);
  });

  it("returns stable reference when execution has not changed", () => {
    const exec = makeExecution(makeUsage({ promptTokens: 100 }));
    const { result, rerender } = renderHook(() => useExecutionUsage(exec));

    const first = result.current;
    rerender();
    const second = result.current;

    expect(first).toBe(second);
  });

  it("sets hasSubAgentUsage and subAgentUsageCount correctly", () => {
    const main = makeUsage({ promptTokens: 100 });
    const sub1 = makeUsage({ promptTokens: 50 });
    const sub2 = makeUsage({ promptTokens: 30 });
    const exec = makeExecution(main, [
      { name: "sub1", usage: sub1 },
      { name: "sub2", usage: sub2 },
      { name: "sub3-no-usage" },
    ]);

    const { result } = renderHook(() => useExecutionUsage(exec));

    expect(result.current.hasSubAgentUsage).toBe(true);
    expect(result.current.subAgentUsageCount).toBe(2);
    expect(result.current.usage!.promptTokens).toBe(180);
  });
});
