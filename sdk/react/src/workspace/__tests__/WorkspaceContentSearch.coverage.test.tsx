/**
 * WorkspaceContentSearch's zero-results act: a text search with no hit
 * names the search, and "Clear search" empties the box, returns focus to
 * it and brings back the starting hint.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceContentSearch } from "../WorkspaceContentSearch";
import type { WorkspaceContentSearcher } from "../WorkspaceContentSearcher";

afterEach(cleanup);

describe("WorkspaceContentSearch", () => {
  it("names a search with no hit and Clear search starts over", async () => {
    const searcher: WorkspaceContentSearcher = vi.fn(async () => ({ matches: [], truncated: false }));
    render(
      <WorkspaceContentSearch
        entries={[{ id: "ws-coverage-clear", name: "acme/api", type: "local", localPath: "/repo" }]}
        searcher={searcher}
        onOpenFile={vi.fn()}
      />,
    );

    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nowhere" } });
    expect(
      await screen.findByText("No files containing “nowhere”.", { ignore: ".stg\\:sr-only" }),
    ).toBeTruthy();

    // The empty state's act, by its visible words; the box's own clear icon shares the label.
    fireEvent.click(screen.getByText("Clear search", { selector: "button" }));

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(screen.getByText(/search file contents across the whole workspace/i)).toBeTruthy();
    expect(screen.queryByText("No files containing “nowhere”.", { ignore: ".stg\\:sr-only" })).toBeNull();
  });
});
