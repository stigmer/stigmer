import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSchema,
  FileContentSchema,
  type FileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeCaptureLevel,
  FileChangeType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { UseFileChangeContentReturn } from "../../execution/useFileChangeContent";

// Drive FileChangeDiff's content deterministically (it is rendered by the diff
// pane) — same seam FileChangesView's own tests mock.
let mockFileChangeContent: UseFileChangeContentReturn;
vi.mock("../../execution/useFileChangeContent", () => ({
  useFileChangeContent: () => mockFileChangeContent,
}));

const { FileViewer } = await import("../FileViewer");

afterEach(cleanup);
beforeEach(() => {
  mockFileChangeContent = {
    beforeText: "alpha\n",
    afterText: "beta\n",
    isBinary: false,
    isLoading: false,
    error: null,
    isTruncated: false,
    downloadUrl: null,
  };
});
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type {
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "../WorkspaceFileReader";

function wholeFileChange(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: create(FileContentSchema, { body: { case: "inline", value: "alpha\n" } }),
    after: create(FileContentSchema, { body: { case: "inline", value: "beta\n" } }),
  });
}

function deleteChange(path: string): FileChange {
  return create(FileChangeSchema, {
    path,
    changeType: FileChangeType.DELETE,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: create(FileContentSchema, { body: { case: "inline", value: "alpha\n" } }),
  });
}

function gitEntry(id = "e1"): WorkspaceEntry {
  return {
    id,
    name: "acme/repo",
    type: "git",
    gitUrl: "https://github.com/acme/repo",
    gitBranch: "main",
  };
}

const ENTRIES = [gitEntry()];

function readerFor(result: WorkspaceFileContent | null): WorkspaceFileReader {
  return vi.fn(async () => result);
}

function text(t: string): WorkspaceFileContent {
  return { text: t, isBinary: false, size: t.length, encoding: "utf-8" };
}

describe("FileViewer", () => {
  it("shows the unsupported state when no reader is injected", () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={undefined}
      />,
    );
    expect(screen.getByText(/Preview isn.t available/i)).toBeTruthy();
  });

  it("shows a loading skeleton while the read is in flight", () => {
    const reader: WorkspaceFileReader = () => new Promise(() => {});
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={reader}
      />,
    );
    expect(screen.getByLabelText("Loading file")).toBeTruthy();
  });

  it("renders displayable text via the shared renderer", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("const answer = 42;"))}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText("const answer = 42;")).toBeTruthy(),
    );
  });

  it("shows the binary state for binary content", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "logo.png" }}
        entries={ENTRIES}
        reader={readerFor({ text: null, isBinary: true, size: 2048, encoding: "unknown" })}
      />,
    );
    await waitFor(() => expect(screen.getByText(/Binary file/i)).toBeTruthy());
  });

  it("shows the too-large state for a size-capped read with no text", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "big.log" }}
        entries={ENTRIES}
        reader={readerFor({
          text: null,
          isBinary: false,
          size: 20 * 1024 * 1024,
          encoding: "none",
          truncated: true,
        })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/too large to preview/i)).toBeTruthy(),
    );
  });

  it("shows the undecodable state when text is null without truncation or binary", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "weird.dat" }}
        entries={ENTRIES}
        reader={readerFor({ text: null, isBinary: false, size: 5, encoding: "unknown" })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/can.t be displayed as text/i)).toBeTruthy(),
    );
  });

  it("shows the error state with a working Retry", async () => {
    let attempt = 0;
    const reader: WorkspaceFileReader = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("network down");
      return text("recovered");
    });
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={reader}
      />,
    );

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());

    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => expect(screen.getByText("recovered")).toBeTruthy());
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state when the owning entry has been removed", () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "gone", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("x"))}
      />,
    );
    expect(screen.getByText(/no longer in the workspace/i)).toBeTruthy();
  });

  it("renders the basename and directory in the header", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/deep/module.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("ok"))}
      />,
    );
    expect(screen.getByText("module.ts")).toBeTruthy();
    expect(screen.getByText("src/deep")).toBeTruthy();
  });

  it("invokes onClose from the close button", async () => {
    const onClose = vi.fn();
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("ok"))}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByLabelText("Close file viewer"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // --- no `change` prop: unchanged browse-only behavior (regression) --------

  it("shows no view toggle when no change is provided", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("plain content"))}
      />,
    );
    await waitFor(() => expect(screen.getByText("plain content")).toBeTruthy());
    expect(screen.queryByRole("radiogroup", { name: "File view" })).toBeNull();
    expect(screen.queryByText(/Live — may differ/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Diff mode (Slice 4) — a changed file defaults to its authoritative diff
// ---------------------------------------------------------------------------

describe("FileViewer — diff mode", () => {
  it("defaults a changed file to the Diff view", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "File view" });
    const diffRadio = screen.getByRole("radio", { name: "Diff" });
    expect(diffRadio.getAttribute("aria-checked")).toBe("true");
    expect(group).toBeTruthy();
    // The diff (added side) renders; the live file body does not.
    await waitFor(() => expect(screen.getByText("beta")).toBeTruthy());
    expect(screen.queryByText("live content")).toBeNull();
    // Refresh is meaningless for an immutable captured diff.
    expect(screen.queryByLabelText("Reload a.ts")).toBeNull();
  });

  it("toggles to the live File view, showing the live caption and content", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "File" }));

    await waitFor(() => expect(screen.getByText("live content")).toBeTruthy());
    expect(screen.getByText(/Live — may differ from the reviewed change/i)).toBeTruthy();
    expect(screen.getByRole("radio", { name: "File" }).getAttribute("aria-checked")).toBe("true");
    // Refresh returns in the live view.
    expect(screen.getByLabelText("Reload a.ts")).toBeTruthy();
  });

  it("omits the File option when no reader supports the substrate (diff only)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={undefined}
        change={wholeFileChange("src/a.ts")}
      />,
    );
    await waitFor(() => expect(screen.getByText("beta")).toBeTruthy());
    expect(screen.queryByRole("radiogroup", { name: "File view" })).toBeNull();
  });

  it("omits the File option for a DELETE change (no current bytes)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/gone.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("should not be reachable"))}
        change={deleteChange("src/gone.ts")}
      />,
    );
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    expect(screen.queryByRole("radiogroup", { name: "File view" })).toBeNull();
  });

  it("supports arrow-key roving between Diff and File (radiogroup a11y)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
      />,
    );

    const diffRadio = screen.getByRole("radio", { name: "Diff" });
    fireEvent.keyDown(diffRadio, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "File" }).getAttribute("aria-checked")).toBe("true"),
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: "File" }), { key: "ArrowLeft" });
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Diff" }).getAttribute("aria-checked")).toBe("true"),
    );
  });
});
