/**
 * MessageEntry's file row (stigmer/stigmer#372): a person's bubble shows the
 * files given with the turn. With a run, an image is a preview tile whose
 * link is minted from the File and a document a chip that downloads the
 * File under its own name and shows its size; on the pending bubble both
 * are inert; an agent's message never shows them.
 *
 * The File hooks are mocked at the module boundary: these are rendering
 * tests, and the hooks have their own (file/__tests__/useFile.test.tsx).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MessageEntry, type ThreadMessage } from "../MessageEntry";
import type { MessageFileView } from "../MessageFiles";

const downloadSpy = vi.fn(() => Promise.resolve());
let urlState: { url: string | null; error: Error | null } = {
  url: null,
  error: null,
};
let fileRecords: Record<string, { spec: { filename: string }; status: { sizeBytes: bigint } }> = {};

vi.mock("../../file/useFile", () => ({
  useFile: (fileId: string | null) => ({
    file: fileId ? (fileRecords[fileId] ?? null) : null,
    isLoading: false,
    error: null,
  }),
  useFileDownloadUrl: (fileId: string | null) => ({
    url: fileId ? urlState.url : null,
    error: urlState.error,
  }),
  useFileDownload: () => ({
    download: downloadSpy,
    isDownloading: false,
    error: null,
  }),
}));

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  downloadSpy.mockClear();
  urlState = { url: null, error: null };
  fileRecords = {};
});

function humanMessage(text: string): ThreadMessage {
  return { kind: "user", id: "u1", text };
}

const imageFile: MessageFileView = {
  fileId: "file_shot",
  filename: "screenshot.png",
  kind: "image",
};

const documentFile: MessageFileView = {
  fileId: "file_notes",
  filename: "notes.txt",
  kind: "document",
};

describe("MessageEntry file rendering", () => {
  it("renders no file row when the turn has none", () => {
    render(<MessageEntry message={humanMessage("Just text.")} />);

    expect(screen.queryByRole("list", { name: "Files sent with this message" })).toBeNull();
    expect(screen.getByText("Just text.")).toBeTruthy();
  });

  it("renders an image preview chip with the presigned URL and click-to-open lightbox", () => {
    urlState = { url: "https://r2.example/presigned/screenshot", error: null };

    const { container } = render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        files={[imageFile]}
        runId="exec-1"
      />,
    );

    expect(screen.getByRole("list", { name: "Files sent with this message" })).toBeTruthy();
    const img = container.querySelector("img[aria-hidden='true']");
    expect(img?.getAttribute("src")).toBe("https://r2.example/presigned/screenshot");

    // Click-to-open: the shared lightbox mounts with the full image.
    fireEvent.click(screen.getByRole("button", { name: "Preview screenshot.png" }));
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview screenshot.png");
  });

  it("renders no row for an empty file list", () => {
    render(<MessageEntry message={humanMessage("Nothing given.")} files={[]} runId="exec-1" />);

    expect(screen.queryByRole("list", { name: "Files sent with this message" })).toBeNull();
  });

  it("closes the image lightbox", () => {
    urlState = { url: "https://files.example/screenshot", error: null };
    const { container } = render(
      <MessageEntry message={humanMessage("See the screenshot.")} files={[imageFile]} runId="exec-1" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Preview screenshot.png" }));
    expect(container.querySelector("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(container.querySelector("dialog")).toBeNull();
  });

  it("renders a document chip that downloads the File under its filename", () => {
    render(
      <MessageEntry
        message={humanMessage("The notes are attached.")}
        files={[documentFile]}
        runId="exec-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download notes.txt" }));
    expect(downloadSpy).toHaveBeenCalledWith("file_notes", "notes.txt");
  });

  it("renders no visible filename on image tiles — identity lives in the tooltip and accessible label", () => {
    urlState = { url: "https://r2.example/presigned/screenshot", error: null };

    render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        files={[imageFile]}
        runId="exec-1"
      />,
    );

    // The tile is preview-only: no "screenshot.png" text node anywhere…
    expect(screen.queryByText("screenshot.png")).toBeNull();
    // …but the name stays reachable — house tooltip on the tile (native
    // titles are banned), aria on both.
    const tile = screen.getByRole("listitem", { name: "screenshot.png" });
    expect(tile.getAttribute("title")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Preview screenshot.png" }),
    ).toBeTruthy();
  });

  it("pulses the image tile only while the presigned URL is being minted", () => {
    urlState = { url: null, error: null };

    const { container } = render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        files={[imageFile]}
        runId="exec-1"
      />,
    );

    // Mint in flight: pulse placeholder, no image yet.
    expect(container.querySelector(".stg\\:animate-pulse")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders inert chips on the pending bubble (no executionId): no preview, no download", () => {
    const { container } = render(
      <MessageEntry
        message={humanMessage("Sending files…")}
        files={[imageFile, documentFile]}
      />,
    );

    // Both files are present as evidence — the image as a glyph tile
    // (named via aria/tooltip), the document as a filename chip…
    expect(screen.getByRole("list", { name: "Files sent with this message" })).toBeTruthy();
    expect(screen.getByRole("listitem", { name: "screenshot.png" })).toBeTruthy();
    expect(screen.getByText("notes.txt")).toBeTruthy();
    // …but no byte-backed affordances exist yet.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /Preview|Download/ })).toBeNull();
    // The tile is STATIC — a pulse would promise bytes that a failed send
    // (the other no-executionId bubble) never delivers.
    expect(container.querySelector(".stg\\:animate-pulse")).toBeNull();
  });

  it("degrades an image chip to the document treatment when the URL cannot be minted", () => {
    urlState = { url: null, error: new Error("presign failed") };

    const { container } = render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        files={[imageFile]}
        runId="exec-1"
      />,
    );

    // Never a broken-image glyph — the file stays reachable via download.
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download screenshot.png" }),
    ).toBeTruthy();
  });

  it("reads a recorded turn's name and size from the File itself", () => {
    fileRecords = { file_data: { spec: { filename: "data.bin" }, status: { sizeBytes: 2048n } } };

    render(
      <MessageEntry
        message={humanMessage("Unnamed file.")}
        files={[{ fileId: "file_data", kind: "document" }]}
        runId="exec-1"
      />,
    );

    expect(screen.getByText("data.bin")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Download data.bin" }));
    expect(downloadSpy).toHaveBeenCalledWith("file_data", "data.bin");
  });

  it("ignores files on an agent's message", () => {
    const aiMsg: ThreadMessage = {
      kind: "message",
      id: "m1",
      text: "Assistant reply.",
      live: false,
      processedAt: "",
    };

    render(
      <MessageEntry
        message={aiMsg}
        files={[documentFile]}
        runId="exec-1"
      />,
    );

    expect(screen.queryByRole("list", { name: "Files sent with this message" })).toBeNull();
  });
});
