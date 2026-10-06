/**
 * Pins useRunComparison: a null id fetches nothing and yields no
 * comparison; two ids fetch both runs and derive their comparison; the
 * first fetch error surfaces; and `refetch` fetches both runs again.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { WorkflowRunSchema, type WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { StigmerContext } from "../../../context";
import { FetchCacheContext } from "../../../internal/FetchCacheProvider";
import { useRunComparison } from "../useRunComparison";

const RUNS: Record<string, WorkflowRun> = {
  "wfr-a": create(WorkflowRunSchema, { metadata: { id: "wfr-a", name: "a" }, status: { phase: RunPhase.RUN_FAILED } }),
  "wfr-b": create(WorkflowRunSchema, { metadata: { id: "wfr-b", name: "b" }, status: { phase: RunPhase.RUN_COMPLETED } }),
};

function wrapper(get: (id: string) => Promise<WorkflowRun>) {
  const client = { workflowRun: { get } };
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useRunComparison", () => {
  it("fetches nothing and compares nothing while an id is null", async () => {
    const get = vi.fn(async (id: string) => RUNS[id]!);
    const { result } = renderHook(() => useRunComparison({ baseId: "wfr-a", compareId: null }), {
      wrapper: wrapper(get),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(get.mock.calls.map((c) => c[0])).toEqual(["wfr-a"]);
    expect(result.current.comparison).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("derives the comparison of both runs and refetches both", async () => {
    const get = vi.fn(async (id: string) => RUNS[id]!);
    const { result } = renderHook(() => useRunComparison({ baseId: "wfr-a", compareId: "wfr-b" }), {
      wrapper: wrapper(get),
    });
    await waitFor(() => expect(result.current.comparison).not.toBeNull());
    expect(result.current.comparison!.baseRow.id).toBe("wfr-a");
    expect(result.current.comparison!.compareRow.id).toBe("wfr-b");
    expect(get).toHaveBeenCalledTimes(2);

    act(() => result.current.refetch());
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
    expect(get.mock.calls.slice(2).map((c) => c[0]).sort()).toEqual(["wfr-a", "wfr-b"]);
  });

  it("surfaces the fetch error", async () => {
    const get = vi.fn(async (id: string) => {
      if (id === "wfr-b") throw new Error("boom");
      return RUNS[id]!;
    });
    const { result } = renderHook(() => useRunComparison({ baseId: "wfr-a", compareId: "wfr-b" }), {
      wrapper: wrapper(get),
    });
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.comparison).toBeNull();
  });
});
