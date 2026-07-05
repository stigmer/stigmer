import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { WorkspaceFileSearch } from "../WorkspaceFileSearch";
import { __clearWorkspaceListingCache } from "../workspaceListingCache";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../WorkspaceFileLister";

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

const FILES: WorkspaceFileEntry[] = [
  { path: "src/index.ts", isDirectory: false },
  { path: "src/button.tsx", isDirectory: false },
  { path: "README.md", isDirectory: false },
];

function typeQuery(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("WorkspaceFileSearch", () => {
  beforeEach(() => {
    __clearWorkspaceListingCache();
  });
  afterEach(cleanup);

  it("shows an unavailable state and disables input when no lister is injected", () => {
    render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={undefined}
        onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText(/search isn.t available here/i)).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("shows a hint when the query is empty", () => {
    render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/search files by name across the whole workspace/i),
    ).toBeTruthy();
  });

  it("renders a flat result list and opens a file on click (single entry)", async () => {
    const entry = makeEntry();
    const onOpenFile = vi.fn();
    render(
      <WorkspaceFileSearch
        entries={[entry]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={onOpenFile}
      />,
    );

    typeQuery("button");
    const option = await screen.findByRole("option");
    fireEvent.click(within(option).getByRole("button"));

    expect(onOpenFile).toHaveBeenCalledWith(entry.id, "src/button.tsx");
    // Single entry → no group header.
    expect(screen.queryByText("acme/api")).toBeNull();
  });

  it("groups results by entry when more than one entry matches", async () => {
    const a = makeEntry({ name: "acme/api" });
    const b = makeEntry({ name: "acme/web" });
    const lister: WorkspaceFileLister = vi.fn(async (e) =>
      e.id === a.id
        ? [{ path: "src/button.tsx", isDirectory: false }]
        : [{ path: "lib/button.ts", isDirectory: false }],
    );
    render(
      <WorkspaceFileSearch entries={[a, b]} lister={lister} onOpenFile={vi.fn()} />,
    );

    typeQuery("button");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("acme/web")).toBeTruthy();
  });

  it("highlights the matched substring", async () => {
    const { container } = render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("button");
    await screen.findByRole("option");
    const highlight = container.querySelector(".font-semibold");
    expect(highlight?.textContent).toBe("button");
  });

  it("marks the currently open file with aria-current", async () => {
    const entry = makeEntry();
    render(
      <WorkspaceFileSearch
        entries={[entry]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
        selectedFile={{ entryId: entry.id, path: "src/button.tsx" }}
      />,
    );
    typeQuery("button");
    const option = await screen.findByRole("option");
    expect(within(option).getByRole("button").getAttribute("aria-current")).toBe(
      "true",
    );
  });

  it("shows a no-match state", async () => {
    render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("zzzzz");
    // Assert the visible message, not the parallel sr-only live-region copy.
    expect(
      await screen.findByText(/no files matching/i, { ignore: ".sr-only" }),
    ).toBeTruthy();
  });

  it("renders a truncation notice from a notice entry", async () => {
    render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={vi.fn(async () => [
          { path: "src/button.tsx", isDirectory: false },
          { path: "... truncated", isDirectory: false, notice: true as const },
        ])}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("button");
    await screen.findByRole("option");
    expect(screen.getByText(/too many files to search in full/i)).toBeTruthy();
  });

  it("moves virtual focus with ArrowDown and opens on Enter", async () => {
    const entry = makeEntry();
    const onOpenFile = vi.fn();
    render(
      <WorkspaceFileSearch
        entries={[entry]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={onOpenFile}
      />,
    );

    const input = typeQuery("src"); // matches src/index.ts and src/button.tsx
    await screen.findAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    const focusedOption = document.getElementById(active!);
    expect(focusedOption?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(onOpenFile.mock.calls[0][0]).toBe(entry.id);
  });

  it("announces result status in a polite live region", async () => {
    render(
      <WorkspaceFileSearch
        entries={[makeEntry()]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
      />,
    );
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");

    typeQuery("button");
    await screen.findByRole("option");
    expect(status.textContent).toMatch(/matching file/i);

    typeQuery("zzzzz");
    await screen.findByText(/no files matching/i, { ignore: ".sr-only" });
    expect(status.textContent).toMatch(/no files matching/i);
  });

  it("caps rendered results and reports the total", async () => {
    const entry = makeEntry();
    const many: WorkspaceFileEntry[] = Array.from({ length: 250 }, (_, i) => ({
      path: `src/match-${i}.ts`,
      isDirectory: false,
    }));
    render(
      <WorkspaceFileSearch
        entries={[entry]}
        lister={vi.fn(async () => many)}
        onOpenFile={vi.fn()}
      />,
    );

    typeQuery("match");
    await screen.findAllByRole("option");
    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(screen.getByText(/showing the first 200 of 250 matches/i)).toBeTruthy();
  });
});
