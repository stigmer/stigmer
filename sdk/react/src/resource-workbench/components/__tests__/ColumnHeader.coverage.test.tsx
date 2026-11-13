/**
 * ColumnHeader: a sortable column is a button inside the header cell that
 * calls onSort when pressed and names its direction to assistive tech through
 * aria-sort; a column that does not sort is plain text with no aria-sort.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ColumnHeader } from "../ColumnHeader";

afterEach(cleanup);

function renderInRow(node: ReactNode) {
  return render(
    <table>
      <thead>
        <tr>{node}</tr>
      </thead>
    </table>,
  );
}

describe("ColumnHeader", () => {
  it("calls onSort when a sortable header is pressed and reports its direction", () => {
    const onSort = vi.fn();
    renderInRow(<ColumnHeader label="Name" sortable sortDirection="desc" onSort={onSort} />);

    const header = screen.getByRole("columnheader", { name: "Name" });
    expect(header.getAttribute("aria-sort")).toBe("descending");

    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it("names an ascending sort, and no sort when the column is unsorted", () => {
    const { rerender } = renderInRow(<ColumnHeader label="Name" sortable sortDirection="asc" onSort={() => {}} />);
    expect(screen.getByRole("columnheader", { name: "Name" }).getAttribute("aria-sort")).toBe("ascending");

    rerender(
      <table>
        <thead>
          <tr>
            <ColumnHeader label="Name" sortable sortDirection={null} onSort={() => {}} />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader", { name: "Name" }).hasAttribute("aria-sort")).toBe(false);
  });

  it("renders a column that does not sort as text with no button", () => {
    renderInRow(<ColumnHeader label="Owner" sortable={false} sortDirection={null} />);
    expect(screen.getByRole("columnheader", { name: "Owner" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
