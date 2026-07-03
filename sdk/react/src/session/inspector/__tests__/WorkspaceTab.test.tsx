import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkspaceTab, type WorkspaceTabActions } from "../WorkspaceTab";
import { __clearWorkspaceListingCache } from "../../../workspace/workspaceListingCache";
import type { WorkspaceEntry } from "../../../workspace/useWorkspaceEntries";
import type { UseWorkspaceEntriesReturn } from "../../../workspace/useWorkspaceEntries";
import type { WorkspaceFileLister } from "../../../workspace/WorkspaceFileLister";

let entryIdCounter = 0;
function makeEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: `ws-${++entryIdCounter}`,
    name: "acme/api",
    type: "git",
    gitUrl: "https://github.com/acme/api",
    gitBranch: "main",
    ...overrides,
  };
}

function makeWorkspace(entries: readonly WorkspaceEntry[]): UseWorkspaceEntriesReturn {
  return {
    entries,
    addGitRepo: vi.fn(),
    addLocalPath: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    clearLocal: vi.fn(),
    toInput: vi.fn(() => []),
    hasEntries: entries.length > 0,
  };
}

function makeActions(overrides?: Partial<WorkspaceTabActions>): WorkspaceTabActions {
  return {
    workspace: makeWorkspace([makeEntry()]),
    enableGitHub: true,
    enableLocal: false,
    workspaceFileLister: vi.fn(async () => [
      { path: "src/button.tsx", isDirectory: false },
    ]) as WorkspaceFileLister,
    onOpenFile: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  __clearWorkspaceListingCache();
});

describe("WorkspaceTab — Files/Search toggle", () => {
  it("defaults to Files mode and shows the toggle when a lister and entries exist", () => {
    render(<WorkspaceTab actions={makeActions()} />);
    const toggle = screen.getByRole("radiogroup", { name: /workspace view/i });
    expect(toggle).toBeTruthy();
    const files = screen.getByRole("radio", { name: "Files" });
    expect(files.getAttribute("aria-checked")).toBe("true");
    // Files mode: no search combobox.
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("hides the toggle when there is no lister", () => {
    render(
      <WorkspaceTab actions={makeActions({ workspaceFileLister: undefined })} />,
    );
    expect(screen.queryByRole("radiogroup", { name: /workspace view/i })).toBeNull();
  });

  it("hides the toggle when there are no entries", () => {
    render(
      <WorkspaceTab
        actions={makeActions({ workspace: makeWorkspace([]) })}
      />,
    );
    expect(screen.queryByRole("radiogroup", { name: /workspace view/i })).toBeNull();
    // Empty state still renders.
    expect(screen.getByText(/no workspace attached/i)).toBeTruthy();
  });

  it("switches to Search mode (search input appears) and back to Files", () => {
    render(<WorkspaceTab actions={makeActions()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Search" }));
    const input = screen.getByRole("combobox");
    expect(input).toBeTruthy();
    // Autofocused on entering search.
    expect(document.activeElement).toBe(input);

    fireEvent.click(screen.getByRole("radio", { name: "Files" }));
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
