/**
 * Pins RunComparisonView over a faked client: it fetches both runs, says
 * so while loading, reports a fetch failure with the error's message,
 * renders nothing while either run is missing, and otherwise labels the
 * base and compare runs (by name, or by id when unnamed) with their phase
 * badges, calls out the first diverging task, renders the summary cards
 * and the task table, and calls `onBack` from Back.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema, type WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FetchCacheContext } from "../../../internal/FetchCacheProvider";
import { RunComparisonView } from "../RunComparisonView";

afterEach(cleanup);

const BASE = create(WorkflowRunSchema, {
  metadata: { id: "wfr-base", name: "" },
  status: {
    phase: RunPhase.RUN_FAILED,
    tasks: [
      { taskName: "fetch", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
      { taskName: "publish", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "denied" },
    ],
  },
});
const COMPARE = create(WorkflowRunSchema, {
  metadata: { id: "wfr-good", name: "good-run" },
  status: {
    phase: RunPhase.RUN_COMPLETED,
    tasks: [
      { taskName: "fetch", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
      { taskName: "publish", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED },
    ],
  },
});

function wrapperFor(get: (id: string) => Promise<WorkflowRun | null>) {
  const client = { workflowRun: { get } };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("RunComparisonView", () => {
  it("labels both runs, calls out the divergence and goes back", async () => {
    const get = vi.fn(async (id: string) => (id === "wfr-base" ? BASE : COMPARE));
    const Wrapper = wrapperFor(get);
    const onBack = vi.fn();
    render(
      <Wrapper>
        <RunComparisonView baseRunId="wfr-base" compareRunId="wfr-good" onBack={onBack} />
      </Wrapper>,
    );
    expect(screen.getByText("Loading comparison...")).toBeTruthy();

    const section = await screen.findByRole("region", { name: "Run comparison" });
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(["wfr-base", "wfr-good"]);
    // The unnamed base run is labelled by its id.
    expect(within(section).getByText("wfr-base")).toBeTruthy();
    expect(within(section).getAllByText("good-run").length).toBeGreaterThan(0);
    expect(within(section).getAllByLabelText("Failed").length).toBeGreaterThan(0);
    expect(within(section).getAllByLabelText("Completed").length).toBeGreaterThan(0);
    expect(section.textContent).toContain("First divergence at publish");
    expect(within(section).getByRole("table", { name: "Task comparison" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back to run" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("reports a failed fetch with its message", async () => {
    const Wrapper = wrapperFor(async () => {
      throw new Error("permission denied");
    });
    render(
      <Wrapper>
        <RunComparisonView baseRunId="wfr-base" compareRunId="wfr-good" onBack={vi.fn()} />
      </Wrapper>,
    );
    expect(await screen.findByText("Failed to load runs")).toBeTruthy();
    expect(screen.getByText("permission denied")).toBeTruthy();
  });

  it("renders nothing when a run is missing", async () => {
    const get = vi.fn(async (id: string) => (id === "wfr-base" ? BASE : null));
    const Wrapper = wrapperFor(get);
    const { container } = render(
      <Wrapper>
        <RunComparisonView baseRunId="wfr-base" compareRunId="wfr-gone" onBack={vi.fn()} />
      </Wrapper>,
    );
    await vi.waitFor(() => expect(screen.queryByText("Loading comparison...")).toBeNull());
    expect(container.innerHTML).toBe("");
  });
});
