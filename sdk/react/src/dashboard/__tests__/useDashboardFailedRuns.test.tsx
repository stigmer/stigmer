import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ExecutionPhase as AgentPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase as WorkflowPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useDashboardFailedRuns } from "../useDashboardFailedRuns";

function createMockStigmer(overrides: {
  agentList?: (...args: unknown[]) => Promise<unknown>;
  workflowList?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agentExecution: {
      list: overrides.agentList ?? vi.fn().mockResolvedValue({ entries: [] }),
    },
    workflowExecution: {
      list: overrides.workflowList ?? vi.fn().mockResolvedValue({ entries: [] }),
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
  it("scopes both list requests to the active org and the FAILED phase", async () => {
    const agentList = vi.fn().mockResolvedValue({ entries: [] });
    const workflowList = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ agentList, workflowList });

    const { result } = renderHook(() => useDashboardFailedRuns("acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Regression guard: the pre-fix hook used org only as a fetch gate and
    // sent no org on the wire, so a brand-new org's dashboard showed other
    // orgs' failures.
    const agentRequest = agentList.mock.calls[0][0];
    expect(agentRequest.org).toBe("acme");
    expect(agentRequest.phase).toBe(AgentPhase.EXECUTION_FAILED);

    const workflowRequest = workflowList.mock.calls[0][0];
    expect(workflowRequest.org).toBe("acme");
    expect(workflowRequest.phase).toBe(WorkflowPhase.EXECUTION_FAILED);
  });

  it("does not fetch until an org is available", async () => {
    const agentList = vi.fn().mockResolvedValue({ entries: [] });
    const workflowList = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ agentList, workflowList });

    renderHook(() => useDashboardFailedRuns(null), {
      wrapper: wrapper(client),
    });

    // Give any wrongly-armed fetch a tick to fire.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(agentList).not.toHaveBeenCalled();
    expect(workflowList).not.toHaveBeenCalled();
  });

  it("interleaves agent and workflow failures newest-first, capped at 5", async () => {
    const ts = (secs: number) => ({ seconds: BigInt(secs), nanos: 0 });
    const agentEntries = [1, 3, 5].map((n) => ({
      metadata: { id: `aex_${n}`, name: `agent ${n}` },
      spec: { agentId: `agt_${n}` },
      status: { error: "boom", audit: { specAudit: { createdAt: ts(n) } } },
    }));
    const workflowEntries = [2, 4, 6].map((n) => ({
      metadata: { id: `wex_${n}`, name: `workflow ${n}`, slug: `wf-${n}` },
      status: { error: "boom", audit: { specAudit: { createdAt: ts(n) } } },
    }));
    const client = createMockStigmer({
      agentList: vi.fn().mockResolvedValue({ entries: agentEntries }),
      workflowList: vi.fn().mockResolvedValue({ entries: workflowEntries }),
    });

    const { result } = renderHook(() => useDashboardFailedRuns("acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.failedRuns).toHaveLength(5));

    expect(result.current.failedRuns.map((run) => run.id)).toEqual([
      "wex_6",
      "aex_5",
      "wex_4",
      "aex_3",
      "wex_2",
    ]);
  });
});
