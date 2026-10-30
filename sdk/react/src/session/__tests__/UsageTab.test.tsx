/**
 * The session Usage tab: the session's tokens (never money) and working
 * time, and per run its tokens, working time and primary model (the
 * after-the-fact truth of which model served) paired with the tier the
 * runner REQUESTED (the streaming summary's audit record that the account
 * default was never left in control, #362), marked "Estimated" for a run
 * counted from its runner's own report.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { UseSessionUsageReturn } from "@stigmer/react-core";

// UsageTab's render contract is what this suite pins; the aggregation
// itself (report mapping, polling) is
// useSessionUsage's own suite. Mocking the hook also spares the RPC
// provider plumbing.
const usageMock = vi.hoisted(() => vi.fn<() => UseSessionUsageReturn>());
vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useSessionUsage: () => usageMock(),
}));

import { UsageTab } from "../facets/UsageTab.js";

// UsageWidget re-aggregates via the real hook internally — with the module
// mocked above it sees the same mocked value, which is exactly the intent.

const EMPTY_USAGE: UseSessionUsageReturn = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  llmCallCount: 0,
  workingSeconds: 0,
  modelBreakdown: [],
  runBreakdown: [],
  servedBy: [],
  primaryModel: "",
  primaryProvider: "",
  hasUsage: false,
  isEstimated: false,
};

function usageWith(overrides: Partial<UseSessionUsageReturn>): UseSessionUsageReturn {
  return {
    ...EMPTY_USAGE,
    hasUsage: true,
    totalTokens: 18_400,
    llmCallCount: 1,
    primaryModel: "claude-sonnet-4-6",
    primaryProvider: "anthropic",
    ...overrides,
  };
}

function executionWithTier(id: string, tier?: ServiceTier) {
  return create(RunSchema, {
    metadata: { id },
    spec: { target: { case: "sessionId", value: "ses_1" } },
    status: {
      streamingUsage: {
        totalTokens: 100n,
        turnCount: 1,
        estimatedCostUsd: 0.01,
        model: "claude-sonnet-4-6",
        ...(tier !== undefined ? { requestedServiceTier: tier } : {}),
      },
    },
  });
}

afterEach(cleanup);

describe("UsageTab (#362 model provenance)", () => {
  it("shows the empty state when no usage exists", () => {
    usageMock.mockReturnValue(EMPTY_USAGE);
    render(<UsageTab runs={[]} />);
    expect(screen.getByText(/No usage data yet/)).toBeTruthy();
  });

  it("shows the session's tokens and each run's model with its tokens, and no money", () => {
    usageMock.mockReturnValue(usageWith({
      runBreakdown: [{
        runId: "exe_1",
        resolvedModel: "claude-opus-4-8-fast",
        totalTokens: 12_300,
        isEstimated: false,
        workingSeconds: 0,
      }],
    }));

    const { container } = render(<UsageTab runs={[executionWithTier("exe_1", ServiceTier.STANDARD)]} />);

    expect(screen.getByRole("region", { name: "Session usage summary" }).textContent).toContain("18.4k tokens");
    const list = screen.getByRole("list", { name: "Per-run tokens, working time, model and tier" });
    expect(list.textContent).toContain("claude-opus-4-8-fast");
    expect(list.textContent).toContain("12.3k tokens");
    expect(container.textContent).not.toContain("$");
  });

  it("shows the session's working time and each run's, never days", () => {
    usageMock.mockReturnValue(usageWith({
      workingSeconds: 4_000,
      runBreakdown: [
        { runId: "exe_1", resolvedModel: "claude-sonnet", totalTokens: 900, isEstimated: false, workingSeconds: 252 },
        { runId: "exe_2", resolvedModel: "claude-sonnet", totalTokens: 300, isEstimated: false, workingSeconds: 3_748 },
      ],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1"), executionWithTier("exe_2")]} />);

    expect(screen.getByText("1h 6m")).toBeTruthy();
    const items = screen.getAllByRole("listitem").map((item) => item.textContent);
    expect(items[0]).toContain("900 tokens · 4m 12s");
    expect(items[1]).toContain("300 tokens · 1h 2m");
  });

  it("marks a run counted from its runner's report as estimated", () => {
    usageMock.mockReturnValue(usageWith({
      isEstimated: true,
      runBreakdown: [{ runId: "exe_1", resolvedModel: "claude-sonnet-4-6", totalTokens: 900, isEstimated: true, workingSeconds: 0 }],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const list = screen.getByRole("list", { name: "Per-run tokens, working time, model and tier" });
    expect(list.textContent).toContain("Estimated");
    expect(list.textContent).toContain("900 tokens");
  });

  it("pairs the run with the tier the runner requested", () => {
    usageMock.mockReturnValue(usageWith({
      runBreakdown: [{
        runId: "exe_1",
        resolvedModel: "claude-opus-4-8",
        totalTokens: 100,
        isEstimated: false,
        workingSeconds: 0,
      }],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1", ServiceTier.FAST)]} />);

    expect(screen.getByText("fast requested")).toBeTruthy();
  });

  it("omits the tier chip for executions that predate the tier attribute", () => {
    usageMock.mockReturnValue(usageWith({
      runBreakdown: [{
        runId: "exe_0",
        resolvedModel: "claude-haiku-4.5",
        totalTokens: 100,
        isEstimated: false,
        workingSeconds: 0,
      }],
    }));

    render(<UsageTab runs={[executionWithTier("exe_0")]} />);

    expect(screen.getByText(/claude-haiku-4\.5/)).toBeTruthy();
    expect(screen.queryByText(/requested/)).toBeNull();
  });

  it("the session widget shows the cache split, read and write", () => {
    usageMock.mockReturnValue(usageWith({ inputTokens: 1_200, outputTokens: 800, cacheReadTokens: 13_000, cacheCreationTokens: 400 }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const summary = screen.getByRole("region", { name: "Session usage summary" }).textContent;
    expect(summary).toContain("prompt 1.2k · completion 800");
    expect(summary).toContain("cache 13.0k read · 400 write");
  });

  it("renders no per-run list before the report lists any run", () => {
    usageMock.mockReturnValue(usageWith({ runBreakdown: [] }));

    render(<UsageTab runs={[executionWithTier("exe_1", ServiceTier.STANDARD)]} />);

    expect(screen.queryByRole("list", { name: "Per-run tokens, working time, model and tier" })).toBeNull();
  });
});
