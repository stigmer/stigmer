import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useSharedAgentProfile } from "../useSharedAgentProfile";

function createMockStigmer(overrides: {
  getSharedProfile?: (...args: unknown[]) => Promise<unknown>;
  getSharedProfileForMember?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agentShare: {
      getSharedProfile:
        overrides.getSharedProfile ?? vi.fn().mockResolvedValue(null),
      getSharedProfileForMember:
        overrides.getSharedProfileForMember ?? vi.fn().mockResolvedValue(null),
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

const SHARE_ID = "ash_01j9z3k8f2q4m6n7p8r9s0t1v2";

const PROFILE = {
  org: "acme",
  slug: "support-agent",
  name: "Support Agent",
  description: "Answers support questions",
  iconUrl: "",
  defaultInstanceId: "inst_1",
};

describe("useSharedAgentProfile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches the profile by the share's id", async () => {
    const getSharedProfile = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(() => useSharedAgentProfile(SHARE_ID), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBe(PROFILE);
    expect(result.current.error).toBeNull();
    // The hook builds a GetSharedProfileRequest message naming the share
    // by its id alone; a plain link carries an empty link token.
    expect(getSharedProfile).toHaveBeenCalledWith(
      expect.objectContaining({ shareId: SHARE_ID, linkToken: "" }),
    );
    const request = getSharedProfile.mock.calls[0]![0] as Record<string, unknown>;
    expect(request).not.toHaveProperty("org");
    expect(request).not.toHaveProperty("slug");
  });

  it("threads the linkToken option into the public request", async () => {
    const getSharedProfile = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(
      () => useSharedAgentProfile(SHARE_ID, { linkToken: "tok123" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getSharedProfile).toHaveBeenCalledWith(
      expect.objectContaining({ linkToken: "tok123" }),
    );
  });

  it("resolves through getSharedProfileForMember for the org audience", async () => {
    const getSharedProfile = vi.fn();
    const getSharedProfileForMember = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({
      getSharedProfile,
      getSharedProfileForMember,
    });

    const { result } = renderHook(
      () => useSharedAgentProfile(SHARE_ID, { audience: "org" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBe(PROFILE);
    // The member path names the share by its id, too.
    expect(getSharedProfileForMember).toHaveBeenCalledWith(SHARE_ID);
    // The anonymous path returns NOT_FOUND for org shares by design; the
    // hook must never fall back to it in org mode.
    expect(getSharedProfile).not.toHaveBeenCalled();
  });

  it("maps a member-path NOT_FOUND (non-member) to profile === null", async () => {
    const getSharedProfileForMember = vi.fn().mockRejectedValue(
      new StigmerError("not-found", "agent not found", Code.NotFound),
    );
    const client = createMockStigmer({ getSharedProfileForMember });

    const { result } = renderHook(
      () => useSharedAgentProfile(SHARE_ID, { audience: "org" }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("skips fetching when the share id is null", () => {
    const getSharedProfile = vi.fn();
    const getSharedProfileForMember = vi.fn();
    const client = createMockStigmer({
      getSharedProfile,
      getSharedProfileForMember,
    });

    const { result } = renderHook(() => useSharedAgentProfile(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(getSharedProfile).not.toHaveBeenCalled();
    expect(getSharedProfileForMember).not.toHaveBeenCalled();
  });

  it("maps NOT_FOUND (unshared or nonexistent) to null without error", async () => {
    // The generated client rethrows every failure wrapped as a
    // StigmerError — reject with the same shape the hook really sees.
    const getSharedProfile = vi
      .fn()
      .mockRejectedValue(
        new StigmerError("not-found", "agent not found", Code.NotFound),
      );
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(
      () => useSharedAgentProfile("ash_revoked"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("exposes non-404 failures as errors", async () => {
    const getSharedProfile = vi
      .fn()
      .mockRejectedValue(new Error("Internal server error"));
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(() => useSharedAgentProfile(SHARE_ID), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.profile).toBeNull();
  });
});
