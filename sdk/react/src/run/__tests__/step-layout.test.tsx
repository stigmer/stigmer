// Proves a step reads as the session page draws it (S33 to S38, S45, S55):
// one grid whose opened body sits under the step's words, never under its
// mark, with the toggle over the line alone; every kind's contents in the
// one quiet box; the second line each kind's drawing names ("+2 −2 ·
// src/billing", "2 matches in 2 files", "src/billing · 88 lines", a command
// at the foreground, a connected app's quoted argument and short answer);
// "Created" and "new file" for a write its turn's review says made the file;
// "Open the whole file" only where the session says the path opens; a File
// the turn wrote opening itself; a failed edit saying why in a sentence and
// opening to what it tried; a command's exit once, after its words, and its
// last lines with how many it printed; a list of words as one line; and an
// edit's diff with each removal beside its replacement, unnumbered.

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { ToolUse } from "@stigmer/client";
import type { Stigmer } from "@stigmer/client";
import { FileReviewContext, StigmerContext } from "@stigmer/react-core";
import { ToolCallItem } from "../ToolCallItem";
import { FilePathContext } from "../FilePathContext";
import { OutputFileContext, type OutputFileOpener } from "../OutputFileContext";
import { DiffViewer, pairChanges } from "../../version-history/DiffViewer";
import { BackgroundCommandTrail } from "../BackgroundCommandStatus";
import { ToolCallDetail } from "../ToolCallDetail";
import { computeDiff } from "@stigmer/react-core";
import { reviewFile, reviewSet, toolUse } from "./__fixtures__/fold-values";

afterEach(cleanup);

function row(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[data-cursor-target="tool-call-row"]')!;
}
function toggle(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-cursor-target="thread-card-toggle"]');
}
function open(container: HTMLElement): HTMLElement {
  fireEvent.click(toggle(container)!);
  return container.querySelector<HTMLElement>("[data-step-body]")!;
}
/** The step's second line: the line under its words. */
function secondLine(container: HTMLElement): string {
  return container.querySelector("[data-step-title]")!.nextElementSibling?.textContent ?? "";
}

const grep = () =>
  toolUse({
    name: "grep",
    input: { pattern: "round(", path: "src/billing" },
    result: "src/billing/invoice.ts:41:sum + roundCents(lineTotal(line))\nsrc/billing/credit-note.ts:18:amount: roundCents(line.amount)",
  });

describe("a step's layout", () => {
  it("opens its body under its words, in the grid's second row, with the toggle over the line alone", () => {
    const { container } = render(<ToolCallItem toolUse={grep()} />);
    const body = open(container);
    // The body is the grid's second row in the words' column: it starts where
    // the step's words start and ends before the time (the design facts test
    // measures the pixels on every scene).
    expect(body.className).toContain("stg:row-start-2");
    expect(body.className).toContain("stg:col-start-2");
    expect(body.parentElement).toBe(container.querySelector("[data-step-title]")!.parentElement!.parentElement);
    // The toggle covers the first row only, so the body's text stays selectable.
    expect(toggle(container)!.className).toContain("stg:row-start-1");
    // Its end line named too: an absolutely placed item's `auto` end is the
    // grid's edge, which would lay the toggle over the body.
    expect(toggle(container)!.className).toContain("stg:row-end-2");
    expect(body.contains(toggle(container))).toBe(false);
  });

  it("puts every kind's contents in the one quiet box", () => {
    const kinds: ToolUse[] = [
      grep(),
      toolUse({ name: "read_file", input: { path: "src/billing/credit-note.ts" }, result: "@@ lines 14-17 of 88 @@\na\nb\nc\nd" }),
      toolUse({ name: "ls", input: { path: "src/billing" }, result: "credit-note.ts\ninvoice.ts" }),
      toolUse({ name: "execute", input: { command: "npm test" }, result: "Tests: 12 passed\n[Command succeeded]" }),
      toolUse({ name: "write_file", input: { path: "src/billing/rounding.test.ts", content: "import x;\n" }, result: "ok" }),
    ];
    for (const kind of kinds) {
      const { container, unmount } = render(<ToolCallItem toolUse={kind} />);
      const box = open(container).querySelector(".stg\\:bg-muted-faint");
      expect(box, kind.name).not.toBeNull();
      expect(box!.className, kind.name).toContain("stg:rounded-lg");
      expect(box!.className, kind.name).toContain("stg:border-border-muted");
      expect(box!.className, kind.name).toContain("stg:text-muted-foreground");
      unmount();
    }
  });
});

