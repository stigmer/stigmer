// The #362 console surface: the Usage tab pairs billing's RESOLVED
// per-execution model (the after-the-fact truth for Cursor Auto runs)
// with the tier the runner REQUESTED (the streaming summary's audit
// record that the account default was never left in control).

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ServiceTier } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseSessionUsageReturn } from "../useSessionUsage.js";

// UsageTab's render contract is what this suite pins; the aggregation
// itself (billing-report-wins, streaming fallback, breakdown mapping) is
// useSessionUsage's own suite. Mocking the hook also spares the RPC
// provider plumbing.
const usageMock = vi.hoisted(() => vi.fn<() => UseSessionUsageReturn>());
vi.mock("../useSessionUsage.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useSessionUsage: () => usageMock(),
}));

import { UsageTab } from "../facets/UsageTab.js";

// UsageWidget re-aggregates via the real hook internally — with the module
// mocked above it sees the same mocked value, which is exactly the intent.

const EMPTY_USAGE: UseSessionUsageReturn = {
  totalCostUsd: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  llmCallCount: 0,
  modelBreakdown: [],
  executionBreakdown: [],
  primaryModel: "",
  primaryProvider: "",
  hasUsage: false,
  isEstimated: false,
};

function usageWith(overrides: Partial<UseSessionUsageReturn>): UseSessionUsageReturn {
  return {
    ...EMPTY_USAGE,
    hasUsage: true,
    totalCostUsd: 0.0123,
    totalTokens: 100,
    llmCallCount: 1,
    primaryModel: "composer-2.5",
    primaryProvider: "cursor",
    ...overrides,
  };
}

function executionWithTier(id: string, tier?: ServiceTier) {
  return create(AgentExecutionSchema, {
    metadata: { id },
    spec: { sessionId: "ses_1" },
    status: {
      streamingUsage: {
        totalTokens: 100n,
        turnCount: 1,
        estimatedCostUsd: 0.01,
        model: "default",
        ...(tier !== undefined ? { requestedServiceTier: tier } : {}),
      },
    },
  });
}

afterEach(cleanup);

describe("UsageTab (#362 model provenance)", () => {
  it("shows the empty state when no usage exists", () => {
    usageMock.mockReturnValue(EMPTY_USAGE);
    render(<UsageTab executions={[]} />);
    expect(screen.getByText(/No usage data yet/)).toBeTruthy();
  });

  it("renders the billing-resolved model per run with its cost — the Auto forensics view", () => {
    usageMock.mockReturnValue(usageWith({
      executionBreakdown: [{
        executionId: "exe_1",
        resolvedModel: "cursor-grok-4.5-high-fast",
        billableCostUsd: 0.0123,
        isEstimated: false,
      }],
    }));

    render(<UsageTab executions={[executionWithTier("exe_1", ServiceTier.STANDARD)]} />);

    expect(screen.getByText(/cursor-grok-4\.5-high-fast/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Per-execution model and tier" })).toBeTruthy();
  });

  it("pairs the run with the tier the runner requested", () => {
    usageMock.mockReturnValue(usageWith({
      executionBreakdown: [{
        executionId: "exe_1",
        resolvedModel: "composer-2.5",
        billableCostUsd: 0.0123,
        isEstimated: false,
      }],
    }));

    render(<UsageTab executions={[executionWithTier("exe_1", ServiceTier.FAST)]} />);

    expect(screen.getByText("fast requested")).toBeTruthy();
  });

  it("omits the tier chip for executions that predate the tier attribute", () => {
    usageMock.mockReturnValue(usageWith({
      executionBreakdown: [{
        executionId: "exe_0",
        resolvedModel: "claude-haiku-4.5",
        billableCostUsd: 0.0042,
        isEstimated: false,
      }],
    }));

    render(<UsageTab executions={[executionWithTier("exe_0")]} />);

    expect(screen.getByText(/claude-haiku-4\.5/)).toBeTruthy();
    expect(screen.queryByText(/requested/)).toBeNull();
  });

  it("renders no provenance list before any billing record lands", () => {
    usageMock.mockReturnValue(usageWith({ executionBreakdown: [] }));

    render(<UsageTab executions={[executionWithTier("exe_1", ServiceTier.STANDARD)]} />);

    expect(screen.queryByRole("list", { name: "Per-execution model and tier" })).toBeNull();
  });
});
