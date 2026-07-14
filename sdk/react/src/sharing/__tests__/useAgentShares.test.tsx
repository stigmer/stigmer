import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GetAgentSharesByAgentRequest } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentShares } from "../useAgentShares";

function createMockStigmer(overrides: {
  getByAgent?: (input: GetAgentSharesByAgentRequest) => Promise<unknown>;
} = {}) {
  return {
    agentShare: {
      getByAgent:
        overrides.getByAgent ??
        vi.fn().mockResolvedValue({ totalCount: 0, items: [] }),
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

function makeShare(org: string, slug: string, id = `ash_${org}_${slug}`) {
  return {
    metadata: { id, org, slug },
    spec: { enabled: true },
  };
}

describe("useAgentShares", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the agent's shares by agent id", async () => {
    const share = makeShare("acme", "support-agent");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 1, items: [share] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shares).toEqual([share]);
    expect(result.current.error).toBeNull();
    expect(getByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1" }),
    );
  });

  it("returns the FULL list — never collapses to a canonical share", async () => {
    // An agent can carry N shares across N orgs (decision 011 D3 +
    // decision 013): the owner's, a renamed sibling, another org's
    // external channel. The management surface shows them all.
    const owner = makeShare("acme", "support-agent");
    const renamed = makeShare("acme", "support-help-desk");
    const external = makeShare("consumer-org", "support-agent");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 3, items: [owner, renamed, external] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.shares).toEqual([owner, renamed, external]);
  });

  it("resolves empty (no shares yet) when the agent has never been shared", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The no-share state is not an error: creating the first share is
    // the empty state's call to action.
    expect(result.current.shares).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("skips fetching while the agent id is empty (stable no-op)", () => {
    const getByAgent = vi.fn();
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShares(""), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.shares).toEqual([]);
    expect(getByAgent).not.toHaveBeenCalled();
  });

  it("exposes fetch failures as errors", async () => {
    const getByAgent = vi
      .fn()
      .mockRejectedValue(new Error("backend unavailable"));
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.shares).toEqual([]);
  });

  it("refetches on demand", async () => {
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 0, items: [] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getByAgent).toHaveBeenCalledTimes(1);

    result.current.refetch();
    await waitFor(() => expect(getByAgent).toHaveBeenCalledTimes(2));
  });
});
