/**
 * ExplorerTree's failed listing: a lister that throws shows the "Couldn't
 * load the files." note with the failure's words, and its "Try again" act
 * lists the entry again so the files appear.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ExplorerTree } from "../ExplorerTree";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type { WorkspaceFileLister } from "../WorkspaceFileLister";

afterEach(cleanup);

// A unique entry id: `useWorkspaceFiles` caches listings by entry id across tests.
const ENTRY: WorkspaceEntry = {
  id: "coverage-explorer-error",
  name: "acme/repo",
  type: "git",
  gitUrl: "https://github.com/acme/repo",
  gitBranch: "main",
};

describe("ExplorerTree", () => {
  it("shows a failed listing and lists again on Try again", async () => {
    const lister: WorkspaceFileLister = vi
      .fn<WorkspaceFileLister>()
      .mockRejectedValueOnce(new Error("listing exploded"))
      .mockResolvedValue([{ path: "a.ts", isDirectory: false }]);

    render(
      <ExplorerTree
        entries={[ENTRY]}
        lister={lister}
        selectedFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the files.");
    expect(alert.textContent).toContain("listing exploded");

    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByText("a.ts")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(lister).toHaveBeenCalledTimes(2);
  });
});
