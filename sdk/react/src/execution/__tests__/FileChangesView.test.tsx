import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
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
    expect(screen.getByText("src/a.ts")).toBeTruthy();
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
    expect(screen.getByText("src/only.ts")).toBeTruthy();
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
});
