/**
 * Pins the composed dashboard's wiring: both data hooks read the one
 * organization it was given, the KPI cards and the recent failures render
 * inside the labelled region, and a failed run's View hands its id to the
 * host. Then what replaces them: an organization where nothing has ever run
 * sees its first steps alone (asked of all time, so a quiet week in a busy
 * organization keeps its figures, and only a host that passes the steps'
 * links pays that read); figures that could not be read are said with a
 * retry, never drawn as zeros; no organization is said, not drawn. The data
 * hooks are stubbed; the cards, the failures list and the first steps are
 * pinned in their own suites.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ConnectError, Code } from "@connectrpc/connect";
import type { DashboardSummary } from "../types";

const state = vi.hoisted(() => ({
  asked: { summary: [] as unknown[], failed: [] as unknown[], ever: [] as unknown[] },
  week: null as DashboardSummary | null,
  weekError: null as Error | null,
  everRuns: 0,
  refetch: (() => {}) as () => void,
}));

vi.mock("../useDashboardSummary.js", () => ({
  useDashboardSummary: (options: { org: unknown }) => {
    state.asked.summary.push(options.org);
    return { summary: state.week, isLoading: false, error: state.weekError, refetch: state.refetch };
  },
}));

vi.mock("../useRunSummary.js", () => ({
  RunSummaryTimeWindow: { LAST_7D: 2, ALL_TIME: 4 },
  useRunSummary: (options: { org: unknown; timeWindow: number }) => {
    state.asked.ever.push(options.org);
    return {
      summary: options.org ? { activeCount: 0, phaseCounts: { 3: state.everRuns } } : null,
      isLoading: false,
      isRefetching: false,
      error: null,
      refetch: () => {},
    };
  },
}));

vi.mock("../useDashboardFailedRuns.js", () => ({
  useDashboardFailedRuns: (org: unknown) => {
    state.asked.failed.push(org);
    return {
      failedRuns: [
        {
          id: "run_9",
          name: "Nightly triage",
          error: "model refused",
          failedAt: new Date("2026-10-01T00:00:00Z"),
          resourceName: "triage-bot",
        },
      ],
      isLoading: false,
      error: null,
      refetch: () => {},
    };
  },
}));

vi.mock("../../models/useModelReadiness.js", () => ({
  useModelReadiness: () => ({ providers: [] }),
}));

// The first steps ask the server who may create an agent; here the answer is yes.
vi.mock("../../grant/useCheckPermission.js", () => ({
  useCheckPermission: () => ({ allowed: true, isLoading: false, error: null, refetch: () => {} }),
}));

import { OperationalDashboard } from "../OperationalDashboard";

const BUSY: DashboardSummary = { activeCount: 1, completedCount: 3, failedCount: 1, totalTokens: 0, orgUsage: null };
const QUIET: DashboardSummary = { activeCount: 0, completedCount: 0, failedCount: 0, totalTokens: 0, orgUsage: null };
const LINKS = { connectProvider: "/models", createAgent: "/library/agents/new", startSession: "/" };

beforeEach(() => {
  state.asked = { summary: [], failed: [], ever: [] };
  state.week = BUSY;
  state.weekError = null;
  state.everRuns = 0;
  state.refetch = () => {};
});

afterEach(cleanup);

describe("OperationalDashboard", () => {
  it("reads one organization and renders the cards and the failures in its region", () => {
    const onFailedRunClick = vi.fn();
    render(<OperationalDashboard org="acme" onFailedRunClick={onFailedRunClick} />);

    expect(state.asked.summary.at(-1)).toBe("acme");
    expect(state.asked.failed.at(-1)).toBe("acme");

    const region = screen.getByRole("region", { name: "Platform dashboard" });
    expect(within(region).getByText("Completed").nextElementSibling?.textContent).toBe("3");
    expect(within(region).getByText("Nightly triage")).toBeTruthy();

    fireEvent.click(within(region).getByRole("button", { name: "View" }));
    expect(onFailedRunClick).toHaveBeenCalledWith("run_9");
  });

  it("shows an organization where nothing has ever run its first steps alone, in the figures' place", () => {
    state.week = QUIET;
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    const region = screen.getByRole("region", { name: "Platform dashboard" });
    expect(within(region).getByRole("region", { name: "Get your organization running" })).toBeTruthy();
    expect(within(region).getByRole("link", { name: "Make an agent" }).getAttribute("href")).toBe("/library/agents/new");
    expect(within(region).queryByText("Completed")).toBeNull();
    expect(within(region).queryByText("Nightly triage")).toBeNull();
    expect(state.asked.ever.at(-1)).toBe("acme");
  });

  it("keeps a quiet week's figures for an organization that ran before", () => {
    state.week = QUIET;
    state.everRuns = 12;
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    expect(screen.getByText("Completed").nextElementSibling?.textContent).toBe("0");
    expect(screen.queryByRole("region", { name: "Get your organization running" })).toBeNull();
  });

  it("asks nothing of all time for a busy week, nor for a host that passes no first steps", () => {
    const { unmount } = render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);
    expect(state.asked.ever.every((org) => org === null)).toBe(true);
    unmount();

    state.week = QUIET;
    render(<OperationalDashboard org="acme" />);
    expect(state.asked.ever.every((org) => org === null)).toBe(true);
    expect(screen.queryByRole("region", { name: "Get your organization running" })).toBeNull();
  });

  it("says figures that could not be read, with a retry, and draws no zeros in their place", () => {
    state.week = QUIET;
    // A transient refusal, which the message offers to retry.
    state.weekError = new ConnectError("the usage report is unavailable", Code.Unavailable);
    state.refetch = vi.fn();
    render(<OperationalDashboard org="acme" firstStepLinks={LINKS} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The week's figures could not be read");
    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    expect(state.refetch).toHaveBeenCalled();
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.queryByRole("region", { name: "Get your organization running" })).toBeNull();
  });

  it("says when no organization is active instead of drawing its figures", () => {
    render(<OperationalDashboard org="" firstStepLinks={LINKS} />);

    expect(screen.getByText("No organization selected")).toBeTruthy();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
