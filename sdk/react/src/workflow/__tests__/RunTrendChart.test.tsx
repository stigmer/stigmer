/**
 * Pins RunTrendChart's phase distribution: segments only for known phases
 * with runs, ordered by count descending, each segment's width its share
 * of the total, and the legend's label and count; the empty state when no
 * summary or no runs, and the busy skeleton while loading.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { RunTrendChart } from "../RunTrendChart";

afterEach(cleanup);

describe("RunTrendChart", () => {
  it("draws known phases with runs, largest first, sized by their share", () => {
    const summary = create(RunSummarySchema, {
      phaseCounts: {
        [RunPhase.RUN_COMPLETED]: 1,
        [RunPhase.RUN_FAILED]: 3,
        [RunPhase.RUN_PAUSED]: 0,
        99: 5,
      },
    });
    const { container } = render(
      <RunTrendChart summary={summary} isLoading={false} />,
    );

    expect(screen.getByText("Run Distribution")).toBeTruthy();
    expect(screen.getByText("4 total")).toBeTruthy();
    const bar = screen.getByRole("img", { name: "Run phase distribution" });
    expect(
      Array.from(bar.children).map((c) => (c as HTMLElement).style.width),
    ).toEqual(["75%", "25%"]);
    const legend = Array.from(
      container.querySelectorAll("span.stg\\:flex"),
    ).map((s) => s.textContent);
    expect(legend).toEqual(["Failed3", "Completed1"]);
    expect(screen.queryByText("Paused")).toBeNull();
  });

  it("shows the empty state for no summary and for a summary without runs", () => {
    const { rerender } = render(<RunTrendChart summary={null} isLoading={false} />);
    expect(screen.getByText("Run Distribution")).toBeTruthy();
    expect(screen.getByText("No run data available")).toBeTruthy();

    rerender(
      <RunTrendChart summary={create(RunSummarySchema, {})} isLoading={false} />,
    );
    expect(screen.getByText("No run data available")).toBeTruthy();
  });

  it("shows a busy skeleton while loading", () => {
    const { container } = render(<RunTrendChart summary={null} isLoading />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
    expect(screen.queryByText("Run Distribution")).toBeNull();
  });
});
