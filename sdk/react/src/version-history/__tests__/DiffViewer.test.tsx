import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DiffViewer } from "../DiffViewer";
import type { DiffHunk } from "../types";

afterEach(cleanup);

// A hunk exercising all three line types: an unchanged line, a removal, and an
// addition — so the single-gutter numbering can be checked per type.
const hunk: DiffHunk = {
  oldStart: 1,
  oldLines: 2,
  newStart: 1,
  newLines: 2,
  lines: [
    { type: "context", content: "keep", oldLineNumber: 1, newLineNumber: 1 },
    { type: "removed", content: "gone", oldLineNumber: 2 },
    { type: "added", content: "fresh", newLineNumber: 2 },
  ],
};

/** The first cell of a row is the (single) line-number gutter. */
function gutter(row: Element): string {
  return row.querySelectorAll("td")[0]?.textContent ?? "";
}

describe("DiffViewer — single-column gutter (Cursor-style)", () => {
  it("renders exactly one line-number column (3 cells per row, not 4)", () => {
    const { container } = render(<DiffViewer hunks={[hunk]} />);
    const firstRow = container.querySelector("tbody tr")!;
    // gutter + marker + content — the old+new pair is collapsed to one.
    expect(firstRow.querySelectorAll("td")).toHaveLength(3);
  });

  it("numbers each line from the side it belongs to (new for added/context, old for removed)", () => {
    const { container } = render(<DiffViewer hunks={[hunk]} />);
    const rows = Array.from(container.querySelectorAll("tbody tr"));

    // context "keep" → its new-file number
    expect(gutter(rows[0])).toBe("1");
    expect(rows[0].textContent).toContain("keep");

    // removed "gone" → its old-file number (it has no new-side number)
    expect(gutter(rows[1])).toBe("2");
    expect(rows[1].textContent).toContain("gone");

    // added "fresh" → its new-file number
    expect(gutter(rows[2])).toBe("2");
    expect(rows[2].textContent).toContain("fresh");
  });

  it("renders a 'No changes' status (no table) for empty hunks", () => {
    const { container } = render(<DiffViewer hunks={[]} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("No changes");
  });
});
