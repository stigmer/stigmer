import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useDashboardFailedRuns } from "../useDashboardFailedRuns";

function createMockStigmer(overrides: {
  agentList?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    run: {
      list: overrides.agentList ?? vi.fn().mockResolvedValue({ entries: [] }),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useDashboardFailedRuns", () => {
  it("scopes the list request to the active org and the FAILED phase", async () => {
    const agentList = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ agentList });

    const { result } = renderHook(() => useDashboardFailedRuns("acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Regression guard: the pre-fix hook used org only as a fetch gate and
    // sent no org on the wire, so a brand-new org's dashboard showed other
    // orgs' failures.
    const agentRequest = agentList.mock.calls[0][0];
    expect(agentRequest.org).toBe("acme");
    expect(agentRequest.phase).toBe(RunPhase.RUN_FAILED);
  });

  it("does not fetch until an org is available", async () => {
    const agentList = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ agentList });

    renderHook(() => useDashboardFailedRuns(null), {
      wrapper: wrapper(client),
    });

    // Give any wrongly-armed fetch a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(agentList).not.toHaveBeenCalled();
  });

  it("orders failures newest-first and names the agent each ran", async () => {
    const ts = (secs: number) => ({ seconds: BigInt(secs), nanos: 0 });
    const agentEntries = [2, 5, 1, 4, 3].map((n) => ({
      metadata: { id: `aex_${n}`, name: `agent ${n}` },
      status: { error: "boom", agentId: `agt_${n}`, audit: { specAudit: { createdAt: ts(n) } } },
    }));
    const client = createMockStigmer({
      agentList: vi.fn().mockResolvedValue({ entries: agentEntries }),
    });

    const { result } = renderHook(() => useDashboardFailedRuns("acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.failedRuns).toHaveLength(5));

    expect(result.current.failedRuns.map((run) => run.id)).toEqual([
      "aex_5",
      "aex_4",
      "aex_3",
      "aex_2",
      "aex_1",
    ]);
    expect(result.current.failedRuns[0]!.resourceName).toBe("agt_5");
  });
});
