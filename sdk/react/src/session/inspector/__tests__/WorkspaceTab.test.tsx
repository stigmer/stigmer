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
      { path: "button.tsx", isDirectory: false },
    ]) as WorkspaceFileLister,
    onOpenFile: vi.fn(),
    onOpenWorkspace: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  __clearWorkspaceListingCache();
});

describe("WorkspaceTab", () => {
  it("shows 'Open workspace' when a lister, entries, and handler exist", () => {
    render(<WorkspaceTab actions={makeActions()} />);
    expect(screen.getByRole("button", { name: "Open workspace" })).toBeTruthy();
    // The removed Files/Search toggle no longer renders (search lives in the rail).
    expect(screen.queryByRole("radiogroup", { name: /workspace view/i })).toBeNull();
  });

  it("enters the workspace surface when 'Open workspace' is clicked", () => {
    const onOpenWorkspace = vi.fn();
    render(<WorkspaceTab actions={makeActions({ onOpenWorkspace })} />);
    fireEvent.click(screen.getByRole("button", { name: "Open workspace" }));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("hides 'Open workspace' when there is no lister", () => {
    render(
      <WorkspaceTab actions={makeActions({ workspaceFileLister: undefined })} />,
    );
    expect(screen.queryByRole("button", { name: "Open workspace" })).toBeNull();
  });

  it("hides 'Open workspace' and shows the empty state when there are no entries", () => {
    render(
      <WorkspaceTab actions={makeActions({ workspace: makeWorkspace([]) })} />,
    );
    expect(screen.queryByRole("button", { name: "Open workspace" })).toBeNull();
    expect(screen.getByText(/no workspace attached/i)).toBeTruthy();
  });

  it("opens a file (into the surface) when a tree row is clicked", async () => {
    const onOpenFile = vi.fn();
    render(<WorkspaceTab actions={makeActions({ onOpenFile })} />);

    // Expand the entry's tree (click its header name), then click the file.
    fireEvent.click(screen.getByText("acme/api"));
    fireEvent.click(await screen.findByText("button.tsx"));
    expect(onOpenFile).toHaveBeenCalled();
    const [, path] = onOpenFile.mock.calls[0];
    expect(path).toBe("button.tsx");
  });
});
