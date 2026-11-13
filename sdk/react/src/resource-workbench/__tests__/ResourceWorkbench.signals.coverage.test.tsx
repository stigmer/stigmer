/**
 * ResourceWorkbench's zero-results act: a search the collection answers
 * with nothing names the search, and "Clear search" empties the search so
 * the unfiltered collection is listed again.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkbenchPage, WorkbenchPageRequest } from "../types";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ResourceWorkbench } from "../components/ResourceWorkbench";

vi.mock("../../server-info.js", () => ({
  useSingleOrg: () => false,
}));

afterEach(cleanup);

function Wrapper({ children }: { children: ReactNode }) {
  return <FetchCacheContext.Provider value={null}>{children}</FetchCacheContext.Provider>;
}

interface Row {
  readonly id: string;
  readonly name: string;
}

const ROWS: Row[] = [{ id: "agt_a", name: "Helper" }];
const COLUMNS = [{ id: "name", header: "Name", cell: (row: Row) => row.name }];

describe("ResourceWorkbench zero results", () => {
  it("names a search with no match, and Clear search lists the collection again", async () => {
    // The server's answer: every row for no query, nothing for any query.
    const listFn = vi.fn(
      async (request: WorkbenchPageRequest): Promise<WorkbenchPage<Row>> => ({
        entries: request.query ? [] : ROWS,
        nextPageToken: "",
      }),
    );
    render(
      <ResourceWorkbench listFn={listFn} org="acme" columns={COLUMNS} viewModes={["table"]} defaultViewMode="table" />,
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());

    const search = screen.getByRole("textbox", { name: "Search…" }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: "ghost" } });

    await waitFor(() => expect(screen.getByText("Nothing matches “ghost”")).toBeTruthy());
    expect(screen.queryByText("Helper")).toBeNull();

    fireEvent.click(screen.getByText("Clear search", { selector: "button" }));

    expect(search.value).toBe("");
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(screen.queryByText("Nothing matches “ghost”")).toBeNull();
  });
});
