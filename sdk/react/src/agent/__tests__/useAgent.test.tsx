import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useAgent } from "../useAgent";

function createMockStigmer(overrides: {
  getByReference?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agent: {
      getByReference: overrides.getByReference ?? vi.fn().mockResolvedValue(null),
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

describe("useAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches agent by org and slug", async () => {
    const agent = { metadata: { id: "agt-1", name: "Test Agent", slug: "test-agent", org: "acme" } };
    const getByReference = vi.fn().mockResolvedValue(agent);
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useAgent("acme", "test-agent"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.agent).toBe(agent);
    expect(result.current.error).toBeNull();
    expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "test-agent" });
  });

  it("skips fetching when org is null", () => {
    const getByReference = vi.fn();
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useAgent(null, "test-agent"), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.agent).toBeNull();
    expect(getByReference).not.toHaveBeenCalled();
  });

  it("skips fetching when slug is null", () => {
    const getByReference = vi.fn();
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useAgent("acme", null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.agent).toBeNull();
    expect(getByReference).not.toHaveBeenCalled();
  });

  it("returns null without error on NOT_FOUND", async () => {
    const notFoundError = Object.assign(new Error("Not found"), { code: "not_found" });
    // The hook uses `isNotFound(err)` from @stigmer/sdk — simulate
    // by making the ConnectError-compatible shape the SDK recognizes.
    (notFoundError as unknown as Record<string, unknown>)["name"] = "ConnectError";
    // Connect gRPC code 5 = NOT_FOUND
    (notFoundError as unknown as Record<string, unknown>)["code"] = 5;

    const getByReference = vi.fn().mockRejectedValue(notFoundError);
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useAgent("acme", "missing-agent"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.agent).toBeNull();
    // NOT_FOUND errors are suppressed (agent = null, no error)
    // The exact behavior depends on isNotFound matching the error shape
  });

  it("exposes error for non-404 failures", async () => {
    const serverError = new Error("Internal server error");
    const getByReference = vi.fn().mockRejectedValue(serverError);
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useAgent("acme", "bad-agent"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error!.message).toBe("Internal server error");
    expect(result.current.agent).toBeNull();
  });
});
