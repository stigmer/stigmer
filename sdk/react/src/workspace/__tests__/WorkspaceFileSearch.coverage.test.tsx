/**
 * WorkspaceFileSearch's zero-results act: a name search that matches no
 * file names the search, and "Clear search" empties the box, returns focus
 * to it and brings back the starting hint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceFileSearch } from "../WorkspaceFileSearch";
import { __clearWorkspaceListingCache } from "../workspaceListingCache";
import type { WorkspaceFileEntry } from "../WorkspaceFileLister";

const FILES: WorkspaceFileEntry[] = [
  { path: "src/index.ts", isDirectory: false },
  { path: "README.md", isDirectory: false },
];

describe("WorkspaceFileSearch", () => {
  beforeEach(() => {
    __clearWorkspaceListingCache();
  });
  afterEach(cleanup);

  it("names a search with no match and Clear search starts over", async () => {
    render(
      <WorkspaceFileSearch
        entries={[{ id: "ws-coverage-clear", name: "acme/api", type: "git", gitUrl: "https://github.com/acme/api", gitBranch: "main" }]}
        lister={vi.fn(async () => FILES)}
        onOpenFile={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "zzzzz" } });
    expect(
      await screen.findByText("No files matching “zzzzz”.", { ignore: ".stg\\:sr-only" }),
    ).toBeTruthy();

    // The empty state's act, by its visible words; the box's own clear icon shares the label.
    fireEvent.click(screen.getByText("Clear search", { selector: "button" }));

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText(/search files by name across the whole workspace/i)).toBeTruthy();
    expect(screen.queryByText("No files matching “zzzzz”.", { ignore: ".stg\\:sr-only" })).toBeNull();
  });
});
