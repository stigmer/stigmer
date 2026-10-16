// useChannelAgentProfile: a web channel's public agent profile, by the
// channel id a chat link carries, on the anonymous path or a member's.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useChannelAgentProfile } from "../useChannelAgentProfile";

function createMockStigmer(overrides: {
  getAgentProfile?: (...args: unknown[]) => Promise<unknown>;
  getAgentProfileForMember?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      getAgentProfile:
        overrides.getAgentProfile ?? vi.fn().mockResolvedValue(null),
      getAgentProfileForMember:
        overrides.getAgentProfileForMember ?? vi.fn().mockResolvedValue(null),
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

const CHANNEL_ID = "ash_01j9z3k8f2q4m6n7p8r9s0t1v2";

const PROFILE = {
  org: "acme",
  slug: "support-agent",
  name: "Support Agent",
  description: "Answers support questions",
  iconUrl: "",
  agentRef: { org: "acme", slug: "support-bot", version: "v2", kind: 40 },
};

describe("useChannelAgentProfile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the profile by the channel's id", async () => {
    const getAgentProfile = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({ getAgentProfile });

    const { result } = renderHook(() => useChannelAgentProfile(CHANNEL_ID), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBe(PROFILE);
    expect(result.current.error).toBeNull();
    // The hook builds a GetChannelAgentProfileRequest message naming the channel
    // by its id alone; a plain link carries an empty link token.
    expect(getAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL_ID, linkToken: "" }),
    );
    const request = getAgentProfile.mock.calls[0]![0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("org");
    expect(request).not.toHaveProperty("slug");
  });

  it("threads the linkToken option into the public request", async () => {
    const getAgentProfile = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({ getAgentProfile });

    const { result } = renderHook(
      () => useChannelAgentProfile(CHANNEL_ID, { linkToken: "tok123" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getAgentProfile).toHaveBeenCalledWith(
      expect.objectContaining({ linkToken: "tok123" }),
    );
  });

  it("resolves through getAgentProfileForMember for the org audience", async () => {
    const getAgentProfile = vi.fn();
    const getAgentProfileForMember = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({
      getAgentProfile,
      getAgentProfileForMember,
    });

    const { result } = renderHook(
      () => useChannelAgentProfile(CHANNEL_ID, { audience: "org" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBe(PROFILE);
    // The member path names the channel by its id, too.
    expect(getAgentProfileForMember).toHaveBeenCalledWith(CHANNEL_ID);
    // The anonymous path returns NOT_FOUND for org-audience channels by design; the
    // hook must never fall back to it in org mode.
    expect(getAgentProfile).not.toHaveBeenCalled();
  });

  it("maps a member-path NOT_FOUND (non-member) to profile === null", async () => {
    const getAgentProfileForMember = vi.fn().mockRejectedValue(
      new StigmerError("not-found", "agent not found", Code.NotFound),
    );
    const client = createMockStigmer({ getAgentProfileForMember });

    const { result } = renderHook(
      () => useChannelAgentProfile(CHANNEL_ID, { audience: "org" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("skips fetching when the channel id is null", () => {
    const getAgentProfile = vi.fn();
    const getAgentProfileForMember = vi.fn();
    const client = createMockStigmer({
      getAgentProfile,
      getAgentProfileForMember,
    });

    const { result } = renderHook(() => useChannelAgentProfile(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(getAgentProfile).not.toHaveBeenCalled();
    expect(getAgentProfileForMember).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND (link off or nonexistent) to null without error", async () => {
    // The generated client rethrows every failure wrapped as a
    // StigmerError — reject with the same shape the hook really sees.
    const getAgentProfile = vi
      .fn()
      .mockRejectedValue(
        new StigmerError("not-found", "agent not found", Code.NotFound),
      );
    const client = createMockStigmer({ getAgentProfile });

    const { result } = renderHook(
      () => useChannelAgentProfile("ash_revoked"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("exposes non-404 failures as errors", async () => {
    const getAgentProfile = vi
      .fn()
      .mockRejectedValue(new Error("Internal server error"));
    const client = createMockStigmer({ getAgentProfile });

    const { result } = renderHook(() => useChannelAgentProfile(CHANNEL_ID), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.profile).toBeNull();
  });
});
