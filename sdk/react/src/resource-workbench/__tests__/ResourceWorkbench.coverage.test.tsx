/**
 * ResourceWorkbench's search input: typing into it shows the words at once
 * and, after the debounce, reads the list again with the typed query; a
 * query that matches nothing shows the zero-results words rather than the
 * first-use ones.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

describe("ResourceWorkbench search", () => {
  it("reads the list again with the typed query and names a search that matches nothing", async () => {
    const listFn = vi.fn(
      async (_req: WorkbenchPageRequest): Promise<WorkbenchPage> => ({ entries: [], nextPageToken: "" }),
    );
    render(<ResourceWorkbench listFn={listFn} org="acme" emptyTitle="No agents yet" />, { wrapper: Wrapper });

    await waitFor(() => expect(screen.getByText("No agents yet")).toBeTruthy());

    const input = screen.getByRole("textbox", { name: "Search…" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "review" } });
    expect(input.value).toBe("review");

    await waitFor(() => expect(listFn).toHaveBeenCalledWith(expect.objectContaining({ query: "review" })));
    await waitFor(() => expect(screen.getByText("No results match your filters")).toBeTruthy());
    expect(screen.queryByText("No agents yet")).toBeNull();
  });
});
