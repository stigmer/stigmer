/**
 * Pins RunSummaryWidget's reading of a RunSummary: the four stat cards
 * (active, completed, failed, total cost) from the summary's counts, the
 * average duration and run total line, and the phase breakdown bar and
 * legend, which list only phases with runs and name an unknown phase by
 * its number. Loading shows a busy skeleton; no summary renders nothing.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { RunSummaryWidget } from "../RunSummaryWidget";

afterEach(cleanup);

function statValue(label: string): string | null {
  const labelEl = screen.getByText(label, { selector: "p" });
  return labelEl.nextElementSibling?.textContent ?? null;
}

describe("RunSummaryWidget", () => {
  it("shows the stat cards, average duration, total and phase breakdown of a summary", () => {
    const summary = create(RunSummarySchema, {
      activeCount: 2,
      phaseCounts: {
        [RunPhase.RUN_PENDING]: 1,
        [RunPhase.RUN_COMPLETED]: 6,
        [RunPhase.RUN_FAILED]: 3,
        [RunPhase.RUN_CANCELLED]: 0,
        99: 2,
      },
      totalCost: { totalCostUsd: 1.234 },
      avgDuration: { seconds: 125n },
    });
    render(<RunSummaryWidget summary={summary} isLoading={false} />);

    expect(statValue("Active")).toBe("2");
    expect(statValue("Completed")).toBe("6");
    expect(statValue("Failed")).toBe("3");
    expect(statValue("Total Cost")).toBe("$1.23");
    expect(screen.getByText("2m 5s")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    const bar = screen.getByRole("img", { name: "Run phase breakdown" });
    const widths = Array.from(bar.children).map(
      (c) => (c as HTMLElement).style.width,
    );
    expect(widths).toHaveLength(4);
    expect(screen.getByText("Pending: 1")).toBeTruthy();
    expect(screen.getByText("Completed: 6")).toBeTruthy();
    expect(screen.getByText("Failed: 3")).toBeTruthy();
    expect(screen.getByText("Phase 99: 2")).toBeTruthy();
    expect(screen.queryByText(/Cancelled:/)).toBeNull();
  });

  it("shows zero counts and $0.00 for an empty summary, with no breakdown", () => {
    render(
      <RunSummaryWidget summary={create(RunSummarySchema, {})} isLoading={false} />,
    );

    expect(statValue("Completed")).toBe("0");
    expect(statValue("Failed")).toBe("0");
    expect(statValue("Total Cost")).toBe("$0.00");
    expect(screen.queryByRole("img", { name: "Run phase breakdown" })).toBeNull();
    expect(screen.queryByText(/Avg duration/)).toBeNull();
  });

  it("shows a busy skeleton while loading and nothing without a summary", () => {
    const { container, rerender } = render(
      <RunSummaryWidget summary={null} isLoading />,
    );
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();

    rerender(<RunSummaryWidget summary={null} isLoading={false} />);
    expect(container.innerHTML).toBe("");
  });
});
