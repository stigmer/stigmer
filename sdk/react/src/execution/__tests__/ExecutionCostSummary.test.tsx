import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";

afterEach(cleanup);
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  UsageMetricsSchema,
  ModelUsageSchema,
  type ModelUsage,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import {
  ExecutionCostSummary,
  formatCost,
  formatTokenCount,
} from "../ExecutionCostSummary";

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
    cacheCreationTokens: number;
    cacheReadTokens: number;
  }> = {},
) {
  return create(UsageMetricsSchema, overrides);
}

function makeUsageWithModels(
  overrides: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    llmCallCount?: number;
    estimatedCostUsd?: number;
    primaryModel?: string;
    primaryProvider?: string;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    modelBreakdown?: ModelUsage[];
  } = {},
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
  }> = {},
) {
  return create(ModelUsageSchema, { model, provider, ...overrides });
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
// formatCost
// ---------------------------------------------------------------------------

describe("formatCost", () => {
  it("formats zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats sub-dollar with 4 decimal places", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("formats sub-dollar with trailing zeros", () => {
    expect(formatCost(0.15)).toBe("$0.1500");
  });

  it("formats $1+ with 2 decimal places", () => {
    expect(formatCost(1.5)).toBe("$1.50");
  });

  it("rounds $1+ to 2 decimal places", () => {
    expect(formatCost(123.456)).toBe("$123.46");
  });

  it("formats exactly $1 with 2 decimal places", () => {
    expect(formatCost(1)).toBe("$1.00");
  });
});

// ---------------------------------------------------------------------------
// formatTokenCount
// ---------------------------------------------------------------------------

describe("formatTokenCount", () => {
  it("formats zero", () => {
    expect(formatTokenCount(0)).toBe("0");
  });

  it("formats small numbers without commas", () => {
    expect(formatTokenCount(999)).toBe("999");
  });

  it("formats thousands with commas", () => {
    expect(formatTokenCount(1234)).toBe("1,234");
  });

  it("formats millions with commas", () => {
    expect(formatTokenCount(1234567)).toBe("1,234,567");
  });
});

// ---------------------------------------------------------------------------
// ExecutionCostSummary — component rendering
// ---------------------------------------------------------------------------

describe("ExecutionCostSummary", () => {
  it("returns null when execution is null", () => {
    const { container } = render(
      <ExecutionCostSummary execution={null} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when usage is not yet available", () => {
    const execution = create(AgentExecutionSchema, {
      status: create(AgentExecutionStatusSchema),
    });
    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders cost, tokens, calls, and model for a basic execution", () => {
    const execution = makeExecution(
      makeUsage({
        estimatedCostUsd: 0.0042,
        totalTokens: 1234,
        promptTokens: 1000,
        completionTokens: 234,
        llmCallCount: 3,
        primaryModel: "claude-sonnet-4",
        primaryProvider: "anthropic",
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    expect(screen.getByText("$0.0042")).toBeTruthy();
    expect(screen.getByText("claude-sonnet-4 · anthropic")).toBeTruthy();
    expect(screen.getByText(/1,234 tokens/)).toBeTruthy();
    expect(screen.getByText(/3 calls/)).toBeTruthy();
  });

  it("renders token breakdown with prompt and completion", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 1234,
        promptTokens: 1000,
        completionTokens: 234,
        llmCallCount: 1,
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    expect(screen.getByText(/prompt 1,000/)).toBeTruthy();
    expect(screen.getByText(/completion 234/)).toBeTruthy();
  });

  it("uses singular 'call' for a single LLM call", () => {
    const execution = makeExecution(
      makeUsage({
        llmCallCount: 1,
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    const metricsLine = screen.getByText(/100 tokens/);
    expect(metricsLine.textContent).toContain("1 call");
    expect(metricsLine.textContent).not.toContain("1 calls");
  });

  it("does not show cache line when cache tokens are zero", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
      }),
    );

    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.textContent).not.toContain("cache");
  });

  it("shows cache read tokens when present", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
        cacheReadTokens: 500,
      }),
    );

    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.textContent).toContain("cache");
    expect(container.textContent).toContain("500 read");
    expect(container.textContent).not.toContain("write");
  });

  it("shows cache write tokens when present", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
        cacheCreationTokens: 200,
      }),
    );

    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.textContent).toContain("cache");
    expect(container.textContent).toContain("200 write");
    expect(container.textContent).not.toContain("read");
  });

  it("shows both cache read and write when both present", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
        cacheReadTokens: 500,
        cacheCreationTokens: 100,
      }),
    );

    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.textContent).toContain("500 read");
    expect(container.textContent).toContain("100 write");
  });

  it("shows sub-agent annotation when sub-agents have usage", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 1000,
        promptTokens: 800,
        completionTokens: 200,
      }),
      [
        { name: "researcher", usage: makeUsage({ totalTokens: 500 }) },
        { name: "writer", usage: makeUsage({ totalTokens: 300 }) },
      ],
    );

    render(<ExecutionCostSummary execution={execution} />);
    expect(screen.getByText("Includes 2 sub-agents")).toBeTruthy();
  });

  it("uses singular 'sub-agent' for one sub-agent", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 1000,
        promptTokens: 800,
        completionTokens: 200,
      }),
      [{ name: "researcher", usage: makeUsage({ totalTokens: 500 }) }],
    );

    render(<ExecutionCostSummary execution={execution} />);
    expect(screen.getByText("Includes 1 sub-agent")).toBeTruthy();
  });

  it("does not show sub-agent annotation when no sub-agents have usage", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 1000,
        promptTokens: 800,
        completionTokens: 200,
      }),
      [{ name: "idle-agent" }],
    );

    const { container } = render(
      <ExecutionCostSummary execution={execution} />,
    );
    expect(container.textContent).not.toContain("sub-agent");
  });

  it("shows per-model breakdown when multiple models exist", () => {
    const execution = makeExecution(
      makeUsageWithModels({
        totalTokens: 2000,
        promptTokens: 1500,
        completionTokens: 500,
        estimatedCostUsd: 0.0142,
        primaryModel: "claude-sonnet-4",
        primaryProvider: "anthropic",
        modelBreakdown: [
          makeModelUsage("claude-sonnet-4", "anthropic", {
            estimatedCostUsd: 0.012,
          }),
          makeModelUsage("gpt-4o", "openai", {
            estimatedCostUsd: 0.0022,
          }),
        ],
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    expect(screen.getByText("claude-sonnet-4")).toBeTruthy();
    expect(screen.getByText("$0.0120")).toBeTruthy();
    expect(screen.getByText("gpt-4o")).toBeTruthy();
    expect(screen.getByText("$0.0022")).toBeTruthy();
    expect(
      screen.queryByText("claude-sonnet-4 · anthropic"),
    ).toBeNull();
  });

  it("shows model breakdown list with proper accessibility", () => {
    const execution = makeExecution(
      makeUsageWithModels({
        totalTokens: 2000,
        promptTokens: 1500,
        completionTokens: 500,
        modelBreakdown: [
          makeModelUsage("model-a", "provider-a"),
          makeModelUsage("model-b", "provider-b"),
        ],
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    expect(
      screen.getByRole("list", { name: "Model cost breakdown" }),
    ).toBeTruthy();
  });

  it("has proper region role and aria-label", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
      }),
    );

    render(<ExecutionCostSummary execution={execution} />);

    expect(
      screen.getByRole("region", { name: "Execution cost summary" }),
    ).toBeTruthy();
  });

  it("accepts and applies className", () => {
    const execution = makeExecution(
      makeUsage({
        totalTokens: 100,
        promptTokens: 80,
        completionTokens: 20,
      }),
    );

    render(
      <ExecutionCostSummary execution={execution} className="my-custom" />,
    );

    const region = screen.getByRole("region");
    expect(region.className).toContain("my-custom");
  });
});
