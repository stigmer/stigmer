/**
 * Pins the console's table and figure. The table is a semantic table in a
 * card whose header cells are column headers and whose cells use the same
 * classes the workbench's ResourceTable draws with; a row that opens
 * something carries its link or button on its name; a row's acts sit in a
 * last column named for assistive technology. Under 640px of its own width
 * the same rows draw as list rows: the first column the name, the other
 * columns on the line under it, beside it or at its end as each column
 * says. The figure is a label over a value, the value in a status hue only
 * when the figure says it is a status, and Figures lays them two to a row
 * on a phone and all on one row from the large breakpoint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  Table,
  TABLE_CELL_CLASSES,
  TABLE_HEADER_CELL_CLASSES,
  TABLE_NARROW_BELOW_PX,
  type TableColumn,
} from "../Table";
import { Figure, Figures } from "../Figure";

interface Agent {
  readonly slug: string;
  readonly name: string;
  readonly runs: number;
  readonly plan: string;
}

const AGENTS: readonly Agent[] = [
  { slug: "ledger", name: "Ledger reviewer", runs: 61, plan: "Team" },
  { slug: "receipts", name: "Receipts matcher", runs: 38, plan: "Free" },
];

const COLUMNS: readonly TableColumn<Agent>[] = [
  { id: "name", header: "Agent", cell: (a) => a.name },
  { id: "runs", header: "Runs", cell: (a) => String(a.runs), align: "end" },
  { id: "plan", header: "Plan", cell: (a) => a.plan, narrow: "adornment" },
];

/** Lays the table out at `width` px: a ResizeObserver that reports it, and the box measured before paint. */
function layOutAt(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width } as DOMRect);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Table, wide", () => {
  it("draws a named table in a card, its headers as column headers on the workbench's classes", () => {
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} />);
    const table = screen.getByRole("table", { name: "Agents" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Agent", "Runs", "Plan"]);
    for (const header of headers) expect(header.getAttribute("scope")).toBe("col");
    expect(headers[0]?.className).toContain(TABLE_HEADER_CELL_CLASSES);
    const cells = within(table).getAllByRole("cell");
    expect(cells.map((c) => c.textContent)).toEqual(["Ledger reviewer", "61", "Team", "Receipts matcher", "38", "Free"]);
    expect(cells[0]?.className).toContain(TABLE_CELL_CLASSES);
    expect(table.parentElement?.className).toContain("stg:rounded-xl");
  });

  it("lines a figure's column up at the right, header and cells", () => {
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} />);
    expect(screen.getByRole("columnheader", { name: "Runs" }).className).toContain("stg:text-right");
    expect(screen.getByRole("cell", { name: "61" }).className).toContain("stg:text-right");
    expect(screen.getByRole("cell", { name: "Team" }).className).not.toContain("stg:text-right");
  });

  it("draws no card around a bare table", () => {
    render(<Table bare aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} />);
    expect(screen.getByRole("table").parentElement?.className).not.toContain("stg:rounded-xl");
  });

  it("puts the row's link on its name when the row opens something", () => {
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} rowHref={(a) => `/agents/${a.slug}`} />);
    expect(screen.getByRole("link", { name: "Ledger reviewer" }).getAttribute("href")).toBe("/agents/ledger");
    expect(screen.getByRole("link", { name: "Receipts matcher" }).getAttribute("href")).toBe("/agents/receipts");
  });

  it("puts a button on the row's name when the row does something, and calls it with the row", async () => {
    const onRowClick = vi.fn();
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Receipts matcher" }));
    expect(onRowClick).toHaveBeenCalledWith(AGENTS[1]);
  });

  it("gives the row's own acts a last column named Actions, beside the name's link, never inside it", () => {
    render(
      <Table
        aria-label="Agents"
        columns={COLUMNS}
        rows={AGENTS}
        rowKey={(a) => a.slug}
        rowHref={(a) => `/agents/${a.slug}`}
        rowAction={(a) => <button type="button">Delete {a.name}</button>}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    const act = screen.getByRole("button", { name: "Delete Ledger reviewer" });
    expect(act.closest("a")).toBeNull();
    expect(act.closest("td")?.className).toContain("stg:z-10");
  });

  it("stays a table at 640px of its own width", () => {
    layOutAt(TABLE_NARROW_BELOW_PX);
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} />);
    expect(screen.getByRole("table", { name: "Agents" })).toBeTruthy();
  });

  it("keeps its columns down to a width of the host's choosing", () => {
    layOutAt(400);
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} narrowBelow={320} />);
    expect(screen.getByRole("table", { name: "Agents" })).toBeTruthy();
  });
});

