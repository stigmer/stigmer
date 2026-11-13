/**
 * The session Usage tab: the session's total tokens first, as a figure
 * (never money), with its working time under it; then "By turn" and "By
 * model" lists. Per run, its tokens, working time and primary model (the
 * after-the-fact truth of which model served) paired with the tier the
 * runner REQUESTED (the streaming summary's audit record that the account
 * default was never left in control, #362), marked "Estimated" for a run
 * counted from its runner's own report.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
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

describe("UsageTab with no model to name", () => {
  it("lists no By model rows when the report names neither a breakdown nor a primary model", () => {
    usageMock.mockReturnValue(usageWith({ primaryModel: "", primaryProvider: "", modelBreakdown: [] }));
    render(<UsageTab runs={[]} />);
    expect(screen.queryByText("By model")).toBeNull();
  });
});

describe("UsageTab (#362 model provenance)", () => {
  it("says there is no usage yet, and what will appear once a turn runs", () => {
    usageMock.mockReturnValue(EMPTY_USAGE);
    render(<UsageTab runs={[]} />);
    expect(screen.getByRole("status").textContent).toBe(
      "No usage yet Tokens and working time appear here once a turn runs.",
    );
  });

  it("leads with the total as a figure and its unit, marked Estimated when the figures are estimates", () => {
    usageMock.mockReturnValue(usageWith({ totalTokens: 41_210, workingSeconds: 74, isEstimated: true }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const summary = screen.getByRole("region", { name: "Session usage summary" });
    const figure = within(summary).getByText("41,210");
    expect(figure.className).toContain("stg:text-xl");
    expect(figure.className).toContain("stg:font-semibold");
    expect(within(summary).getByText("tokens")).toBeTruthy();
    expect(within(summary).getByText("Estimated")).toBeTruthy();
    expect(within(summary).getByText("1m 14s working")).toBeTruthy();
  });

  it("leaves out the Estimated tag and the working time when they do not exist", () => {
    usageMock.mockReturnValue(usageWith({ totalTokens: 1, workingSeconds: 0, isEstimated: false }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const summary = screen.getByRole("region", { name: "Session usage summary" });
    expect(within(summary).getByText("token")).toBeTruthy();
    expect(within(summary).queryByText("Estimated")).toBeNull();
    expect(summary.textContent).not.toContain("working");
  });

  it("titles its sections in sentence case: By turn, then By model", () => {
    usageMock.mockReturnValue(usageWith({
      runBreakdown: [{ runId: "exe_1", resolvedModel: "claude-sonnet", totalTokens: 900, isEstimated: false, workingSeconds: 0 }],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["By turn", "By model"]);
  });

  it("lists the tokens by model, each with its calls and its input and output", () => {
    usageMock.mockReturnValue(usageWith({
      modelBreakdown: [
        { model: "claude-sonnet", provider: "anthropic", totalTokens: 41_210, inputTokens: 36_904, outputTokens: 4_306, cacheCreationTokens: 0, cacheReadTokens: 0, callCount: 7 },
        { model: "gpt-5.3", provider: "openai", totalTokens: 2_400, inputTokens: 2_000, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 0, callCount: 1 },
      ],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const rows = within(screen.getByRole("list", { name: "Tokens by model" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("claude-sonnet");
    expect(rows[0]!.textContent).toContain("41,210");
    expect(rows[0]!.textContent).toContain("anthropic · 7 model calls · Input 36,904 · output 4,306");
    expect(rows[1]!.textContent).toContain("1 model call · Input 2,000 · output 400");
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

    expect(screen.getByRole("region", { name: "Session usage summary" }).textContent).toContain("18,400");
    const list = screen.getByRole("list", { name: "Tokens by turn" });
    expect(list.textContent).toContain("Turn 1");
    expect(list.textContent).toContain("claude-opus-4-8-fast");
    expect(list.textContent).toContain("12,300");
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

    expect(screen.getByText("1h 6m working")).toBeTruthy();
    const items = within(screen.getByRole("list", { name: "Tokens by turn" }))
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(items[0]).toContain("Turn 1");
    expect(items[0]).toContain("900");
    expect(items[0]).toContain("claude-sonnet · 4m 12s");
    expect(items[1]).toContain("Turn 2");
    expect(items[1]).toContain("300");
    expect(items[1]).toContain("claude-sonnet · 1h 2m");
  });

  it("marks a run counted from its runner's report as estimated", () => {
    usageMock.mockReturnValue(usageWith({
      isEstimated: true,
      runBreakdown: [{ runId: "exe_1", resolvedModel: "claude-sonnet-4-6", totalTokens: 900, isEstimated: true, workingSeconds: 0 }],
    }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    const list = screen.getByRole("list", { name: "Tokens by turn" });
    expect(list.textContent).toContain("Estimated");
    expect(list.textContent).toContain("900");
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

  it("shows the input, output and cache split, read and write, by model", () => {
    usageMock.mockReturnValue(usageWith({ inputTokens: 1_200, outputTokens: 800, cacheReadTokens: 13_000, cacheCreationTokens: 400 }));

    render(<UsageTab runs={[executionWithTier("exe_1")]} />);

    // With no per-model rows in the report, the primary model carries the
    // session's own split.
    const byModel = screen.getByRole("list", { name: "Tokens by model" }).textContent;
    expect(byModel).toContain("claude-sonnet-4-6");
    expect(byModel).toContain("Input 1,200 · output 800 · cache read 13,000 · cache write 400");
  });

  it("renders no By turn list before the report lists any run", () => {
    usageMock.mockReturnValue(usageWith({ runBreakdown: [] }));

    render(<UsageTab runs={[executionWithTier("exe_1", ServiceTier.STANDARD)]} />);

    expect(screen.queryByRole("list", { name: "Tokens by turn" })).toBeNull();
  });
});
