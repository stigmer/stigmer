/**
 * useResourceCount reads a Library kind's count from search's per-kind
 * counts: a one-row search scoped to the kind and the organization, the
 * kind's own entry of `countsByKind`. A list carries no total, so this is
 * the count the Library cards show.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/client";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { StigmerContext } from "../../context";
import { useResourceCount } from "../useResourceCount";

function mockSearch(countsByKind: Record<string, number> = {}) {
  const query = vi.fn().mockResolvedValue({ entries: [], countsByKind, nextPageToken: "" });
  const client = { search: { query } } as unknown as Stigmer;
  function wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
  }
  return { query, wrapper };
}

describe("useResourceCount", () => {
  it("always sends the org with a one-row search of the kind (an empty org means every org the caller can access to the search backend)", async () => {
    const { query, wrapper } = mockSearch({ agent: 7, skill: 3 });

    const { result } = renderHook(() => useResourceCount(ApiResourceKind.agent, "acme"), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.count).toBe(7);
    expect(query.mock.calls[0][0]).toMatchObject({
      kinds: [ApiResourceKind.agent],
      org: "acme",
      pageSize: 1,
    });
  });

  it("counts zero when the kind has no entry", async () => {
    const { wrapper } = mockSearch({});

    const { result } = renderHook(() => useResourceCount(ApiResourceKind.plugin, "acme"), { wrapper });

    await waitFor(() => expect(result.current.count).toBe(0));
  });

  it("does not fetch when org is null", async () => {
    const { query, wrapper } = mockSearch();

    const { result } = renderHook(() => useResourceCount(ApiResourceKind.agent, null), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(query).not.toHaveBeenCalled();
    expect(result.current.count).toBeUndefined();
  });

  it("recounts when refetchToken changes", async () => {
    const { query, wrapper } = mockSearch({ agent: 1 });

    const { result, rerender } = renderHook(
      ({ token }: { token: number }) =>
        useResourceCount(ApiResourceKind.agent, "acme", { refetchToken: token }),
      { initialProps: { token: 0 }, wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(query).toHaveBeenCalledTimes(1);

    rerender({ token: 1 });

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
  });

  it("refetches with the new org when the org changes", async () => {
    const { query, wrapper } = mockSearch({ agent: 2 });

    const { result, rerender } = renderHook(
      ({ org }: { org: string }) => useResourceCount(ApiResourceKind.agent, org),
      { initialProps: { org: "acme" }, wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ org: "globex" });

    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls[1][0].org).toBe("globex");
  });
});
