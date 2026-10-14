import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListAgentSharesByAgentRequest } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentShares } from "../useAgentShares";

function createMockStigmer(overrides: {
  listByAgent?: (input: ListAgentSharesByAgentRequest) => Promise<unknown>;
} = {}) {
  return {
    agentShare: {
      listByAgent:
        overrides.listByAgent ??
        vi.fn().mockResolvedValue({ entries: [], nextPageToken: "" }),
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
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [share], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.shares).toEqual([share]);
    expect(result.current.error).toBeNull();
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "" }),
    );
  });

  it("threads the org scope into the request", async () => {
    // The org scope belongs in the RPC, never client-side filtering: the
    // server narrows a multi-org member's view to one org's channels.
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1", "acme"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "acme" }),
    );
  });

  it("refetches when the org scope changes", async () => {
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result, rerender } = renderHook(
      ({ org }: { org: string }) => useAgentShares("agt_1", org),
      { wrapper: wrapper(client), initialProps: { org: "acme" } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledTimes(1);

    // Switching org context must re-query — a stale other-org list is
    // exactly the bug the scope exists to prevent.
    rerender({ org: "consumer-org" });
    await waitFor(() => expect(listByAgent).toHaveBeenCalledTimes(2));
    expect(listByAgent).toHaveBeenLastCalledWith(
      expect.objectContaining({ agentId: "agt_1", org: "consumer-org" }),
    );
  });

  it("returns the FULL list — never collapses to a canonical share", async () => {
    // An agent can carry N shares across N orgs: the owner's, a renamed
    // sibling, another org's external channel. The management surface shows
    // them all.
    const owner = makeShare("acme", "support-agent");
    const renamed = makeShare("acme", "support-help-desk");
    const external = makeShare("consumer-org", "support-agent");
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [owner, renamed, external], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

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
    const listByAgent = vi.fn();
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useAgentShares(""), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.shares).toEqual([]);
    expect(listByAgent).not.toHaveBeenCalled();
  });

  it("exposes fetch failures as errors", async () => {
    const listByAgent = vi
      .fn()
      .mockRejectedValue(new Error("backend unavailable"));
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.shares).toEqual([]);
  });

  it("refetches on demand", async () => {
    const listByAgent = vi
      .fn()
      .mockResolvedValue({ entries: [], nextPageToken: "" });
    const client = createMockStigmer({ listByAgent });

    const { result } = renderHook(() => useAgentShares("agt_1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listByAgent).toHaveBeenCalledTimes(1);

    result.current.refetch();
    await waitFor(() => expect(listByAgent).toHaveBeenCalledTimes(2));
  });
});
