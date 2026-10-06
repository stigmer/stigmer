/**
 * Pins useRunHistoryData: it lists the workflow's runs with the caller's
 * page size and token (20 by default), derives one RunRow per run in
 * server order, applies the client-side filters to those rows, and passes
 * the list's totalPages through.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FetchCacheContext } from "../../../internal/FetchCacheProvider";
import { useRunHistoryData } from "../useRunHistoryData";
import type { RunClientFilters } from "../derive-run-row";

const RUNS = [
  create(WorkflowRunSchema, { metadata: { id: "wfr-1", name: "one" }, status: { phase: RunPhase.RUN_COMPLETED } }),
  create(WorkflowRunSchema, { metadata: { id: "wfr-2", name: "two" }, status: { phase: RunPhase.RUN_FAILED } }),
];

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useRunHistoryData", () => {
  it("derives a row per listed run, in server order, with the server's page count", async () => {
    const listByWorkflow = vi.fn().mockResolvedValue({ entries: RUNS, totalPages: 3, nextPageToken: "" });
    const { result } = renderHook(
      () => useRunHistoryData({ workflowId: "wfl_1", pageSize: 2, pageToken: "p2" }),
      { wrapper: wrapper({ workflowRun: { listByWorkflow, list: vi.fn() } }) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByWorkflow.mock.calls[0]![0]).toMatchObject({ workflowId: "wfl_1", pageSize: 2, pageToken: "p2" });
    expect(result.current.rows.map((r) => [r.id, r.name, r.phase])).toEqual([
      ["wfr-1", "one", RunPhase.RUN_COMPLETED],
      ["wfr-2", "two", RunPhase.RUN_FAILED],
    ]);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it("applies client filters to the derived rows", async () => {
    const list = vi.fn().mockResolvedValue({ entries: RUNS, totalPages: 1, nextPageToken: "" });
    const filters: RunClientFilters = { phases: [RunPhase.RUN_FAILED] };
    const { result } = renderHook(() => useRunHistoryData({ clientFilters: filters }), {
      wrapper: wrapper({ workflowRun: { list, listByWorkflow: vi.fn() } }),
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0]!.id).toBe("wfr-2");
    expect(list.mock.calls[0]![0]).toMatchObject({ pageSize: 20 });
  });
});
