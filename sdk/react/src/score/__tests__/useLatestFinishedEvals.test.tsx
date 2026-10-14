/**
 * useLatestFinishedEvals walks an agent's evals newest first for the
 * versions a view shows: it keeps each version's first finished eval and
 * stops reading once every version has one; an empty agent or no versions
 * asks nothing.
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { agentEvalRunWith } from "../../eval-run/__tests__/eval-fixture.agent";
import { useLatestFinishedEvals } from "../useLatestFinishedEvals";

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useLatestFinishedEvals", () => {
  it("stops reading once every version shown has its latest finished eval", async () => {
    const listByAgent = vi.fn(async (req: { pageToken: string }) =>
      req.pageToken === ""
        ? { entries: [agentEvalRunWith([], { id: "evr_new", version: "v1" })], nextPageToken: "page-2" }
        : { entries: [agentEvalRunWith([], { id: "evr_old", version: "v1" })], nextPageToken: "" },
    );
    const { result } = renderHook(() => useLatestFinishedEvals("agt_1", ["v1"]), {
      wrapper: wrapper({ evalrun: { listByAgent } }),
    });
    await waitFor(() => expect(result.current.get("v1")?.metadata?.id).toBe("evr_new"));
    expect(listByAgent).toHaveBeenCalledTimes(1);
  });

  it("asks nothing for an empty agent or no versions", () => {
    const listByAgent = vi.fn();
    renderHook(() => useLatestFinishedEvals("", ["v1"]), { wrapper: wrapper({ evalrun: { listByAgent } }) });
    renderHook(() => useLatestFinishedEvals("agt_1", []), { wrapper: wrapper({ evalrun: { listByAgent } }) });
    expect(listByAgent).not.toHaveBeenCalled();
  });
});
