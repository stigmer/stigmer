import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  FileContentSchema,
  type FileChange,
  type FileContent,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseFileChangeContentReturn } from "../useFileChangeContent";

// ---------------------------------------------------------------------------
// Mock the content resolver so we can drive every render state.
// ---------------------------------------------------------------------------

let mockReturn: UseFileChangeContentReturn;

vi.mock("../useFileChangeContent", () => ({
  useFileChangeContent: () => mockReturn,
}));

const { FileChangesView, FileChangeDiff } = await import("../FileChangesView");

function setContent(overrides?: Partial<UseFileChangeContentReturn>) {
  mockReturn = {
    beforeText: "",
    afterText: "",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
    ...overrides,
  };
}

beforeEach(() => setContent());
afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function inlineSide(value: string): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function wholeFile(path: string, before: string, after: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: inlineSide(before),
    after: inlineSide(after),
  });
}

function hunkChange(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: "@@ -1 +1 @@\n-alpha\n+beta",
    linesAdded: 1,
    linesRemoved: 1,
  });
}

/** A whole-file CREATE with no content — a genuinely empty new file. */
function emptyCreate(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.CREATE,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
  });
}

/** A whole-file MODIFY that resolves to no change — a contentless edit. */
function emptyModify(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
  });
}

/** A hunk-only CREATE whose diff never materialized (no unifiedDiff). */
function emptyHunkCreate(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.CREATE,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
  });
}

// ---------------------------------------------------------------------------
// FileChangeDiff
// ---------------------------------------------------------------------------

