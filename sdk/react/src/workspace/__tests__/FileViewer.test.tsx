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
import {
  WorkspaceFileNotFoundError,
  type WorkspaceFileContent,
  type WorkspaceFileReader,
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

  // ---------------------------------------------------------------------
  // Image arm (stigmer/stigmer#379) — bytes delivered whole by the reader
  // render as a picture; every gate failure falls back to the binary notice.
  // ---------------------------------------------------------------------

  const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

  function imageContent(): WorkspaceFileContent {
    return {
      text: null,
      isBinary: true,
      size: PNG_BYTES.length,
      encoding: "base64",
      bytes: PNG_BYTES,
    };
  }

  it("renders an image from delivered bytes instead of the binary notice", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "assets/logo.png" }}
        entries={ENTRIES}
        reader={readerFor(imageContent())}
      />,
    );

    await waitFor(() => {
      const img = document.querySelector("img");
      expect(img).toBeTruthy();
      expect(img!.getAttribute("src")).toContain("blob:");
      expect(img!.getAttribute("alt")).toBe("logo.png");
    });
    expect(screen.queryByText(/Binary file/i)).toBeNull();
    // The click-to-open affordance is present and named.
    expect(
      screen.getByRole("button", { name: "Preview logo.png at full size" }),
    ).toBeTruthy();
  });

  it("opens the shared lightbox at full size when the image is clicked", async () => {
    // happy-dom does not implement the native dialog show/close methods.
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function close() {
      this.open = false;
    };

    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "assets/logo.png" }}
        entries={ENTRIES}
        reader={readerFor(imageContent())}
      />,
    );

    await waitFor(() => expect(document.querySelector("img")).toBeTruthy());
    fireEvent.click(
      screen.getByRole("button", { name: "Preview logo.png at full size" }),
    );

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview logo.png");
  });

  it("keeps the binary notice when bytes arrive for a non-image path", async () => {
    // The viewer re-derives the MIME gate from the path: bytes on something
    // without a recognized image extension never render as a picture.
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "data.bin" }}
        entries={ENTRIES}
        reader={readerFor(imageContent())}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Binary file/i)).toBeTruthy());
    expect(document.querySelector("img")).toBeNull();
  });

  it("degrades to the binary notice when the browser cannot decode the bytes", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "assets/logo.png" }}
        entries={ENTRIES}
        reader={readerFor(imageContent())}
      />,
    );

    await waitFor(() => expect(document.querySelector("img")).toBeTruthy());
    fireEvent.error(document.querySelector("img")!);

    // Never a broken-image glyph — the honest binary state instead.
    await waitFor(() => expect(screen.getByText(/Binary file/i)).toBeTruthy());
    expect(document.querySelector("img")).toBeNull();
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

  it("moves focus with selection when roving Diff|File", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
      />,
    );

    const diffRadio = screen.getByRole("radio", { name: "Diff" });
    diffRadio.focus();
    fireEvent.keyDown(diffRadio, { key: "ArrowRight" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "File" })),
    );
  });
});

// ---------------------------------------------------------------------------
// Not-found fallback — captured content when the live substrate lacks the file
// ---------------------------------------------------------------------------

