/**
 * Pins the run page both consoles draw at a run's address: "Opening the
 * conversation…" while the run resolves, never a blank page; the run's
 * conversation handed to the host once, when its session resolves; "This
 * run isn't here" with the way to the conversations when nothing resolves;
 * and a failed read said as a failure, with Try again, never as a missing run.
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
  it("says it is opening the conversation while the run resolves", () => {
    read.answer = { ...read.answer, isLoading: true };
    render(<RunResolveView runId="run_1" onResolved={vi.fn()} conversationsHref="/conversations" />);
    expect(screen.getByRole("status").textContent).toBe("Opening the conversation…");
    expect(read.asked).toContain("run_1");
  });

  it("hands the run's session to the host once it resolves", () => {
    read.answer = { ...read.answer, sessionId: "ses_1" };
    const onResolved = vi.fn();
    const { rerender } = render(<RunResolveView runId="run_1" onResolved={onResolved} conversationsHref="/conversations" />);
    rerender(<RunResolveView runId="run_1" onResolved={onResolved} conversationsHref="/conversations" />);
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith("ses_1");
    expect(screen.getByRole("status").textContent).toBe("Opening the conversation…");
  });

  it("names the missing run and links to the host's conversations", () => {
    render(<RunResolveView runId="run_missing" onResolved={vi.fn()} conversationsHref="/conversations" />);
    expect(screen.getByText("This run isn't here")).toBeTruthy();
    expect(screen.getByText("It may have been deleted, or it belongs to an organization you're not in.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to conversations" }).getAttribute("href")).toBe("/conversations");
  });

  it("says the run failed to load, not that it is missing, and retries on request", async () => {
    const refetch = vi.fn();
    read.answer = { ...read.answer, error: new Error("connection refused"), refetch };
    render(<RunResolveView runId="run_flaky" onResolved={vi.fn()} conversationsHref="/conversations" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer couldn't open this run.");
    expect(alert.textContent).toContain("The run itself is unaffected.");
    expect(screen.queryByText("This run isn't here")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
