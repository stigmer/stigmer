import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { FileViewer } from "../FileViewer";

afterEach(cleanup);
import type { WorkspaceEntry } from "../useWorkspaceEntries";
import type {
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "../WorkspaceFileReader";

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
});
