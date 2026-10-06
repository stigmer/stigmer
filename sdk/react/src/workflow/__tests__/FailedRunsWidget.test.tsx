/**
 * Pins FailedRunsWidget: one row per failed run with its name (slug, then
 * "Unnamed"), its error ("Unknown error" when none) and when it failed; the
 * View button hands the host the run's id and is absent without a
 * handler; the empty state and the loading skeleton.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { FailedRunsWidget } from "../FailedRunsWidget";

afterEach(cleanup);

const runs = [
  create(WorkflowRunSchema, {
    metadata: { id: "wfr_1", name: "nightly-report" },
    status: {
      error: "task build failed",
      audit: { specAudit: { updatedAt: timestampFromDate(new Date(Date.now() - 5 * 60_000)) } },
    },
  }),
  create(WorkflowRunSchema, { metadata: { id: "wfr_2", slug: "weekly-digest" } }),
  create(WorkflowRunSchema, { metadata: { id: "wfr_3" } }),
];

describe("FailedRunsWidget", () => {
  it("lists each failed run with its name, error and failure time", () => {
    render(<FailedRunsWidget runs={runs} isLoading={false} />);

    expect(screen.getByText("Recent Failures")).toBeTruthy();
    expect(screen.getByText("nightly-report")).toBeTruthy();
    expect(screen.getByText("task build failed")).toBeTruthy();
    expect(screen.getByText("weekly-digest")).toBeTruthy();
    expect(screen.getByText("Unnamed")).toBeTruthy();
    expect(screen.getAllByText("Unknown error")).toHaveLength(2);
    expect(screen.getByText("5m")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "View" })).toBeNull();
  });

  it("hands the host the run id when View is clicked", () => {
    const onViewClick = vi.fn();
    render(<FailedRunsWidget runs={runs} isLoading={false} onViewClick={onViewClick} />);

    fireEvent.click(screen.getAllByRole("button", { name: "View" })[1]!);
    expect(onViewClick).toHaveBeenCalledWith("wfr_2");
  });

  it("shows the empty state and the loading skeleton", () => {
    const { container, rerender } = render(<FailedRunsWidget runs={[]} isLoading={false} />);
    expect(screen.getByText("No recent failures")).toBeTruthy();

    rerender(<FailedRunsWidget runs={[]} isLoading />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
