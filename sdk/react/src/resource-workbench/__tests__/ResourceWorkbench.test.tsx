import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderHook, screen, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ListResult } from "@stigmer/sdk";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ResourceWorkbench } from "../components/ResourceWorkbench";
import { useResourceCollection } from "../hooks/useResourceCollection";

afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <FetchCacheContext.Provider value={null}>
      {children}
    </FetchCacheContext.Provider>
  );
}

/** A row shaped like a resource proto: the id lives under metadata. */
interface ProtoLikeRow {
  readonly metadata: { readonly id: string; readonly slug: string };
}

function listFnReturning(entries: unknown[], totalCount = entries.length) {
  return vi.fn(
    async (): Promise<ListResult> => ({
      entries: entries as ListResult["entries"],
      totalCount,
      totalPages: 1,
    }),
  );
}

describe("ResourceWorkbench searchable prop", () => {
  it("renders the search input by default", async () => {
    render(
      <ResourceWorkbench listFn={listFnReturning([])} org="acme" />,
      { wrapper: Wrapper },
    );

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Search…" })).toBeTruthy(),
    );
  });

  it("hides the search input when searchable is false", async () => {
    render(
      <ResourceWorkbench
        listFn={listFnReturning([])}
        org="acme"
        searchable={false}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(screen.getByText("No resources found")).toBeTruthy());
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("useResourceCollection row identity", () => {
  const protoRows: ProtoLikeRow[] = [
    { metadata: { id: "sch_a", slug: "a" } },
    { metadata: { id: "sch_b", slug: "b" } },
  ];

  const columns = [
    {
      id: "slug",
      header: "Slug",
      cell: (row: ProtoLikeRow) => row.metadata.slug,
    },
  ];

  it("uses getItemId for rows without a top-level id", async () => {
    // Hoisted: a listFn re-created per render would retrigger useFetch.
    const listFn = listFnReturning(protoRows);
    const { result } = renderHook(
      () =>
        useResourceCollection<ProtoLikeRow>({
          listFn,
          org: "acme",
          columns,
          getItemId: (row) => row.metadata.id,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const rowIds = result.current.table!.getRowModel().rows.map((r) => r.id);
    expect(rowIds).toEqual(["sch_a", "sch_b"]);
  });

  it("falls back to SearchResult.id, then the row index", async () => {
    const mixed = [{ id: "res_1" }, { name: "no-id" }];
    const listFn = listFnReturning(mixed);
    const fallbackColumns = [{ id: "c", header: "C", cell: () => null }];
    const { result } = renderHook(
      () =>
        useResourceCollection({
          listFn,
          org: "acme",
          columns: fallbackColumns,
        }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(2));
    const rowIds = result.current.table!.getRowModel().rows.map((r) => r.id);
    expect(rowIds).toEqual(["res_1", "1"]);
  });
});
