/**
 * FilterBar: each active filter is a chip named by its definition's label
 * and showing its value, a chip's remove button reports that filter, and
 * "Clear all" appears only with two or more filters and reports the clear;
 * with no filters it renders nothing.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FilterDef, FilterValue } from "../../types";
import { FilterBar } from "../FilterBar";

afterEach(cleanup);

const DEFS: readonly FilterDef[] = [
  {
    id: "status",
    label: "Status",
    type: "select",
    options: [{ value: "ready", label: "Ready" }],
  },
  { id: "name", label: "Name", type: "text" },
];

const STATUS: FilterValue = { filterId: "status", operator: "eq", value: "ready" };
const NAME: FilterValue = { filterId: "name", operator: "contains", value: "bot" };

describe("FilterBar", () => {
  it("clears every filter on Clear all", () => {
    const onClearAll = vi.fn();
    const onRemoveFilter = vi.fn();
    render(
      <FilterBar
        filters={[STATUS, NAME]}
        filterDefs={DEFS}
        onRemoveFilter={onRemoveFilter}
        onClearAll={onClearAll}
      />,
    );

    const bar = screen.getByRole("toolbar", { name: "Active filters" });
    expect(bar.textContent).toContain("Status:Ready");
    expect(bar.textContent).toContain("Name:~ bot");
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
    expect(onRemoveFilter).not.toHaveBeenCalled();
  });

  it("removes one filter by its chip, and offers no Clear all for a single filter", () => {
    const onRemoveFilter = vi.fn();
    render(
      <FilterBar
        filters={[NAME]}
        filterDefs={DEFS}
        onRemoveFilter={onRemoveFilter}
        onClearAll={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove Name filter" }));
    expect(onRemoveFilter).toHaveBeenCalledWith("name");
  });

  it("renders nothing with no active filters", () => {
    render(<FilterBar filters={[]} filterDefs={DEFS} onRemoveFilter={vi.fn()} onClearAll={vi.fn()} />);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});
