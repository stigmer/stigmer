import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { forwardRef } from "react";

// ---------------------------------------------------------------------------
// WorkspaceSurface composes the activity rail (Explorer / Search), a resizable
// sidebar, and the read-only editor. The explorer tree, search, and viewer are
// exercised by their own suites; here we mock them as probes and prove the
// surface's own composition — rail switching, the editor tabs/toolbar, collapse,
// breadcrumbs, and that the active file (+ its change) reaches a chrome-less
// FileViewer.
// ---------------------------------------------------------------------------

type CapturedProps = Record<string, unknown>;

const viewerProps: CapturedProps[] = [];
vi.mock("../FileViewer", () => ({
  FileViewer: forwardRef((props: CapturedProps, _ref) => {
    viewerProps.push(props);
    return <div data-testid="viewer-probe" />;
  }),
}));

vi.mock("../ExplorerTree", () => ({
  ExplorerTree: () => <div data-testid="explorer-probe" />,
}));

vi.mock("../WorkspaceFileSearch", () => ({
  WorkspaceFileSearch: () => <div data-testid="search-probe" />,
}));

import { WorkspaceSurface } from "../WorkspaceSurface";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileLister } from "../WorkspaceFileLister";
import type { WorkspaceFileReader } from "../WorkspaceFileReader";

const gitEntry: WorkspaceEntry = {
  id: "e1",
  name: "acme/app",
  type: "git",
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
} as WorkspaceEntry;

const lister: WorkspaceFileLister = vi.fn(async () => []) as unknown as WorkspaceFileLister;
const reader: WorkspaceFileReader = vi.fn(async () => null) as unknown as WorkspaceFileReader;

function renderSurface(overrides: Partial<React.ComponentProps<typeof WorkspaceSurface>> = {}) {
  const onOpenFile = vi.fn();
  const onActivateEditor = vi.fn();
  const onPinEditor = vi.fn();
  const onCloseEditor = vi.fn();
  const onCollapse = vi.fn();
  render(
    <WorkspaceSurface
      entries={[gitEntry]}
      lister={lister}
      reader={reader}
      editors={[{ entryId: "e1", path: "src/main.go", preview: false }]}
      selectedFile={{ entryId: "e1", path: "src/main.go" }}
      onOpenFile={onOpenFile}
      onActivateEditor={onActivateEditor}
      onPinEditor={onPinEditor}
      onCloseEditor={onCloseEditor}
      onCollapse={onCollapse}
      {...overrides}
    />,
  );
  return { onOpenFile, onActivateEditor, onPinEditor, onCloseEditor, onCollapse };
}

beforeEach(() => {
  viewerProps.length = 0;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceSurface", () => {
  it("renders the activity rail with Explorer selected by default", () => {
    renderSurface();
    const explorer = screen.getByRole("radio", { name: "Explorer" });
    const search = screen.getByRole("radio", { name: "Search" });
    expect(explorer.getAttribute("aria-checked")).toBe("true");
    expect(search.getAttribute("aria-checked")).toBe("false");
    // Explorer view: the explorer tree renders; the search surface does not.
    expect(screen.getByTestId("explorer-probe")).toBeTruthy();
    expect(screen.queryByTestId("search-probe")).toBeNull();
  });

  it("switches to the search surface when Search is selected", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("radio", { name: "Search" }));
    expect(screen.getByTestId("search-probe")).toBeTruthy();
    expect(screen.queryByTestId("explorer-probe")).toBeNull();
  });

  it("hands the open file (and its change) to a chrome-less FileViewer", () => {
    const change = { path: "src/main.go" } as never;
    renderSurface({ change });
    const props = viewerProps.at(-1);
    expect(props?.selectedFile).toEqual({ entryId: "e1", path: "src/main.go" });
    expect(props?.showHeader).toBe(false);
    expect(props?.change).toBe(change);
  });

  it("shows the open file as a tab", () => {
    renderSurface();
    const tab = screen.getByRole("tab", { name: /main\.go/ });
    expect(tab).toBeTruthy();
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("collapses back to chat when the toolbar control is clicked", () => {
    const { onCollapse } = renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "Back to chat" }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("shows an empty editor when no file is selected", () => {
    renderSurface({ selectedFile: null, editors: [] });
    expect(viewerProps.length).toBe(0);
    expect(screen.getByText("Select a file to view its contents.")).toBeTruthy();
  });
});
