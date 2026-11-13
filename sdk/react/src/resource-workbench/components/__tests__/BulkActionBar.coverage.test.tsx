/**
 * BulkActionBar: with nothing selected it renders nothing; with a selection
 * it counts the items (one "item", several "items"), hands every action the
 * selected items, keeps a disabled action from firing, and Cancel calls
 * onCancel.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BulkActionBar } from "../BulkActionBar";

afterEach(cleanup);

interface Row {
  readonly id: string;
}

describe("BulkActionBar", () => {
  it("renders nothing when no item is selected", () => {
    render(<BulkActionBar<Row> selectedCount={0} selectedItems={[]} actions={[]} onCancel={() => {}} />);
    expect(screen.queryByRole("toolbar", { name: "Bulk actions" })).toBeNull();
  });

  it("counts the selection, hands an action the selected items, and cancels", () => {
    const items: Row[] = [{ id: "a" }, { id: "b" }];
    const onDelete = vi.fn();
    const onArchive = vi.fn();
    const onCancel = vi.fn();
    render(
      <BulkActionBar<Row>
        selectedCount={2}
        selectedItems={items}
        actions={[
          { id: "delete", label: "Delete", variant: "destructive", icon: <span>x</span>, onAction: onDelete },
          { id: "archive", label: "Archive", disabled: true, onAction: onArchive },
        ]}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Bulk actions" })).toBeTruthy();
    expect(screen.getByText("2 items selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(items);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(onArchive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("says item, not items, for a selection of one", () => {
    render(<BulkActionBar<Row> selectedCount={1} selectedItems={[{ id: "a" }]} actions={[]} onCancel={() => {}} />);
    expect(screen.getByText("1 item selected")).toBeTruthy();
  });
});