describe("FileViewer — not-found and captured-content fallback", () => {
  function notFoundReader(): WorkspaceFileReader {
    return vi.fn(async (_e, path: string) => {
      throw new WorkspaceFileNotFoundError(path);
    });
  }

  it("falls back to the captured after-content when the file isn't at the ref", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={notFoundReader()}
        change={wholeFileChange("notes.md")}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "File" }));

    // The captured after side ("beta") renders with the provenance caption —
    // not an error, not the live caption.
    await waitFor(() =>
      expect(screen.getByText(/As of the agent.s last change/i)).toBeTruthy(),
    );
    expect(screen.getByText("beta")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
    expect(screen.queryByText(/Live — may differ/i)).toBeNull();
  });

  it("falls back to captured content when the substrate is unsupported (reader resolves null)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={readerFor(null)}
        change={wholeFileChange("notes.md")}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "File" }));

    await waitFor(() =>
      expect(screen.getByText(/As of the agent.s last change/i)).toBeTruthy(),
    );
    expect(screen.getByText("beta")).toBeTruthy();
  });

  it("shows the calm not-found state (no error styling) when nothing is captured", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={notFoundReader()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByText(/isn.t available in the workspace source yet/i)).toBeTruthy(),
    );
    // A calm notice, not a failure: retry is offered as "Check again".
    expect(screen.getByText("Check again")).toBeTruthy();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("Check again re-reads and renders content once the file lands at the ref", async () => {
    let attempt = 0;
    const reader: WorkspaceFileReader = vi.fn(async (_e, path: string) => {
      attempt += 1;
      if (attempt === 1) throw new WorkspaceFileNotFoundError(path);
      return text("now it exists");
    });
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={reader}
      />,
    );

    await waitFor(() => expect(screen.getByText("Check again")).toBeTruthy());
    fireEvent.click(screen.getByText("Check again"));

    await waitFor(() => expect(screen.getByText("now it exists")).toBeTruthy());
  });

  it("keeps the not-found state calm for a HUNK_ONLY change (no whole-file capture to serve)", async () => {
    const hunkOnly = create(FileChangeSchema, {
      path: "notes.md",
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
      unifiedDiff: "@@ -1 +1 @@\n-alpha\n+beta\n",
    });
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={notFoundReader()}
        change={hunkOnly}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "File" }));

    await waitFor(() =>
      expect(screen.getByText(/isn.t available in the workspace source yet/i)).toBeTruthy(),
    );
    expect(screen.queryByText(/As of the agent.s last change/i)).toBeNull();
  });

  it("a generic reader error still shows the error state with Retry, never the fallback", async () => {
    const reader: WorkspaceFileReader = vi.fn(async () => {
      throw new Error("rate limited (HTTP 429)");
    });
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "notes.md" }}
        entries={ENTRIES}
        reader={reader}
        change={wholeFileChange("notes.md")}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "File" }));

    await waitFor(() => expect(screen.getByText(/rate limited/i)).toBeTruthy());
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText(/As of the agent.s last change/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reveal (jump-to-line) — a line target opens File view and scrolls to it
// ---------------------------------------------------------------------------

describe("FileViewer — reveal (jump-to-line)", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView =
      scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
  });

  it("opens a changed file in the live File view when a reveal is present (DR-1)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
        reveal={{ line: 1, nonce: 1 }}
      />,
    );

    // File view wins over the diff-default, but the Diff toggle stays available.
    expect(screen.getByRole("radio", { name: "File" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Diff" })).toBeTruthy();
    await waitFor(() => expect(screen.getByText("live content")).toBeTruthy());
  });

  it("highlights the revealed line and scrolls to it", async () => {
    const { container } = render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("one\ntwo\nthree"))}
        reveal={{ line: 2, nonce: 1 }}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-line="2"]')).not.toBeNull());
    expect(container.querySelector('[data-line="2"]')?.className).toContain(
      "bg-primary-subtle",
    );
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("re-forces the File view when a new reveal nonce arrives after a manual toggle", async () => {
    const { rerender } = render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
        reveal={{ line: 1, nonce: 1 }}
      />,
    );
    // User flips to Diff.
    fireEvent.click(screen.getByRole("radio", { name: "Diff" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Diff" }).getAttribute("aria-checked")).toBe("true"),
    );

    // A second search hit in the same (already-mounted) file bumps the nonce.
    rerender(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/a.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("live content"))}
        change={wholeFileChange("src/a.ts")}
        reveal={{ line: 1, nonce: 2 }}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "File" }).getAttribute("aria-checked")).toBe("true"),
    );
  });

  it("is a no-op for a DELETE change (no live bytes to anchor)", async () => {
    render(
      <FileViewer
        selectedFile={{ entryId: "e1", path: "src/gone.ts" }}
        entries={ENTRIES}
        reader={readerFor(text("unused"))}
        change={deleteChange("src/gone.ts")}
        reveal={{ line: 1, nonce: 1 }}
      />,
    );
    // Falls back to the diff (deleted side); no view toggle, no crash.
    await waitFor(() => expect(screen.getByText("alpha")).toBeTruthy());
    expect(screen.queryByRole("radiogroup", { name: "File view" })).toBeNull();
  });
});