describe("FileChangeDiff", () => {
  it("renders the diff full (unbounded) by default — the dedicated Changes view", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    const { container } = render(
      <FileChangeDiff change={wholeFile("src/full.ts", "alpha\n", "beta\n")} />,
    );
    // No shared preview clamp: the Changes review surface shows the whole diff.
    expect(container.querySelector(".stg\\:overflow-hidden.stg\\:max-h-48")).toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  it("bounds the diff to the shared preview budget when `bounded` is set (the approval gate)", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    const { container } = render(
      <FileChangeDiff change={wholeFile("src/bound.ts", "alpha\n", "beta\n")} bounded />,
    );
    // Opt-in clamp wraps the diff body via the shared BoundedContent primitive.
    const clamp = container.querySelector(".stg\\:overflow-hidden.stg\\:max-h-48");
    expect(clamp).not.toBeNull();
    expect(clamp!.querySelector("table")).not.toBeNull();
  });

  it("renders a whole-file diff from resolved before/after text", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    render(<FileChangeDiff change={wholeFile("src/a.ts", "alpha\n", "beta\n")} />);
    // Filename-first: the base name is its own node; the dimmed dir is separate.
    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("src/")).toBeTruthy();
    // computeDiff over the resolved text drives the +/- header stats.
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("renders a hunk-only unified diff through the DiffViewer table (no raw preamble)", () => {
    const { container } = render(<FileChangeDiff change={hunkChange("src/h.ts")} />);
    // The hunk-only patch is parsed into the accessible table, not dumped raw:
    // the +/- prefixes live in a gutter cell, so the content cells hold the
    // bare line text.
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.getByText("alpha")).toBeTruthy();
    // No raw unified-diff preamble or marker leaks into the content.
    expect(container.textContent).not.toContain("@@");
    // The authoritative counts still render in the header stats.
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("shows a binary notice when a side is binary", () => {
    setContent({ isBinary: true });
    render(<FileChangeDiff change={wholeFile("src/img.png", "", "")} />);
    expect(screen.getByText(/binary file changed/i)).toBeTruthy();
  });

  it("shows a loading state while an offloaded side is fetched", () => {
    setContent({ beforeText: null, afterText: null, isLoading: true });
    render(<FileChangeDiff change={wholeFile("src/big.ts", "", "")} />);
    expect(screen.getByText(/loading diff/i)).toBeTruthy();
  });

  it("shows an error state when content fails to load", () => {
    setContent({ beforeText: null, afterText: null, error: new Error("nope") });
    render(<FileChangeDiff change={wholeFile("src/x.ts", "", "")} />);
    expect(screen.getByText(/could not load/i)).toBeTruthy();
  });

  it("offers a download link when an offloaded side is truncated", () => {
    setContent({
      beforeText: null,
      afterText: null,
      isTruncated: true,
      downloadUrl: "https://dl/full",
    });
    render(<FileChangeDiff change={wholeFile("src/huge.ts", "", "")} />);
    const link = screen.getByRole("link", { name: /download the full file/i });
    expect(link.getAttribute("href")).toBe("https://dl/full");
  });

  it("suppresses the filename header when showFileName is false but keeps the stats", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    render(
      <FileChangeDiff
        change={wholeFile("src/a.ts", "alpha\n", "beta\n")}
        showFileName={false}
      />,
    );
    // Neither the base name nor the dimmed directory renders.
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("src/")).toBeNull();
    // The +/- stats still render.
    expect(screen.getByText("+1")).toBeTruthy();
    expect(screen.getByText("-1")).toBeTruthy();
  });

  it("suppresses the +/- stats when showStats is false (owning row shows them)", () => {
    setContent({ beforeText: "alpha\n", afterText: "beta\n" });
    render(
      <FileChangeDiff
        change={wholeFile("src/a.ts", "alpha\n", "beta\n")}
        showFileName={false}
        showStats={false}
      />,
    );
    // Neither the name nor the duplicate counts render; the diff body remains.
    expect(screen.queryByText("a.ts")).toBeNull();
    expect(screen.queryByText("+1")).toBeNull();
    expect(screen.queryByText("-1")).toBeNull();
  });

  it("shows 'New empty file' for an empty whole-file CREATE", () => {
    setContent({ beforeText: "", afterText: "" });
    render(<FileChangeDiff change={emptyCreate("src/new.md")} />);
    expect(screen.getByText("New empty file")).toBeTruthy();
  });

  it("shows 'New empty file' for an empty hunk-only CREATE (no diff yet)", () => {
    render(<FileChangeDiff change={emptyHunkCreate("src/e.ts")} />);
    expect(screen.getByText("New empty file")).toBeTruthy();
  });

  it("shows a neutral 'no preview' notice for a contentless MODIFY", () => {
    setContent({ beforeText: "", afterText: "" });
    render(<FileChangeDiff change={emptyModify("src/x.ts")} />);
    expect(screen.getByText("No preview available for this change")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// FileChangesView
// ---------------------------------------------------------------------------

describe("FileChangesView", () => {
  it("renders nothing when there are no changes", () => {
    const { container } = render(<FileChangesView changes={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders a summary and the sole file's diff for a single change", () => {
    setContent({ beforeText: "a\n", afterText: "b\n" });
    render(<FileChangesView changes={[wholeFile("src/only.ts", "a\n", "b\n")]} />);
    // Single change: no file list, just the diff header (filename-first).
    expect(screen.getByText("only.ts")).toBeTruthy();
  });

  it("renders a file list when multiple files changed", () => {
    setContent({ beforeText: "a\n", afterText: "b\n" });
    render(
      <FileChangesView
        changes={[
          wholeFile("src/one.ts", "a\n", "b\n"),
          wholeFile("src/two.ts", "a\n", "b\n"),
        ]}
      />,
    );
    // The selected file appears in both the list and the diff header.
    expect(screen.getAllByText("src/one.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("src/two.ts")).toBeTruthy();
  });

  it("swaps the active diff when another file in the list is selected", () => {
    setContent({ beforeText: "a\n", afterText: "b\n" });
    render(
      <FileChangesView
        changes={[
          wholeFile("src/one.ts", "a\n", "b\n"),
          wholeFile("src/two.ts", "a\n", "b\n"),
        ]}
      />,
    );

    // The file selector (DiffFileList) keeps full paths; scope the button
    // queries to its nav so they don't collide with the diff header's
    // filename-first FilePathLink (a button whose aria-label includes the path).
    const list = within(
      screen.getByRole("navigation", { name: "Changed files" }),
    );
    const oneButton = list.getByRole("button", { name: /src\/one\.ts/ });
    const twoButton = list.getByRole("button", { name: /src\/two\.ts/ });

    // The first file is selected by default: aria-current marks the list entry,
    // and the diff header shows that file's name (filename-first).
    expect(oneButton.getAttribute("aria-current")).toBe("true");
    expect(twoButton.getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("one.ts")).toBeTruthy();

    fireEvent.click(twoButton);

    // Selection moves to the second file; the header now shows it instead.
    expect(twoButton.getAttribute("aria-current")).toBe("true");
    expect(oneButton.getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("two.ts")).toBeTruthy();
  });
});
