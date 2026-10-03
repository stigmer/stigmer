/**
 * useDashboardSummary reads one organization for all three of its sources:
 * the workflow and agent summaries and the usage report the cost comes from.
 * The three source hooks are stubbed; each records the organization it was
 * asked for.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({ workflow: [] as unknown[], agent: [] as unknown[], usage: [] as unknown[] }));

vi.mock("../../workflow/useWorkflowDashboardSummary.js", () => ({
  useWorkflowDashboardSummary: (options: { org: unknown }) => {
    asked.workflow.push(options.org);
    return { summary: null, isLoading: false, error: null, refetch: () => {} };
  },
}));

vi.mock("../useAgentExecutionSummary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useAgentExecutionSummary.js")>();
  return {
    ...actual,
    useAgentExecutionSummary: (options: { org: unknown }) => {
      asked.agent.push(options.org);
      return { summary: null, isLoading: false, error: null, refetch: () => {} };
    },
  };
});

vi.mock("../../usage/useOrgUsageReport.js", () => ({
  useOrgUsageReport: (org: unknown) => {
    asked.usage.push(org);
    return { report: null, isLoading: false, error: null, refetch: () => {} };
  },
}));

import { useDashboardSummary } from "../useDashboardSummary";

describe("useDashboardSummary", () => {
  it("asks every source for the one organization it was given", () => {
    renderHook(() => useDashboardSummary({ org: "acme" }));
    expect(asked.workflow.at(-1)).toBe("acme");
    expect(asked.agent.at(-1)).toBe("acme");
    expect(asked.usage.at(-1)).toBe("acme");
  });

  it("asks the usage report for nothing when no organization is selected", () => {
    renderHook(() => useDashboardSummary({ org: undefined }));
    expect(asked.usage.at(-1)).toBeNull();
  });
});
