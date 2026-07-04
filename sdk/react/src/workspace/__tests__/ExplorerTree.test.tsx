import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ExplorerTree } from "../ExplorerTree";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileLister } from "../WorkspaceFileLister";

afterEach(cleanup);

// Unique entry ids per test — `useWorkspaceFiles` keys a module-level cache by
// entry.id, so reusing ids would leak listings across tests.
function entry(id: string, name = "acme/repo"): WorkspaceEntry {
  return {
    id,
    name,
    type: "git",
    gitUrl: "https://github.com/acme/repo",
    gitBranch: "main",
  };
}

function lister(paths: string[]): WorkspaceFileLister {
  return vi.fn(async () => paths.map((path) => ({ path, isDirectory: false })));
}

describe("ExplorerTree", () => {
  it("renders a root header and its top-level files", async () => {
    render(
      <ExplorerTree
        entries={[entry("x1")]}
        lister={lister(["a.ts", "README.md"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );
    expect(screen.getByText("acme/repo")).toBeTruthy();
    expect(await screen.findByText("a.ts")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("starts folders collapsed, revealing children on expand", async () => {
    render(
      <ExplorerTree
        entries={[entry("x1b")]}
        lister={lister(["src/nested.ts"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );
    const folder = await screen.findByText("src");
    expect(screen.queryByText("nested.ts")).toBeNull();
    fireEvent.click(folder);
    expect(await screen.findByText("nested.ts")).toBeTruthy();
  });

  it("opens a file (preview) on single click", async () => {
    const onOpenFile = vi.fn();
    render(
      <ExplorerTree
        entries={[entry("x2")]}
        lister={lister(["a.ts"])}
        selectedFile={null}
        onOpenFile={onOpenFile}
        onActivateFile={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByText("a.ts"));
    expect(onOpenFile).toHaveBeenCalledWith("x2", "a.ts");
  });

  it("pins a file (activate) on double click", async () => {
    const onActivateFile = vi.fn();
    render(
      <ExplorerTree
        entries={[entry("x3")]}
        lister={lister(["a.ts"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={onActivateFile}
      />,
    );
    fireEvent.doubleClick(await screen.findByText("a.ts"));
    expect(onActivateFile).toHaveBeenCalledWith("x3", "a.ts");
  });

  it("highlights the selected file scoped to its entry", async () => {
    render(
      <ExplorerTree
        entries={[entry("x4")]}
        lister={lister(["a.ts", "b.ts"])}
        selectedFile={{ entryId: "x4", path: "a.ts" }}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );
    const selected = await screen.findByText("a.ts");
    const other = screen.getByText("b.ts");
    expect(selected.closest("button")?.getAttribute("aria-current")).toBe("true");
    expect(other.closest("button")?.getAttribute("aria-current")).toBeNull();
  });

  it("collapses all but the first root by default", async () => {
    render(
      <ExplorerTree
        entries={[entry("x5a", "first"), entry("x5b", "second")]}
        lister={lister(["a.ts"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );
    // First root is expanded (its file shows); second root header shows but its
    // tree is not fetched/rendered until expanded.
    expect(await screen.findByText("a.ts")).toBeTruthy();
    const second = screen.getByText("second").closest("button")!;
    expect(second.getAttribute("aria-expanded")).toBe("false");
  });

  it("offers a remove control per root when onRemoveEntry is provided", async () => {
    const onRemoveEntry = vi.fn();
    render(
      <ExplorerTree
        entries={[entry("x6")]}
        lister={lister(["a.ts"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
        onRemoveEntry={onRemoveEntry}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove acme/repo from workspace" }),
    );
    expect(onRemoveEntry).toHaveBeenCalledWith("x6");
  });

  it("is browse-only (no remove controls) without onRemoveEntry", () => {
    render(
      <ExplorerTree
        entries={[entry("x7")]}
        lister={lister(["a.ts"])}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /Remove .* from workspace/ }),
    ).toBeNull();
  });
});
