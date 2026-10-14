/**
 * OrgUsagePanel over a usage report: the summary shows the organization's
 * tokens (from `total_usage`), runs, calls, agents and sessions in compact
 * form; the daily chart's tooltip reads a day's tokens and runs; model rows
 * show calls and tokens; the served-by line follows the report's split; a
 * report with no model usage shows the empty state; a failed fetch shows
 * the error's user message; and nothing on the panel is money. The report
 * hook is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { getUserMessage } from "@stigmer/sdk";
import {
  GetOrgUsageReportOutputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ProviderKeySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";

const state = vi.hoisted(() => ({
  report: null as GetOrgUsageReportOutput | null,
  error: null as Error | null,
}));

vi.mock("../useOrgUsageReport.js", () => ({
  useOrgUsageReport: () => ({ report: state.report, isLoading: false, error: state.error, refetch: () => {} }),
}));

import { OrgUsagePanel } from "../OrgUsagePanel";

afterEach(() => {
  cleanup();
  state.report = null;
  state.error = null;
});

function fullReport(): GetOrgUsageReportOutput {
  return create(GetOrgUsageReportOutputSchema, {
    org: "acme",
    totalRuns: 2_340,
    totalAgents: 4,
    totalSessions: 1_200_000,
    totalUsage: {
      totalTokens: 18_400n,
      llmCallCount: 12,
      workingSeconds: 1_123_500n,
      servedBy: [
        { providerKeySource: ProviderKeySource.ORGANIZATION, totalTokens: 16_000n, llmCallCount: 12 },
        { providerKeySource: ProviderKeySource.UNSPECIFIED, totalTokens: 2_400n, llmCallCount: 0 },
      ],
    },
    modelBreakdown: [
      {
        model: "claude-sonnet",
        provider: "anthropic",
        callCount: 12,
        inputTokens: 4_000n,
        outputTokens: 1_400n,
        cacheReadInputTokens: 13_000n,
        totalTokens: 18_400n,
      },
    ],
    dailyUsage: [
      { date: "2026-10-12", runCount: 3, totalTokens: 6_400n, llmCallCount: 4 },
      { date: "2026-10-13", runCount: 1, totalTokens: 12_000n, llmCallCount: 8 },
    ],
    harnessUsage: [{ harness: "native", totalTokens: 18_400n, callCount: 12, runCount: 4 }],
    topAgents: [{ agentId: "agt_1", agentName: "Support Bot", runCount: 4, totalTokens: 18_400n }],
  });
}

describe("OrgUsagePanel", () => {
  it("counts tokens, runs, calls, working time, agents and sessions in the summary", () => {
    state.report = fullReport();
    render(<OrgUsagePanel org="acme" />);

    const summary = screen.getByRole("group", { name: "Usage summary" });
    const value = (label: string) => within(summary).getByText(label).previousElementSibling?.textContent;
    expect(value("Tokens")).toBe("18.4k");
    expect(value("Runs")).toBe("2.3k");
    expect(value("LLM Calls")).toBe("12");
    expect(value("Working time"), "a month of work stays in hours, never days").toBe("312h 5m");
    expect(value("Agents")).toBe("4");
    expect(value("Sessions")).toBe("1.2M");
    expect(screen.queryByText("No usage data yet")).toBeNull();
  });

  it("shows a day's tokens and runs when its bar is hovered", () => {
    state.report = fullReport();
    render(<OrgUsagePanel org="acme" />);

    expect(screen.getByRole("img", { name: "Daily token bar chart" })).toBeTruthy();
    fireEvent.mouseEnter(screen.getAllByTestId("daily-token-bar")[1]!);
    expect(screen.getByText(/12\.0k tokens · 1 run$/)).toBeTruthy();
  });

  it("lists each model's calls, input, output and total tokens", () => {
    state.report = fullReport();
    render(<OrgUsagePanel org="acme" />);

    const table = screen.getByRole("table", { name: "Model usage breakdown" });
    const [header, row] = within(table).getAllByRole("row");
    expect(within(header!).getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
      "Model",
      "Calls",
      "Input",
      "Output",
      "Total",
    ]);
    expect(within(row!).getAllByRole("cell").map((c) => c.textContent)).toEqual([
      "claude-sonnetanthropic",
      "12",
      "17.0k",
      "1.4k",
      "18.4k",
    ]);
  });

  it("says who served the tokens", () => {
    state.report = fullReport();
    render(<OrgUsagePanel org="acme" />);

    expect(screen.getByLabelText("Served by").textContent).toBe("Your keys served 16.0k tokens");
  });

  it("shows no money anywhere", () => {
    state.report = fullReport();
    const { container } = render(<OrgUsagePanel org="acme" />);

    expect(container.textContent).not.toContain("$");
    expect(screen.queryByText(/cost/i)).toBeNull();
  });

  it("shows the empty state when no model was used", () => {
    state.report = create(GetOrgUsageReportOutputSchema, { org: "acme" });
    render(<OrgUsagePanel org="acme" />);

    expect(screen.getByText("No usage data yet")).toBeTruthy();
    expect(screen.getByText(/Usage data will appear here once agents start runs/)).toBeTruthy();
  });

  it("shows the fetch error", () => {
    const error = new Error("usage report unavailable");
    state.error = error;
    render(<OrgUsagePanel org="acme" />);

    expect(screen.getByRole("alert").textContent).toBe(getUserMessage(error));
    expect(screen.queryByRole("group", { name: "Usage summary" })).toBeNull();
  });
});
