// The licenses hooks' contracts beyond what the console exercises: a
// disabled or id-less read never calls the server, the ticket-bearing read
// never lands in the cross-mount fetch cache (a credential must not outlive
// its view), the list is unwrapped to its entries, a failed issue is both
// surfaced and rethrown, and every return keeps its reference across
// renders that change nothing.

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerError, type LicenseInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCache } from "../../internal/fetch-cache";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useIssueLicense } from "../useIssueLicense";
import { useLicense } from "../useLicense";
import { useLicenses } from "../useLicenses";
import { license } from "./fixtures";

afterEach(cleanup);

const LICENSE_1 = { id: "lic_1", issuedAt: "2026-09-01T00:00:00Z", expiresAt: "2027-09-01T00:00:00Z" } as const;
const entry = license(LICENSE_1);

function wrapperFor(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("useLicenses", () => {
  it("unwraps the list to its entries", async () => {
    const client = { license: { list: vi.fn().mockResolvedValue({ entries: [entry] }) } };
    const { result } = renderHook(() => useLicenses(), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(result.current.licenses).toEqual([entry]));
  });

  it("never calls the server while disabled", () => {
    const client = { license: { list: vi.fn() } };
    const { result } = renderHook(() => useLicenses({ enabled: false }), { wrapper: wrapperFor(client) });
    expect(client.license.list).not.toHaveBeenCalled();
    expect(result.current.licenses).toBeNull();
  });
});

describe("useLicense", () => {
  it("never writes the ticket-bearing read to the cross-mount fetch cache", async () => {
    const withTicket = license({ ...LICENSE_1, ticket: "secret.ticket.sig" });
    const client = { license: { get: vi.fn().mockResolvedValue(withTicket) } };
    const cache = new FetchCache();
    const set = vi.spyOn(cache, "set");
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <FetchCacheContext.Provider value={cache}>
          <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>
        </FetchCacheContext.Provider>
      );
    }

    const { result } = renderHook(() => useLicense("lic_1"), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.license?.status?.ticket).toBe("secret.ticket.sig"));
    expect(set).not.toHaveBeenCalled();
  });

  it("does not read without an id", () => {
    const client = { license: { get: vi.fn() } };
    renderHook(() => useLicense(""), { wrapper: wrapperFor(client) });
    expect(client.license.get).not.toHaveBeenCalled();
  });
});

describe("useIssueLicense", () => {
  it("surfaces a failed issue and rethrows it to the caller", async () => {
    const refusal = new StigmerError("already-exists", "license already exists", 6);
    const client = { license: { create: vi.fn().mockRejectedValue(refusal) } };
    const { result } = renderHook(() => useIssueLicense(), { wrapper: wrapperFor(client) });

    await act(async () => {
      await expect(result.current.issue({} as LicenseInput)).rejects.toBe(refusal);
    });
    expect(result.current.error).toBe(refusal);
    expect(result.current.isSubmitting).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });

  it("keeps its return reference across renders that change nothing", () => {
    const client = { license: { create: vi.fn() } };
    const { result, rerender } = renderHook(() => useIssueLicense(), { wrapper: wrapperFor(client) });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