describe("each kind's lines", () => {
  it("counts a search's matches by file, one line per match named from the folder searched", () => {
    const { container } = render(<ToolCallItem toolUse={grep()} />);
    expect(secondLine(container)).toBe("2 matches in 2 files");
    const body = open(container);
    expect(within(body).getByText("invoice.ts:41")).toBeTruthy();
    expect(within(body).getByText("credit-note.ts:18")).toBeTruthy();
    // The box scrolls sideways, so a keyboard reaches it as a named region.
    expect(within(body).getByRole("region", { name: "Matches" }).tabIndex).toBe(0);
  });

  it("reads a read's folder and length, and the lines it read under the box", () => {
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "read_file", input: { path: "src/billing/credit-note.ts" }, result: "@@ lines 14-17 of 88 @@\na\nb\nc\nd" })} />,
    );
    expect(secondLine(container)).toBe("src/billing · 88 lines");
    expect(within(open(container)).getByText("Lines 14–17 of 88")).toBeTruthy();
  });

  it("offers the whole file only where the session says the path opens", () => {
    const onFilePathClick = vi.fn(() => true);
    const read = toolUse({ name: "read_file", input: { path: "src/billing/credit-note.ts" }, result: "@@ lines 14-17 of 88 @@\na" });
    const opens = render(
      <FilePathContext.Provider value={{ resources: [], onFilePathClick, canOpenFilePath: () => true }}>
        <ToolCallItem toolUse={read} />
      </FilePathContext.Provider>,
    );
    fireEvent.click(within(open(opens.container)).getByRole("button", { name: "Open the whole file" }));
    expect(onFilePathClick).toHaveBeenCalledWith("src/billing/credit-note.ts", expect.anything());
    opens.unmount();

    const declines = render(
      <FilePathContext.Provider value={{ resources: [], onFilePathClick, canOpenFilePath: () => false }}>
        <ToolCallItem toolUse={read} />
      </FilePathContext.Provider>,
    );
    expect(within(open(declines.container)).queryByRole("button", { name: "Open the whole file" })).toBeNull();
  });

  it("says Created and new file for a write its turn's review says made the file, and Wrote without a review", () => {
    const write = toolUse({ name: "write_file", input: { path: "/workspace/src/billing/rounding.test.ts", content: "a\nb\n" }, result: "ok" });
    const set = reviewSet({ files: [reviewFile({ path: "src/billing/rounding.test.ts", change: "added" })] });
    const reviewed = render(
      <FileReviewContext.Provider value={{ fileReviewByRunId: new Map([["run_1", [set]]]), changeSetsById: new Map() }}>
        <ToolCallItem toolUse={write} />
      </FileReviewContext.Provider>,
    );
    expect(row(reviewed.container).textContent).toContain("Created");
    // No "−0" on a whole-file write (the session page, S45).
    expect(secondLine(reviewed.container)).toBe("+2 · /workspace/src/billing · new file");
    reviewed.unmount();

    const plain = render(<ToolCallItem toolUse={write} />);
    expect(row(plain.container).textContent).toContain("Wrote");
    expect(secondLine(plain.container)).not.toContain("new file");
  });

  it("opens a File the turn wrote, saying where it opens, with no chevron", () => {
    const openOutputPath = vi.fn(() => true);
    const opener: OutputFileOpener = { opensIn: "panel", hasOutputPath: () => true, openOutputPath };
    const write = toolUse({ name: "write_file", input: { path: "/workspace/.stigmer/outputs/audit.md", content: "# Audit\n" }, result: "ok" });
    const { container } = render(
      <OutputFileContext.Provider value={opener}>
        <ToolCallItem toolUse={write} />
      </OutputFileContext.Provider>,
    );
    expect(secondLine(container)).toBe("Markdown · 0.1 KB · opens in the panel");
    const line = screen.getByRole("button", { name: "Open audit.md" });
    expect(line.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(line);
    expect(openOutputPath).toHaveBeenCalledWith("/workspace/.stigmer/outputs/audit.md");
  });

  it("says why an edit failed in a sentence, from its first line only, and opens to what it tried", () => {
    const failed = toolUse({
      name: "edit_file",
      input: { path: "src/billing/invoice.ts", old_string: "roundCents(", new_string: "roundHalfEven(" },
      isError: true,
      result: "Error: String not found in file: 'roundCents('\n\nRead the file again before you edit it.",
    });
    const { container } = render(<ToolCallItem toolUse={failed} />);
    expect(row(container).textContent).toContain("Couldn't edit");
    expect(secondLine(container)).toBe("The text to replace wasn't in the file, so nothing changed.");
    expect(row(container).textContent).not.toContain("Read the file again");
    expect(container.querySelector(".stg\\:text-status-failed")).not.toBeNull();
    const body = open(container);
    expect(body.querySelector('[data-cursor-target="file-diff"]')).not.toBeNull();
    expect(body.textContent).toContain("roundHalfEven(");
  });

  it("says a failed command's exit once, after its words, and shows its last lines with how many it printed", () => {
    const output = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    const { container } = render(
      <ToolCallItem toolUse={toolUse({ name: "execute", input: { command: "npm test -- billing" }, result: `${output}\n[Command failed with exit code 1]` })} />,
    );
    expect(screen.getAllByText("exit 1")).toHaveLength(1);
    // The command on the line under the words, at the foreground.
    expect(screen.getByText("npm test -- billing").className).toContain("stg:text-foreground");
    const body = container.querySelector<HTMLElement>("[data-step-body]")!;
    expect(within(body).getByRole("region", { name: "Command output" }).textContent).toBe("line 8\nline 9\nline 10\nline 11\nline 12");
    expect(within(body).getByText("Last 5 of 12 lines")).toBeTruthy();
    fireEvent.click(within(body).getByRole("button", { name: "Show all" }));
    expect(body.querySelector("pre")!.textContent).toBe(output);
  });

  it("names a connected app's tool with the app's mark after it, its quoted argument and short answer under it", () => {
    const { container } = render(
      <ToolCallItem
        toolUse={toolUse({
          name: "create_issue",
          mcpServerName: "issue-tracker",
          input: { title: "Credit notes round per line", labels: ["bug", "rounding"] },
          result: "Created BILL-219",
        })}
      />,
    );
    expect(within(container.querySelector<HTMLElement>("[data-step-title]")!).getByText("issue-tracker")).toBeTruthy();
    expect(secondLine(container)).toBe("“Credit notes round per line” · Created BILL-219");
    // A list of words reads as one line in the fields box.
    expect(within(open(container)).getByText("bug, rounding")).toBeTruthy();
  });
});

