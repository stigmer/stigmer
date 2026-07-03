import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkspaceEntryFiles } from "../WorkspaceEntryFiles";

afterEach(cleanup);
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileLister } from "../WorkspaceFileLister";

// Unique entry ids per test — `useWorkspaceFiles` keys a module-level cache by
// entry.id, so reusing ids would leak listings across tests.
function entry(id: string): WorkspaceEntry {
  return {
    id,
    name: "acme/repo",
    type: "git",
    gitUrl: "https://github.com/acme/repo",
    gitBranch: "main",
  };
}

function lister(paths: string[]): WorkspaceFileLister {
  return vi.fn(async () => paths.map((path) => ({ path, isDirectory: false })));
}

describe("WorkspaceEntryFiles", () => {
  it("calls onOpenFile(entry.id, path) when a file is clicked (controlled)", async () => {
    const onOpenFile = vi.fn();
    render(
      <WorkspaceEntryFiles
        entry={entry("c1")}
        lister={lister(["a.ts"])}
        isExpanded
        onOpenFile={onOpenFile}
      />,
    );

    const row = await screen.findByText("a.ts");
    fireEvent.click(row);

    expect(onOpenFile).toHaveBeenCalledWith("c1", "a.ts");
  });

  it("highlights the controlled selectedPath", async () => {
    render(
      <WorkspaceEntryFiles
        entry={entry("c2")}
        lister={lister(["a.ts", "b.ts"])}
        isExpanded
        onOpenFile={vi.fn()}
        selectedPath="a.ts"
      />,
    );

    const selected = await screen.findByText("a.ts");
    const other = screen.getByText("b.ts");
    expect(selected.closest("button")?.getAttribute("aria-current")).toBe("true");
    expect(other.closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("falls back to local selection when onOpenFile is absent", async () => {
    render(
      <WorkspaceEntryFiles
        entry={entry("c3")}
        lister={lister(["a.ts"])}
        isExpanded
      />,
    );

    const row = await screen.findByText("a.ts");
    const button = row.closest("button")!;
    expect(button.getAttribute("aria-current")).toBeNull();

    fireEvent.click(row);
    expect(button.getAttribute("aria-current")).toBe("true");
  });

  it("shows a truncation banner and never a clickable notice leaf (DD-11)", async () => {
    const onOpenFile = vi.fn();
    const truncatedLister: WorkspaceFileLister = vi.fn(async () => [
      { path: "a.ts", isDirectory: false },
      {
        path: "... (tree truncated by GitHub — repository has too many files)",
        isDirectory: false,
        notice: true as const,
      },
    ]);

    render(
      <WorkspaceEntryFiles
        entry={entry("c4")}
        lister={truncatedLister}
        isExpanded
        onOpenFile={onOpenFile}
      />,
    );

    // The real file is a leaf; the notice message is not rendered as a row.
    await screen.findByText("a.ts");
    expect(screen.queryByText(/tree truncated by GitHub/i)).toBeNull();

    // A partial-listing banner is shown instead, and it is not clickable.
    const banner = screen.getByText(/partial listing/i);
    expect(banner.closest("button")).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});
