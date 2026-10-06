/**
 * Pins WorkflowRunHistory as the composition it is: it asks the client for
 * the workflow's run summary and its runs (scoped to the workflow, with the
 * page size), shows the health strip, the table and the failure panel from
 * those answers, narrows the table when a filter chip is pressed, and hands
 * a clicked row's run id to `onRunClick`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import {
  RunPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FetchCacheContext } from "../../../internal/FetchCacheProvider";
import { WorkflowRunHistory } from "../WorkflowRunHistory";

const RUNS = [
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-ok", name: "good-run" },
    status: { phase: RunPhase.RUN_COMPLETED, startedAt: "2026-05-02T10:00:00Z" },
  }),
  create(WorkflowRunSchema, {
    metadata: { id: "wfr-bad", name: "bad-run" },
    status: {
      phase: RunPhase.RUN_FAILED,
      startedAt: "2026-05-01T10:00:00Z",
      completedAt: "2026-05-01T10:00:05Z",
      tasks: [{ taskName: "deploy", status: WorkflowTaskStatus.WORKFLOW_TASK_FAILED, error: "quota" }],
    },
  }),
];

function setup() {
  const listByWorkflow = vi.fn().mockResolvedValue({ entries: RUNS, totalPages: 1, nextPageToken: "" });
  const list = vi.fn();
  const getRunSummary = vi.fn().mockResolvedValue(create(RunSummarySchema, { totalCount: 2, successRate: 0.5 }));
  const client = { workflowRun: { listByWorkflow, list, getRunSummary } };
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  }
  return { listByWorkflow, list, getRunSummary, Wrapper };
}

describe("WorkflowRunHistory", () => {
  afterEach(cleanup);

  it("composes the summary, the table and the failure panel from the workflow's runs", async () => {
    const { listByWorkflow, list, getRunSummary, Wrapper } = setup();
    const onRunClick = vi.fn();
    render(
      <Wrapper>
        <WorkflowRunHistory org="acme" workflowId="wfl_1" pageSize={5} onRunClick={onRunClick} />
      </Wrapper>,
    );

    const history = screen.getByRole("region", { name: "Run history" });
    await screen.findByRole("table", { name: "Run history" });
    expect(listByWorkflow.mock.calls[0]![0]).toMatchObject({ workflowId: "wfl_1", pageSize: 5 });
    expect(list).not.toHaveBeenCalled();
    expect(getRunSummary.mock.calls[0]![0]).toMatchObject({ org: "acme", workflowId: "wfl_1" });

    const strip = await within(history).findByRole("region", { name: "Run health metrics" });
    expect(strip.textContent).toContain("50%");
    expect(within(history).getByRole("region", { name: "Failure analysis" }).textContent).toContain("deploy");

    const table = screen.getByRole("table", { name: "Run history" });
    fireEvent.click(within(table).getAllByRole("link")[1]!);
    expect(onRunClick).toHaveBeenCalledWith("wfr-bad");
  });

  it("narrows the table to the phases a filter chip selects", async () => {
    const { Wrapper } = setup();
    render(
      <Wrapper>
        <WorkflowRunHistory org="acme" workflowId="wfl_1" onRunClick={vi.fn()} />
      </Wrapper>,
    );
    const table = await screen.findByRole("table", { name: "Run history" });
    expect(within(table).getAllByRole("link")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    await waitFor(() => expect(within(table).getAllByRole("link")).toHaveLength(1));
    expect(within(table).getByRole("link").textContent).toContain("bad-run");
  });
});
