/**
 * useDashboardSummary reads one organization for both of its sources: the
 * run summary and the usage report the cost comes from, and it has no
 * summary to show while the run summary is still loading. The two source
 * hooks are stubbed; each records the organization it was asked for.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const asked = vi.hoisted(() => ({
  agent: [] as unknown[],
  usage: [] as unknown[],
  agentLoading: false,
}));

vi.mock("../useRunSummary.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useRunSummary.js")>();
  return {
    ...actual,
    useRunSummary: (options: { org: unknown }) => {
      asked.agent.push(options.org);
      return { summary: null, isLoading: asked.agentLoading, error: null, refetch: () => {} };
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
    expect(asked.agent.at(-1)).toBe("acme");
    expect(asked.usage.at(-1)).toBe("acme");
  });

  it("asks the usage report for nothing when no organization is selected", () => {
    renderHook(() => useDashboardSummary({ org: undefined }));
    expect(asked.usage.at(-1)).toBeNull();
  });

  it("has no summary while the run summary is loading, and zeros once it settles empty", () => {
    asked.agentLoading = true;
    const { result, rerender } = renderHook(() => useDashboardSummary({ org: "acme" }));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.summary).toBeNull();

    asked.agentLoading = false;
    rerender();
    expect(result.current.summary).toMatchObject({
      activeCount: 0,
      completedCount: 0,
      failedCount: 0,
      totalCostUsd: 0,
    });
  });
});
