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

// ---------------------------------------------------------------------------
// FileChangeDiff
// ---------------------------------------------------------------------------

describe("FileChangeDiff", () => {
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

  it("renders a hunk-only unified diff with authoritative counts", () => {
    render(<FileChangeDiff change={hunkChange("src/h.ts")} />);
    expect(screen.getByText("+beta")).toBeTruthy();
    expect(screen.getByText("-alpha")).toBeTruthy();
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
