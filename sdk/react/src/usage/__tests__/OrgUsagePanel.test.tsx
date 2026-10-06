/**
 * OrgUsagePanel over a usage report: the summary counts the organization's
 * runs, agents and sessions in compact form; a report with no model usage
 * shows the empty state, which says usage appears once agents start runs;
 * a failed fetch shows the error's user message. The report hook and the
 * credit runway (a billing-account reader with its own tests) are stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { getUserMessage } from "@stigmer/sdk";
import {
  GetOrgUsageReportOutputSchema,
  type GetOrgUsageReportOutput,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";

const state = vi.hoisted(() => ({
  report: null as GetOrgUsageReportOutput | null,
  error: null as Error | null,
}));

vi.mock("../useOrgUsageReport.js", () => ({
  useOrgUsageReport: () => ({ report: state.report, isLoading: false, error: state.error, refetch: () => {} }),
}));

vi.mock("../CreditRunwayIndicator.js", () => ({
  CreditRunwayIndicator: () => null,
}));

import { OrgUsagePanel } from "../OrgUsagePanel";

afterEach(() => {
  cleanup();
  state.report = null;
  state.error = null;
});

describe("OrgUsagePanel", () => {
  it("counts runs, agents and sessions in the summary", () => {
    state.report = create(GetOrgUsageReportOutputSchema, {
      org: "acme",
      totalRuns: 2_340,
      totalAgents: 4,
      totalSessions: 1_200_000,
      modelBreakdown: [{ model: "claude-sonnet", provider: "anthropic", callCount: 10, inputTokens: 500n, outputTokens: 500n }],
    });
    render(<OrgUsagePanel org="acme" />);

    const summary = screen.getByRole("group", { name: "Usage summary" });
    expect(within(summary).getByText("Runs").previousElementSibling?.textContent).toBe("2.3K");
    expect(within(summary).getByText("Agents").previousElementSibling?.textContent).toBe("4");
    expect(within(summary).getByText("Sessions").previousElementSibling?.textContent).toBe("1.2M");
    expect(screen.queryByText("No usage data yet")).toBeNull();
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
