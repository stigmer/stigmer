/**
 * BulkActionBar: with items selected it names how many, each action hands
 * its handler the selected items, a disabled action does nothing, and
 * Cancel reports the deselect; with nothing selected it renders nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BulkActionBar } from "../BulkActionBar";

afterEach(cleanup);

const ITEMS = ["alpha", "beta"] as const;

describe("BulkActionBar", () => {
  it("hands each action the selected items", () => {
    const onDelete = vi.fn();
    const onArchive = vi.fn();
    render(
      <BulkActionBar
        selectedCount={2}
        selectedItems={ITEMS}
        actions={[
          { id: "delete", label: "Delete", variant: "destructive", onAction: onDelete },
          { id: "archive", label: "Archive", onAction: onArchive, icon: <span>A</span> },
        ]}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Bulk actions" }).textContent).toContain(
      "2 items selected",
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(ITEMS);
    expect(onArchive).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Archive/ }));
    expect(onArchive).toHaveBeenCalledWith(ITEMS);
  });

  it("does nothing on a disabled action", () => {
    const onAction = vi.fn();
    render(
      <BulkActionBar
        selectedCount={1}
        selectedItems={["alpha"]}
        actions={[{ id: "move", label: "Move", onAction, disabled: true }]}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("1 item selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    expect(onAction).not.toHaveBeenCalled();
  });

  it("reports Cancel so the selection can be cleared", () => {
    const onCancel = vi.fn();
    render(
      <BulkActionBar selectedCount={1} selectedItems={["alpha"]} actions={[]} onCancel={onCancel} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("renders nothing while nothing is selected", () => {
    render(<BulkActionBar selectedCount={0} selectedItems={[]} actions={[]} onCancel={vi.fn()} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
