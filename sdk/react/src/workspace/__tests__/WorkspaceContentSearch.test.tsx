import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { WorkspaceContentSearch } from "../WorkspaceContentSearch";
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type {
  WorkspaceContentMatch,
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
} from "../WorkspaceContentSearcher";

let entryIdCounter = 0;

function makeEntry(overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    id: `ws-${++entryIdCounter}`,
    name: "acme/api",
    type: "local",
    localPath: "/repo",
    ...overrides,
  };
}

function match(path: string, line: number, preview: string): WorkspaceContentMatch {
  return { path, line, preview };
}

function ok(
  matches: WorkspaceContentMatch[],
  truncated = false,
): WorkspaceContentSearchResult {
  return { matches, truncated };
}

function searcherReturning(result: WorkspaceContentSearchResult): WorkspaceContentSearcher {
  return vi.fn(async () => result);
}

function typeQuery(value: string) {
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value } });
  return input;
}

afterEach(cleanup);

describe("WorkspaceContentSearch", () => {
  it("shows an unavailable state and disables input when no searcher is injected", () => {
    render(
      <WorkspaceContentSearch entries={[makeEntry()]} searcher={undefined} onOpenFile={vi.fn()} />,
    );
    expect(screen.getByText(/text search isn.t available here/i)).toBeTruthy();
    expect(screen.getByRole("combobox")).toHaveProperty("disabled", true);
  });

  it("shows a hint when the query is empty", () => {
    render(
      <WorkspaceContentSearch
        entries={[makeEntry()]}
        searcher={searcherReturning(ok([]))}
        onOpenFile={vi.fn()}
      />,
    );
    expect(screen.getByText(/search file contents across the whole workspace/i)).toBeTruthy();
  });

  it("shows a min-length hint below the threshold and does not search", () => {
    const searcher = searcherReturning(ok([match("a.ts", 1, "x")]));
    render(
      <WorkspaceContentSearch entries={[makeEntry()]} searcher={searcher} onOpenFile={vi.fn()} />,
    );
    typeQuery("a");
    expect(screen.getByText(/type at least 2 characters/i)).toBeTruthy();
    expect(searcher).not.toHaveBeenCalled();
  });

  it("renders a file header with line rows and opens the file on click (single entry)", async () => {
    const entry = makeEntry();
    const onOpenFile = vi.fn();
    render(
      <WorkspaceContentSearch
        entries={[entry]}
        searcher={searcherReturning(
          ok([match("src/app.ts", 3, "const foo = 1"), match("src/app.ts", 7, "return foo")]),
        )}
        onOpenFile={onOpenFile}
      />,
    );

    typeQuery("foo");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    // File header (basename) present; single entry → no entry header.
    expect(screen.getByText("app.ts")).toBeTruthy();
    expect(screen.queryByText("acme/api")).toBeNull();

    // Clicking a line hit opens via the shared onOpenFile seam (the same path a
    // tree/filename click uses — this is what makes a changed file honor the
    // FileViewer diff-default; see FileViewer diff-mode suite).
    fireEvent.click(within(options[0]).getByRole("button"));
    expect(onOpenFile).toHaveBeenCalledWith(entry.id, "src/app.ts");
  });

  it("shows an entry header when more than one entry has hits", async () => {
    const a = makeEntry({ name: "acme/api" });
    const b = makeEntry({ name: "acme/web" });
    const searcher: WorkspaceContentSearcher = vi.fn(async (e) =>
      e.id === a.id ? ok([match("a.ts", 1, "foo")]) : ok([match("b.ts", 2, "foo")]),
    );
    render(<WorkspaceContentSearch entries={[a, b]} searcher={searcher} onOpenFile={vi.fn()} />);

    typeQuery("foo");
    await screen.findAllByRole("option");
    expect(screen.getByText("acme/api")).toBeTruthy();
    expect(screen.getByText("acme/web")).toBeTruthy();
  });

  it("highlights every occurrence of the query in the preview", async () => {
    const { container } = render(
      <WorkspaceContentSearch
        entries={[makeEntry()]}
        searcher={searcherReturning(ok([match("a.ts", 1, "foo and foo")]))}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("foo");
    await screen.findByRole("option");
    const highlights = container.querySelectorAll(".font-semibold");
    expect(Array.from(highlights).map((el) => el.textContent)).toEqual(["foo", "foo"]);
  });

  it("shows a no-match state", async () => {
    render(
      <WorkspaceContentSearch
        entries={[makeEntry()]}
        searcher={searcherReturning(ok([]))}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("zzz");
    expect(await screen.findByText(/no files containing/i)).toBeTruthy();
  });

  it("moves virtual focus with ArrowDown and opens on Enter", async () => {
    const entry = makeEntry();
    const onOpenFile = vi.fn();
    render(
      <WorkspaceContentSearch
        entries={[entry]}
        searcher={searcherReturning(
          ok([match("a.ts", 1, "foo"), match("a.ts", 2, "foo")]),
        )}
        onOpenFile={onOpenFile}
      />,
    );

    const input = typeQuery("foo");
    await screen.findAllByRole("option");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const active = input.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onOpenFile).toHaveBeenCalledWith(entry.id, "a.ts");
  });

  it("caps rendered rows and reports the total", async () => {
    const many = Array.from({ length: 250 }, (_, i) => match("a.ts", i + 1, "foo"));
    render(
      <WorkspaceContentSearch
        entries={[makeEntry()]}
        searcher={searcherReturning(ok(many))}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("foo");
    await screen.findAllByRole("option");
    expect(screen.getAllByRole("option")).toHaveLength(200);
    expect(screen.getByText(/showing the first 200 of 250 matches/i)).toBeTruthy();
  });

  it("renders a truncation notice when a search was capped", async () => {
    render(
      <WorkspaceContentSearch
        entries={[makeEntry()]}
        searcher={searcherReturning(ok([match("a.ts", 1, "foo")], true))}
        onOpenFile={vi.fn()}
      />,
    );
    typeQuery("foo");
    await screen.findByRole("option");
    expect(screen.getByText(/more matches exist than shown/i)).toBeTruthy();
  });
});
