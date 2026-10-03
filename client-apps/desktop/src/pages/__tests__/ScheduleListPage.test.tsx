/**
 * Pins the desktop schedule list's wiring: schedules are listed through the
 * direct query (full protos with live status), so the workbench offers no
 * server text search; a row opens its schedule; and Apply YAML or a row
 * action refetches the list in place. The workbench is pinned in
 * @stigmer/react.
 */
import type { ReactElement, ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

interface Item {
  metadata?: { id?: string; org?: string; slug?: string };
}

interface WorkbenchProps {
  refetchToken: number;
  listFn: unknown;
  org: string;
  searchable: boolean;
  defaultViewMode: string;
  viewModes: string[];
  getItemId: (item: Item) => string;
  renderItemAction: (item: Item) => ReactElement<{ schedule: Item; onChanged: () => void }>;
  onItemClick: (item: Item) => void;
  headerAction: ReactNode;
}

interface DialogProps {
  open: boolean;
  org: string;
  onApplied: () => void;
}

const page = vi.hoisted(() => ({
  workbench: [] as WorkbenchProps[],
  dialog: [] as DialogProps[],
}));

const LIST_FN = vi.hoisted(() => ({ marker: "schedule-list-fn" }));

vi.mock("@stigmer/react", () => ({
  ResourceWorkbench: (props: WorkbenchProps) => {
    page.workbench.push(props);
    return <>{props.headerAction}</>;
  },
  ApplyManifestDialog: (props: DialogProps) => {
    page.dialog.push(props);
    return null;
  },
  ScheduleRowActions: () => null,
  createScheduleColumns: () => [],
  createScheduleListFn: () => LIST_FN,
  useStigmer: () => ({}),
  useActiveOrgSlug: () => "acme",
}));

import ScheduleListPage from "../library/ScheduleListPage";

function LocationProbe() {
  return <span data-testid="location">{useLocation().pathname}</span>;
}

function renderList() {
  return render(
    <MemoryRouter initialEntries={["/library/schedules"]}>
      <Routes>
        <Route path="*" element={<ScheduleListPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  page.workbench.length = 0;
  page.dialog.length = 0;
});

describe("desktop ScheduleListPage", () => {
  it("lists through the direct query, as a table, with no server text search", () => {
    renderList();

    expect(page.workbench.at(-1)).toMatchObject({
      listFn: LIST_FN,
      org: "acme",
      searchable: false,
      defaultViewMode: "table",
      viewModes: ["table"],
      refetchToken: 0,
    });
    expect(page.workbench.at(-1)?.getItemId({ metadata: { id: "sch_1" } })).toBe("sch_1");
    expect(page.workbench.at(-1)?.getItemId({})).toBe("");
  });

  it("opens a schedule from its row", () => {
    renderList();

    act(() => page.workbench.at(-1)?.onItemClick({ metadata: { org: "acme", slug: "nightly" } }));
    expect(screen.getByTestId("location").textContent).toBe("/library/schedules/acme/nightly");
  });

  it("refetches in place after Apply YAML and after a row action", () => {
    renderList();

    fireEvent.click(screen.getByRole("button", { name: "Apply YAML" }));
    expect(page.dialog.at(-1)).toMatchObject({ open: true, org: "acme" });
    act(() => page.dialog.at(-1)?.onApplied());
    expect(page.workbench.at(-1)?.refetchToken).toBe(1);

    const action = page.workbench.at(-1)!.renderItemAction({ metadata: { id: "sch_1" } });
    expect(action.props.schedule).toEqual({ metadata: { id: "sch_1" } });
    act(() => action.props.onChanged());
    expect(page.workbench.at(-1)?.refetchToken).toBe(2);
  });
});
