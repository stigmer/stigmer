/**
 * Pins the run page both consoles draw at a run's address: nothing of its
 * own while the run resolves; the run's conversation handed to the host
 * once, when its session resolves; "Run not found" with the way to the
 * dashboard when nothing resolves; and a failed read said as a failure,
 * with Try again, never as a missing run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UseResolveRunSessionReturn } from "../../run/useResolveRunSession";
import { RunResolveView } from "../RunResolveView";

const read = vi.hoisted(() => ({
  answer: { sessionId: null, isLoading: false, error: null, refetch: () => {} } as UseResolveRunSessionReturn,
  asked: [] as Array<string | null>,
}));

vi.mock("../../run/useResolveRunSession.js", () => ({
  useResolveRunSession: (runId: string | null) => {
    read.asked.push(runId);
    return read.answer;
  },
}));

beforeEach(() => {
  read.answer = { sessionId: null, isLoading: false, error: null, refetch: () => {} };
  read.asked = [];
});
afterEach(cleanup);

describe("RunResolveView", () => {
  it("shows nothing of its own while the run resolves", () => {
    read.answer = { ...read.answer, isLoading: true };
    const { container } = render(<RunResolveView runId="run_1" onResolved={vi.fn()} dashboardHref="/" />);
    expect(container.innerHTML).toBe("");
    expect(read.asked).toContain("run_1");
  });

  it("hands the run's session to the host once it resolves", () => {
    read.answer = { ...read.answer, sessionId: "ses_1" };
    const onResolved = vi.fn();
    const { container, rerender } = render(<RunResolveView runId="run_1" onResolved={onResolved} dashboardHref="/" />);
    rerender(<RunResolveView runId="run_1" onResolved={onResolved} dashboardHref="/" />);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith("ses_1");
    expect(container.innerHTML).toBe("");
  });

  it("names the missing run and links to the host's dashboard", () => {
    render(<RunResolveView runId="run_missing" onResolved={vi.fn()} dashboardHref="/dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Run not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/dashboard");
  });

  it("says the run failed to load, not that it is missing, and retries on request", async () => {
    const refetch = vi.fn();
    read.answer = { ...read.answer, error: new Error("connection refused"), refetch };
    render(<RunResolveView runId="run_flaky" onResolved={vi.fn()} dashboardHref="/" />);
    expect(screen.getByRole("heading", { level: 1, name: "Failed to load run" })).toBeTruthy();
    expect(screen.queryByText("Run not found")).toBeNull();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
