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
} = {}) {
  return {
    agent: {
      getSharedProfile:
        overrides.getSharedProfile ?? vi.fn().mockResolvedValue(null),
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

  it("fetches the profile by org and slug", async () => {
    const getSharedProfile = vi.fn().mockResolvedValue(PROFILE);
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(
      () => useSharedAgentProfile("acme", "support-agent"),
      { wrapper: wrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.profile).toBe(PROFILE);
    expect(result.current.error).toBeNull();
    expect(getSharedProfile).toHaveBeenCalledWith({
      org: "acme",
      slug: "support-agent",
    });
  });

  it("skips fetching when org is null", () => {
    const getSharedProfile = vi.fn();
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(
      () => useSharedAgentProfile(null, "support-agent"),
      { wrapper: wrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(getSharedProfile).not.toHaveBeenCalled();
  });

  it("skips fetching when slug is null", () => {
    const getSharedProfile = vi.fn();
    const client = createMockStigmer({ getSharedProfile });

    const { result } = renderHook(() => useSharedAgentProfile("acme", null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.profile).toBeNull();
    expect(getSharedProfile).not.toHaveBeenCalled();
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
      () => useSharedAgentProfile("acme", "revoked-agent"),
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

    const { result } = renderHook(
      () => useSharedAgentProfile("acme", "support-agent"),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.profile).toBeNull();
  });
});
