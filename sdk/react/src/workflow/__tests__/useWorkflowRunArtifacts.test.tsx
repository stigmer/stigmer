/**
 * Pins useWorkflowRunArtifacts: it lists the artifacts of the run it is
 * given, asking by the run's id as `workflowRunId`, and asks nothing for a
 * null run.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useWorkflowRunArtifacts } from "../useWorkflowRunArtifacts";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useWorkflowRunArtifacts", () => {
  it("lists the artifacts of the run", async () => {
    const listByRun = vi.fn().mockResolvedValue({
      entries: [{ metadata: { id: "art_1" } }, { metadata: { id: "art_2" } }],
    });
    const { result } = renderHook(() => useWorkflowRunArtifacts("wfr_1"), {
      wrapper: wrapper({ artifact: { listByRun } }),
    });

    await waitFor(() => expect(result.current.artifacts).toHaveLength(2));
    expect(listByRun.mock.calls[0]![0]).toMatchObject({ workflowRunId: "wfr_1" });
    expect(result.current.artifacts.map((a) => a.metadata?.id)).toEqual(["art_1", "art_2"]);
  });

  it("asks nothing for a null run", () => {
    const listByRun = vi.fn();
    const { result } = renderHook(() => useWorkflowRunArtifacts(null), {
      wrapper: wrapper({ artifact: { listByRun } }),
    });
    expect(listByRun).not.toHaveBeenCalled();
    expect(result.current.artifacts).toEqual([]);
  });
});
