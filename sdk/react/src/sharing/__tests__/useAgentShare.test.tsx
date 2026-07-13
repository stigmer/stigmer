import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { GetAgentSharesByAgentRequest } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgentShare } from "../useAgentShare";

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

const AGENT = {
  metadata: {
    id: "agt_1",
    org: "acme",
    slug: "support-agent",
    name: "Support Agent",
  },
} as never;

function makeShare(slug: string, id = `ash_${slug}`) {
  return {
    metadata: { id, org: "acme", slug },
    spec: { enabled: true },
  };
}

describe("useAgentShare", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("loads the agent's shares by agent id", async () => {
    const share = makeShare("support-agent");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 1, items: [share] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.share).toBe(share);
    expect(result.current.error).toBeNull();
    expect(getByAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agt_1" }),
    );
  });

  it("resolves null (no share yet) when the agent has never been shared", async () => {
    const client = createMockStigmer();

    const { result } = renderHook(() => useAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The no-share state is not an error: the first save creates the share.
    expect(result.current.share).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("picks the slug-matching share as canonical when several exist", async () => {
    const canonical = makeShare("support-agent");
    const renamed = makeShare("support-help-desk");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 2, items: [renamed, canonical] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.share).toBe(canonical);
  });

  it("falls back to the first share when none matches the agent slug", async () => {
    // A manifest-created share with a custom slug is still manageable —
    // preferring it over "no share" keeps the dialog editing the real row.
    const renamed = makeShare("support-help-desk");
    const getByAgent = vi
      .fn()
      .mockResolvedValue({ totalCount: 1, items: [renamed] });
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.share).toBe(renamed);
  });

  it("skips fetching while the agent is null (stable no-op)", () => {
    const getByAgent = vi.fn();
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShare(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.share).toBeNull();
    expect(getByAgent).not.toHaveBeenCalled();
  });

  describe("cross-org share resolution (shareOrg — decision 013)", () => {
    it("scopes the canonical pick to the sharing org's channel", async () => {
      // The same agent shared in two orgs: the owner's share AND another
      // org's external share. Each org's dialog must resolve its own row.
      const ownerShare = makeShare("support-agent");
      const externalShare = {
        metadata: { id: "ash_ext", org: "consumer-org", slug: "support-agent" },
        spec: { enabled: true },
      };
      const getByAgent = vi
        .fn()
        .mockResolvedValue({ totalCount: 2, items: [ownerShare, externalShare] });
      const client = createMockStigmer({ getByAgent });

      const { result } = renderHook(
        () => useAgentShare(AGENT, "consumer-org"),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.share).toBe(externalShare);
    });

    it("resolves null when only OTHER orgs' shares exist — never edits a foreign channel", async () => {
      const ownerShare = makeShare("support-agent");
      const getByAgent = vi
        .fn()
        .mockResolvedValue({ totalCount: 1, items: [ownerShare] });
      const client = createMockStigmer({ getByAgent });

      const { result } = renderHook(
        () => useAgentShare(AGENT, "consumer-org"),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      // Without the org filter this would fall back to the owner's share
      // and a save would overwrite the wrong org's configuration.
      expect(result.current.share).toBeNull();
    });

    it("defaults shareOrg to the agent's own org (Phase A behavior unchanged)", async () => {
      const ownerShare = makeShare("support-agent");
      const externalShare = {
        metadata: { id: "ash_ext", org: "consumer-org", slug: "support-agent" },
        spec: { enabled: true },
      };
      const getByAgent = vi
        .fn()
        .mockResolvedValue({ totalCount: 2, items: [externalShare, ownerShare] });
      const client = createMockStigmer({ getByAgent });

      const { result } = renderHook(() => useAgentShare(AGENT), {
        wrapper: wrapper(client),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.share).toBe(ownerShare);
    });
  });

  it("exposes fetch failures as errors", async () => {
    const getByAgent = vi
      .fn()
      .mockRejectedValue(new Error("backend unavailable"));
    const client = createMockStigmer({ getByAgent });

    const { result } = renderHook(() => useAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeTruthy();
    expect(result.current.share).toBeNull();
  });
});
