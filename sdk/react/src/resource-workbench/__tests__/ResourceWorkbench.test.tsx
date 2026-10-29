/**
 * ResourceWorkbench lists a collection as a table, cards or rows: the search
 * input is optional, a server that holds one organization hides the
 * organization column, the default card and row layouts name a row's
 * organization by its slug, and the pager follows page tokens next and
 * previous with no total.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkbenchPage, WorkbenchPageRequest } from "../types";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ResourceWorkbench } from "../components/ResourceWorkbench";
import { useResourceCollection } from "../hooks/useResourceCollection";
import { GLOBEX_ID, orgWrapper } from "../../organization/__tests__/org-fixture";

// Whether the server holds one organization, as useSingleOrg reports it.
let singleOrg: boolean | undefined = false;

vi.mock("../../server-info.js", () => ({
  useSingleOrg: () => singleOrg,
}));

afterEach(() => {
  cleanup();
  singleOrg = false;
});

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

function listFnReturning<T = WorkbenchPage["entries"][number]>(entries: unknown[]) {
  return vi.fn(
    async (): Promise<WorkbenchPage<T>> => ({
      entries: entries as T[],
      nextPageToken: "",
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

describe("ResourceWorkbench on a server that holds one organization", () => {
  const rows = [{ id: "agt_a", name: "Helper", org: "stigmer" }];
  const columns = [
    { id: "name", header: "Name", cell: (row: (typeof rows)[number]) => row.name },
    { id: "org", header: "Organization", cell: (row: (typeof rows)[number]) => row.org },
  ];

  function renderTable() {
    render(
      <ResourceWorkbench
        listFn={listFnReturning(rows)}
        org="stigmer"
        columns={columns}
        viewModes={["table"]}
        defaultViewMode="table"
      />,
      { wrapper: Wrapper },
    );
  }

  it("leaves the organization column out", async () => {
    singleOrg = true;
    renderTable();
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(screen.queryByRole("columnheader", { name: "Organization" })).toBeNull();
    expect(screen.queryByRole("cell", { name: "stigmer" })).toBeNull();
  });

  it("leaves it out while the answer loads", async () => {
    singleOrg = undefined;
    renderTable();
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(screen.queryByRole("columnheader", { name: "Organization" })).toBeNull();
  });

  it("keeps it on a server that holds several", async () => {
    renderTable();
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(screen.getByRole("columnheader", { name: "Organization" })).toBeTruthy();
  });
});

describe("useResourceCollection row identity", () => {
  const protoRows: ProtoLikeRow[] = [
    { metadata: { id: "rtn_a", slug: "a" } },
    { metadata: { id: "rtn_b", slug: "b" } },
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
    const listFn = listFnReturning<ProtoLikeRow>(protoRows);
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
    expect(rowIds).toEqual(["rtn_a", "rtn_b"]);
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

describe("ResourceWorkbench default layouts name a row's organization by slug", () => {
  const rows = [{ id: "agt_a", name: "Helper", slug: "helper", org: GLOBEX_ID, description: "" }];
  const OrgsWrapper = orgWrapper();

  function WithOrgs({ children }: { children: ReactNode }) {
    return (
      <Wrapper>
        <OrgsWrapper>{children}</OrgsWrapper>
      </Wrapper>
    );
  }

  it.each([["cards"], ["list"]] as const)("in the %s layout", async (mode) => {
    render(
      <ResourceWorkbench
        listFn={listFnReturning(rows)}
        org={GLOBEX_ID}
        viewModes={[mode]}
        defaultViewMode={mode}
      />,
      { wrapper: WithOrgs },
    );

    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    await waitFor(() => expect(screen.getByText("globex")).toBeTruthy());
    expect(screen.queryByText(GLOBEX_ID)).toBeNull();
  });
});

describe("ResourceWorkbench pages by token", () => {
  const pageOne = [{ id: "agt_new", name: "Newest", slug: "newest", org: "acme", description: "" }];
  const pageTwo = [{ id: "agt_old", name: "Older", slug: "older", org: "acme", description: "" }];

  it("shows next and previous with no total, and follows the token", async () => {
    const listFn = vi.fn(async (request: WorkbenchPageRequest): Promise<WorkbenchPage> =>
      request.pageToken === ""
        ? { entries: pageOne as unknown as WorkbenchPage["entries"], nextPageToken: "tok_2" }
        : { entries: pageTwo as unknown as WorkbenchPage["entries"], nextPageToken: "" },
    );
    render(<ResourceWorkbench listFn={listFn} org="acme" viewModes={["list"]} defaultViewMode="list" />, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByText("Newest")).toBeTruthy());
    expect(screen.getByText("Page 1")).toBeTruthy();
    expect(screen.queryByText(/results?$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(screen.getByText("Older")).toBeTruthy());
    expect(screen.getByText("Page 2")).toBeTruthy();
    expect(listFn.mock.calls[1][0]).toMatchObject({ org: "acme", pageToken: "tok_2" });
    expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(screen.getByText("Newest")).toBeTruthy());
    expect(screen.getByText("Page 1")).toBeTruthy();
  });
});
