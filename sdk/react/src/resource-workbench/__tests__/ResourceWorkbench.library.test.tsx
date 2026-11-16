/**
 * ResourceWorkbench as the Library draws it: a failed read is the kit's
 * error state, named after what the list holds, with a Try again that reads
 * the list again even when the host passes no `onRetry`; a search that
 * matches nothing names what the list holds; and a host's `narrowViewMode`
 * replaces the chosen view while the workbench is narrower than 640px of
 * its own width, with no view switcher then.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { WorkbenchPage, WorkbenchPageRequest } from "../types";
import { FetchCacheContext } from "@stigmer/react-core/internal";

const narrow = vi.hoisted(() => ({ value: false }));

vi.mock("../../server-info.js", () => ({
  useSingleOrg: () => false,
}));
vi.mock("../../internal/useIsNarrowerThan.js", () => ({
  useIsNarrowerThan: () => narrow.value,
}));

import { ResourceWorkbench } from "../components/ResourceWorkbench";

beforeEach(() => {
  narrow.value = false;
});
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

describe("ResourceWorkbench in the Library", () => {
  it("says a failed read in the list's own words, and Try again reads it again without a host's onRetry", async () => {
    let fail = true;
    const listFn = vi.fn(async (): Promise<WorkbenchPage<Row>> => {
      if (fail) throw new Error("the agent store did not answer");
      return { entries: ROWS, nextPageToken: "" };
    });
    render(<ResourceWorkbench listFn={listFn} org="acme" columns={COLUMNS} viewModes={["table"]} itemsLabel="agents" />, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByText("Couldn't load the agents.")).toBeTruthy());
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(listFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("calls the host's onRetry when it passes one", async () => {
    const onRetry = vi.fn();
    const listFn = vi.fn(async (): Promise<WorkbenchPage<Row>> => {
      throw new Error("down");
    });
    render(<ResourceWorkbench listFn={listFn} org="acme" columns={COLUMNS} viewModes={["table"]} onRetry={onRetry} />, {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(screen.getByText("Couldn't load the list.")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("names what the list holds when a search matches nothing", async () => {
    const listFn = vi.fn(
      async (request: WorkbenchPageRequest): Promise<WorkbenchPage<Row>> => ({
        entries: request.query ? [] : ROWS,
        nextPageToken: "",
      }),
    );
    render(<ResourceWorkbench listFn={listFn} org="acme" columns={COLUMNS} viewModes={["list"]} defaultViewMode="list" itemsLabel="agents" />, {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());

    fireEvent.change(screen.getByRole("textbox", { name: "Search…" }), { target: { value: "ledgr" } });

    await waitFor(() => expect(screen.getByText("No agents match “ledgr”.")).toBeTruthy());
    expect(screen.getByText("Clear search", { selector: "button" })).toBeTruthy();
  });

  it("draws the host's narrow view, and no view switcher, while it is narrow", async () => {
    narrow.value = true;
    const listFn = vi.fn(async (): Promise<WorkbenchPage<Row>> => ({ entries: ROWS, nextPageToken: "" }));
    render(
      <ResourceWorkbench
        listFn={listFn}
        org="acme"
        columns={COLUMNS}
        viewModes={["table", "cards"]}
        defaultViewMode="table"
        narrowViewMode="list"
        renderRow={(row: Row) => <span>row {row.name}</span>}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(screen.getByText("row Helper")).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("keeps the chosen view at full width", async () => {
    const listFn = vi.fn(async (): Promise<WorkbenchPage<Row>> => ({ entries: ROWS, nextPageToken: "" }));
    render(
      <ResourceWorkbench
        listFn={listFn}
        org="acme"
        columns={COLUMNS}
        viewModes={["table"]}
        defaultViewMode="table"
        narrowViewMode="list"
        renderRow={(row: Row) => <span>row {row.name}</span>}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(screen.getByText("Helper")).toBeTruthy());
    expect(screen.queryByText("row Helper")).toBeNull();
  });
});