describe("Table, narrower than 640px of its own width", () => {
  it("draws each row as a list row: the first column its name, the line columns under it, the tag beside it", () => {
    layOutAt(390);
    render(<Table aria-label="Agents" columns={COLUMNS} rows={AGENTS} rowKey={(a) => a.slug} />);
    expect(screen.queryByRole("table")).toBeNull();
    const list = screen.getByRole("list", { name: "Agents" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain("Ledger reviewer");
    expect(rows[0]?.textContent).toContain("Team");
    expect(rows[0]?.textContent).toContain("61");
    expect(rows[1]?.textContent).toContain("Receipts matcher");
  });

  it("joins several line columns with a middle dot and leaves out a hidden or empty one", () => {
    layOutAt(390);
    const columns: readonly TableColumn<Agent>[] = [
      { id: "name", header: "Agent", cell: (a) => a.name },
      { id: "runs", header: "Runs", cell: (a) => `${a.runs} runs` },
      { id: "empty", header: "Note", cell: () => "" },
      { id: "plan", header: "Plan", cell: (a) => a.plan },
      { id: "secret", header: "Internal", cell: () => "not shown", narrow: "hidden" },
    ];
    render(<Table aria-label="Agents" columns={columns} rows={AGENTS.slice(0, 1)} rowKey={(a) => a.slug} />);
    const row = screen.getByRole("listitem");
    expect(row.textContent).toContain("61 runs · Team");
    expect(row.textContent).not.toContain("not shown");
    expect(row.textContent).not.toContain("·  ·");
  });

  it("keeps the row's link and its acts as rows", () => {
    layOutAt(390);
    render(
      <Table
        aria-label="Agents"
        columns={COLUMNS}
        rows={AGENTS}
        rowKey={(a) => a.slug}
        rowHref={(a) => `/agents/${a.slug}`}
        rowAction={(a) => <button type="button">Delete {a.name}</button>}
      />,
    );
    expect(screen.getByRole("link", { name: "Ledger reviewer" }).getAttribute("href")).toBe("/agents/ledger");
    expect(screen.getByRole("button", { name: "Delete Receipts matcher" }).closest("a")).toBeNull();
  });
});

describe("Table as rows, its other placements", () => {
  it("puts a trailing column at the row's end, and a row that does something as a button", async () => {
    layOutAt(390);
    const onRowClick = vi.fn();
    const columns: readonly TableColumn<Agent>[] = [
      { id: "name", header: "Agent", cell: (a) => a.name },
      { id: "plan", header: "Plan", cell: (a) => <span data-testid={`plan-${a.slug}`}>{a.plan}</span>, narrow: "trailing" },
    ];
    render(<Table aria-label="Agents" columns={columns} rows={AGENTS} rowKey={(a) => a.slug} onRowClick={onRowClick} />);
    expect(screen.getByTestId("plan-ledger").textContent).toBe("Team");
    await userEvent.click(screen.getByRole("button", { name: "Ledger reviewer" }));
    expect(onRowClick).toHaveBeenCalledWith(AGENTS[0]);
  });

  it("draws nothing as rows when it has no columns", () => {
    layOutAt(390);
    const { container } = render(<Table aria-label="Agents" columns={[]} rows={AGENTS} rowKey={(a) => a.slug} />);
    expect(container.querySelector("li")).toBeNull();
  });
});

describe("Figure and Figures", () => {
  it("draws a label over a value, 12/16 medium over 24/32 semibold, in the foreground", () => {
    render(<Figure label="Tokens" value="18.4M" line="This week" />);
    const label = screen.getByText("Tokens");
    const value = screen.getByText("18.4M");
    expect(label.className).toContain("stg:text-xs");
    expect(label.className).toContain("stg:font-medium");
    expect(value.className).toContain("stg:text-2xl");
    expect(value.className).toContain("stg:font-semibold");
    expect(value.className).toContain("stg:text-foreground");
    expect(screen.getByText("This week").className).toContain("stg:text-muted-foreground");
    // The label comes first, then the value.
    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws a status value in its hue, and only then", () => {
    const { rerender } = render(<Figure label="Completed" value="128" tone="ready" />);
    expect(screen.getByText("128").className).toContain("stg:text-status-ready");
    rerender(<Figure label="Failed" value="4" tone="failed" />);
    expect(screen.getByText("4").className).toContain("stg:text-destructive");
    expect(screen.getByText("4").className).not.toContain("stg:text-foreground");
  });

  it("draws no line when none is given", () => {
    const { container } = render(<Figure label="Active" value="3" />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
  });

  it("lays figures two to a row on a phone and the given count from the large breakpoint, as a named group", () => {
    render(
      <Figures aria-label="This week's runs" columns={3}>
        <Figure label="Active" value="3" />
      </Figures>,
    );
    const group = screen.getByRole("group", { name: "This week's runs" });
    expect(group.className).toContain("stg:grid-cols-2");
    expect(group.className).toContain("stg:lg:grid-cols-3");
  });
});
