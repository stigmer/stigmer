import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
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

vi.mock("../WorkspaceContentSearch", () => ({
  WorkspaceContentSearch: () => <div data-testid="content-search-probe" />,
}));

import { WorkspaceSurface } from "../WorkspaceSurface";
import { virtualEntryId } from "../../internal/store/index.js";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileLister } from "../WorkspaceFileLister";
import type { WorkspaceFileReader } from "../WorkspaceFileReader";
import type { WorkspaceContentSearcher } from "../WorkspaceContentSearcher";

const gitEntry: WorkspaceEntry = {
  id: "e1",
  name: "acme/app",
  type: "git",
  gitUrl: "https://github.com/acme/app.git",
  gitBranch: "main",
} as WorkspaceEntry;

const lister: WorkspaceFileLister = vi.fn(async () => []) as unknown as WorkspaceFileLister;
const reader: WorkspaceFileReader = vi.fn(async () => null) as unknown as WorkspaceFileReader;
const searcher: WorkspaceContentSearcher = vi.fn(async () => ({
  matches: [],
  truncated: false,
})) as unknown as WorkspaceContentSearcher;

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

  it("shows only filename search (no Name|Text toggle) when no content searcher is injected", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("radio", { name: "Search" }));
    expect(screen.queryByRole("radiogroup", { name: "Search mode" })).toBeNull();
    expect(screen.getByTestId("search-probe")).toBeTruthy();
    expect(screen.queryByTestId("content-search-probe")).toBeNull();
  });

  it("offers a Name|Text toggle when a content searcher is injected, routing Text to content search", () => {
    renderSurface({ searcher });
    fireEvent.click(screen.getByRole("radio", { name: "Search" }));

    const toggle = screen.getByRole("radiogroup", { name: "Search mode" });
    expect(toggle).toBeTruthy();
    // Filename search is the default mode.
    expect(screen.getByTestId("search-probe")).toBeTruthy();
    expect(screen.queryByTestId("content-search-probe")).toBeNull();

    // Switching to Text routes to the content-search surface.
    fireEvent.click(within(toggle).getByRole("radio", { name: "Text" }));
    expect(screen.getByTestId("content-search-probe")).toBeTruthy();
    expect(screen.queryByTestId("search-probe")).toBeNull();
  });

  it("hands the open file (and its change) to a chrome-less FileViewer", () => {
    const change = { path: "src/main.go" } as never;
    renderSurface({ change });
    const props = viewerProps.at(-1);
    expect(props?.selectedFile).toEqual({ entryId: "e1", path: "src/main.go" });
    expect(props?.showHeader).toBe(false);
    expect(props?.change).toBe(change);
  });

  it("forwards a jump-to-line reveal to the FileViewer", () => {
    const reveal = { line: 12, nonce: 3 };
    renderSurface({ reveal });
    expect(viewerProps.at(-1)?.reveal).toBe(reveal);
  });

  it("shows the open file as a tab", () => {
    renderSurface();
    const tab = screen.getByRole("tab", { name: /main\.go/ });
    expect(tab).toBeTruthy();
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("associates the active tab with the single editor tabpanel", () => {
    renderSurface();
    const tab = screen.getByRole("tab", { name: /main\.go/ });
    const panel = screen.getByRole("tabpanel");
    const panelId = panel.getAttribute("id");
    expect(panelId).toBeTruthy();
    expect(tab.getAttribute("id")).toBeTruthy();
    // Tab -> panel and panel -> active tab, both directions wired.
    expect(tab.getAttribute("aria-controls")).toBe(panelId);
    expect(panel.getAttribute("aria-labelledby")).toBe(tab.getAttribute("id"));
  });

  it("renders no tabpanel when no editor is open (nothing to label)", () => {
    renderSurface({ selectedFile: null, editors: [] });
    expect(screen.queryByRole("tabpanel")).toBeNull();
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

// ---------------------------------------------------------------------------
// Host-injected rail views (extraViews) — the unified-panel extension seam
// ---------------------------------------------------------------------------

const configView = {
  id: "configure",
  label: "Config",
  icon: <span data-testid="config-icon" />,
  content: <div data-testid="config-probe" />,
};

const changesView = {
  id: "changes",
  label: "Changes",
  icon: <span />,
  badge: 3,
  content: <div data-testid="changes-probe" />,
};

describe("WorkspaceSurface extraViews", () => {
  it("renders injected views in the rail after the built-ins", () => {
    renderSurface({ extraViews: [configView, changesView] });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("title"))).toEqual([
      "Explorer",
      "Search",
      "Config",
      "Changes",
    ]);
  });

  it("shows a count badge on a rail view and folds it into the accessible name", () => {
    renderSurface({ extraViews: [changesView] });
    const changes = screen.getByRole("radio", { name: "Changes (3)" });
    expect(changes.textContent).toContain("3");
  });

  it("renders an extra view's content in the sidebar (with heading) when selected, keeping the editor area", () => {
    renderSurface({ extraViews: [configView] });
    fireEvent.click(screen.getByRole("radio", { name: "Config" }));
    expect(screen.getByTestId("config-probe")).toBeTruthy();
    expect(screen.queryByTestId("explorer-probe")).toBeNull();
    // Sidebar heading + the editor area (file tab) both present.
    expect(screen.getByText("Config")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /main\.go/ })).toBeTruthy();
  });

  it("supports controlled view selection via view/onViewChange", () => {
    const onViewChange = vi.fn();
    renderSurface({
      extraViews: [configView],
      view: "configure",
      onViewChange,
    });
    expect(screen.getByTestId("config-probe")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Search" }));
    expect(onViewChange).toHaveBeenCalledWith("search");
    // Controlled: the view does not change until the owner re-renders.
    expect(screen.getByTestId("config-probe")).toBeTruthy();
  });

  it("falls back to the explorer when the active view id no longer exists", () => {
    // e.g. a contextual view (Inspect) that disappeared while active.
    renderSurface({ extraViews: [], view: "inspect" });
    expect(screen.getByTestId("explorer-probe")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Explorer" }).getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("moves across built-in and injected views with arrow keys", () => {
    renderSurface({ extraViews: [configView] });
    const search = screen.getByRole("radio", { name: "Search" });
    fireEvent.click(search);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByTestId("config-probe")).toBeTruthy();
  });

  it("reaches an injected view beyond the second by keyboard (focus follows selection)", () => {
    // Regression guard: the old handler moved selection but never DOM focus, so
    // focus stayed pinned on the entered button and every view past the second
    // (Config, Changes, …) was keyboard-unreachable. Each arrow must advance
    // focus so the next arrow computes from the new position.
    renderSurface({ extraViews: [configView, changesView] });
    const explorer = screen.getByRole("radio", { name: "Explorer" });
    explorer.focus();
    expect(document.activeElement).toBe(explorer);

    // Step 1: Explorer -> Search, focus moves with the selection.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const search = screen.getByRole("radio", { name: "Search" });
    expect(document.activeElement).toBe(search);
    expect(search.getAttribute("aria-checked")).toBe("true");

    // Step 2: Search -> Config. The step the old code could not make.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    const config = screen.getByRole("radio", { name: "Config" });
    expect(document.activeElement).toBe(config);
    expect(config.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("config-probe")).toBeTruthy();
  });

  it("jumps to the last and first rail views with End and Home", () => {
    renderSurface({ extraViews: [configView, changesView] });
    const explorer = screen.getByRole("radio", { name: "Explorer" });
    explorer.focus();

    fireEvent.keyDown(document.activeElement!, { key: "End" });
    const changes = screen.getByRole("radio", { name: "Changes (3)" });
    expect(document.activeElement).toBe(changes);
    expect(changes.getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    const explorerAgain = screen.getByRole("radio", { name: "Explorer" });
    expect(document.activeElement).toBe(explorerAgain);
    expect(explorerAgain.getAttribute("aria-checked")).toBe("true");
  });

  it("moves focus with selection in the Name|Text search-mode toggle", () => {
    renderSurface({ searcher });
    fireEvent.click(screen.getByRole("radio", { name: "Search" }));
    const toggle = screen.getByRole("radiogroup", { name: "Search mode" });
    const name = within(toggle).getByRole("radio", { name: "Name" });
    name.focus();

    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    const text = within(toggle).getByRole("radio", { name: "Text" });
    expect(document.activeElement).toBe(text);
    expect(text.getAttribute("aria-checked")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// Host-injected virtual documents — editor tabs that are not workspace files
// (the session's plan.md today). Same open/pin/close semantics as file tabs;
// only the body rendering diverges.
// ---------------------------------------------------------------------------

const PLAN_ENTRY_ID = virtualEntryId("plan");

const planDocument = {
  entryId: PLAN_ENTRY_ID,
  path: "plan.md",
  content: <div data-testid="plan-doc-probe" />,
};

describe("WorkspaceSurface virtualDocuments", () => {
  it("renders the virtual document's content — no FileViewer, no breadcrumbs", () => {
    renderSurface({
      virtualDocuments: [planDocument],
      editors: [{ entryId: PLAN_ENTRY_ID, path: "plan.md", preview: false }],
      selectedFile: { entryId: PLAN_ENTRY_ID, path: "plan.md" },
    });
    expect(screen.getByTestId("plan-doc-probe")).toBeTruthy();
    expect(viewerProps.length).toBe(0);
    expect(screen.queryByRole("navigation", { name: "File location" })).toBeNull();
  });

  it("shows the virtual document as an ordinary tab (basename label)", () => {
    renderSurface({
      virtualDocuments: [planDocument],
      editors: [
        { entryId: "e1", path: "src/main.go", preview: false },
        { entryId: PLAN_ENTRY_ID, path: "plan.md", preview: false },
      ],
      selectedFile: { entryId: PLAN_ENTRY_ID, path: "plan.md" },
    });
    const tab = screen.getByRole("tab", { name: /plan\.md/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps file tabs on the FileViewer path while a virtual document is injected", () => {
    renderSurface({
      virtualDocuments: [planDocument],
      editors: [
        { entryId: "e1", path: "src/main.go", preview: false },
        { entryId: PLAN_ENTRY_ID, path: "plan.md", preview: false },
      ],
      selectedFile: { entryId: "e1", path: "src/main.go" },
    });
    expect(screen.queryByTestId("plan-doc-probe")).toBeNull();
    expect(viewerProps.at(-1)?.selectedFile).toEqual({
      entryId: "e1",
      path: "src/main.go",
    });
  });

  it("a virtual entry id can never alias a real file of the same path", () => {
    // The NUL-namespaced id is the collision guard: a workspace file named
    // plan.md under a real entry must not hijack the virtual document body.
    renderSurface({
      virtualDocuments: [planDocument],
      editors: [{ entryId: "e1", path: "plan.md", preview: false }],
      selectedFile: { entryId: "e1", path: "plan.md" },
    });
    expect(screen.queryByTestId("plan-doc-probe")).toBeNull();
    expect(viewerProps.at(-1)?.selectedFile).toEqual({
      entryId: "e1",
      path: "plan.md",
    });
  });

  it("scrolls the document body vertically only — wide content reflows, never a sideways scrollbar", () => {
    renderSurface({
      virtualDocuments: [planDocument],
      editors: [{ entryId: PLAN_ENTRY_ID, path: "plan.md", preview: false }],
      selectedFile: { entryId: PLAN_ENTRY_ID, path: "plan.md" },
    });
    const body = screen.getByTestId("plan-doc-probe").parentElement!;
    expect(body.className).toContain("overflow-y-auto");
    // overflow-y alone computes overflow-x to auto; the explicit hidden +
    // min-w-0 pair is what forces documents to reflow at narrow widths.
    expect(body.className).toContain("overflow-x-hidden");
    expect(body.className).toContain("min-w-0");
  });
});

// ---------------------------------------------------------------------------
// Workspace entry management in the Explorer sidebar
// ---------------------------------------------------------------------------

describe("WorkspaceSurface entry management", () => {
  it("renders an Add Folder footer action when onAddLocalFolder is provided", () => {
    const onAddLocalFolder = vi.fn();
    renderSurface({ onAddLocalFolder });
    fireEvent.click(screen.getByRole("button", { name: "Add Folder" }));
    expect(onAddLocalFolder).toHaveBeenCalledTimes(1);
  });

  it("omits the Add Folder action without the callback (web has no native picker)", () => {
    renderSurface();
    expect(screen.queryByRole("button", { name: "Add Folder" })).toBeNull();
  });
});