describe("a step's diff", () => {
  it("sets each removed line beside its replacement, unnumbered, and leaves version history's order alone", () => {
    const hunks = computeDiff("a\nb\n", "A\nB\n");
    const paired = pairChanges(hunks[0]!.lines).map((line) => `${line.type === "added" ? "+" : "-"}${line.content}`);
    expect(paired).toEqual(["-a", "+A", "-b", "+B"]);

    const { container, unmount } = render(<DiffViewer hunks={hunks} lineNumbers={false} paired />);
    expect(container.querySelectorAll("tbody tr")[0]!.children).toHaveLength(2);
    unmount();
    const history = render(<DiffViewer hunks={hunks} />);
    expect(history.container.querySelectorAll("tbody tr")[0]!.children).toHaveLength(3);
  });
});

describe("the box's edges", () => {
  it("names a search's files from the folder however the folder was written, and says an empty listing", () => {
    const slashed = render(
      <ToolCallDetail toolUse={toolUse({ name: "grep", input: { pattern: "x", path: "./src/billing//" }, result: "src/billing/a.ts:4:x\nsrc/billing/b.ts:9:x" })} />,
    );
    expect(within(slashed.container).getByText("a.ts:4")).toBeTruthy();
    slashed.unmount();
    const empty = render(<ToolCallDetail toolUse={toolUse({ name: "ls", input: { path: "src/empty" }, result: "" })} />);
    expect(within(empty.container).getByText("Empty")).toBeTruthy();
  });

  it("opens an edit that changed nothing to nothing, and an answer with no words of its own as its own view", () => {
    const same = render(<ToolCallDetail toolUse={toolUse({ name: "edit_file", input: { path: "a.ts", old_string: "x", new_string: "x" }, result: "ok" })} />);
    expect(same.container.querySelector('[data-cursor-target="file-diff"]')).toBeNull();
    same.unmount();
    // An offloaded output reads through the run's storage, so the kit's provider is there.
    const stigmer = { run: { getArtifactContent: vi.fn(), getArtifactDownloadUrl: vi.fn() } } as unknown as Stigmer;
    const offloaded = render(
      <StigmerContext.Provider value={stigmer}>
        <ToolCallDetail toolUse={toolUse({ name: "execute", input: { command: "cat big.log" }, result: "head", fullOutput: { storageKey: "runs/run_1/out.txt", isImage: false } })} />
      </StigmerContext.Provider>,
    );
    expect(offloaded.container.textContent).toContain("View full output");
  });
});

describe("BackgroundCommandTrail", () => {
  it("draws a background command's status words and nothing for any other call", () => {
    const started = toolUse({ name: "execute", input: { command: "npm run dev", background: true }, result: "Started" });
    const background = { ...started, background: { state: "running", startedAt: started.processedAt, liveOutput: "", output: "", exitCode: undefined, stopRequested: false } } as unknown as ToolUse;
    const { container, unmount } = render(<BackgroundCommandTrail toolUse={background} />);
    expect(container.querySelector('[data-cursor-target="background-command-status"]')).not.toBeNull();
    unmount();
    expect(render(<BackgroundCommandTrail toolUse={started} />).container.textContent).toBe("");
  });
});
