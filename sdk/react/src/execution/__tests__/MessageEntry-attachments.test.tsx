import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { MessageEntry } from "../MessageEntry";
import type { MessageAttachmentView } from "../MessageAttachments";

// ---------------------------------------------------------------------------
// MessageEntry attachment rendering (stigmer/stigmer#372): the human bubble
// shows the turn's submitted files — image previews and document downloads
// when the execution record exists, inert chips on the pending bubble, and
// nothing at all when the turn had no attachments.
//
// The presign hooks are mocked at the module boundary: these are rendering
// tests, and the URL-minting contract has its own coverage.
// ---------------------------------------------------------------------------

const downloadSpy = vi.fn(() => Promise.resolve());
let urlState: { url: string | null; error: Error | null } = {
  url: null,
  error: null,
};

vi.mock("../useArtifactDownloadUrl", () => ({
  useArtifactDownloadUrl: (executionId: string | null, storageKey: string | null) => ({
    url: executionId && storageKey ? urlState.url : null,
    isLoading: false,
    isRefetching: false,
    error: urlState.error,
    refetch: vi.fn(),
  }),
}));

vi.mock("../useArtifactDownload", () => ({
  useArtifactDownload: (executionId: string | null) => ({
    download: executionId ? downloadSpy : vi.fn(() => Promise.resolve()),
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
});

function humanMessage(content: string) {
  const msg = create(AgentMessageSchema);
  msg.type = MessageType.MESSAGE_HUMAN;
  msg.content = content;
  return msg;
}

const imageAttachment: MessageAttachmentView = {
  filename: "screenshot.png",
  contentType: "image/png",
  storageKey: "attachments/01AAA/screenshot.png",
};

const documentAttachment: MessageAttachmentView = {
  filename: "notes.txt",
  contentType: "text/plain",
  storageKey: "attachments/01BBB/notes.txt",
};

describe("MessageEntry attachment rendering", () => {
  it("renders no attachment row when the turn has none", () => {
    render(<MessageEntry message={humanMessage("Just text.")} />);

    expect(screen.queryByRole("list", { name: "Submitted attachments" })).toBeNull();
    expect(screen.getByText("Just text.")).toBeTruthy();
  });

  it("renders an image preview chip with the presigned URL and click-to-open lightbox", () => {
    urlState = { url: "https://r2.example/presigned/screenshot", error: null };

    const { container } = render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        attachments={[imageAttachment]}
        executionId="exec-1"
      />,
    );

    expect(screen.getByRole("list", { name: "Submitted attachments" })).toBeTruthy();
    const img = container.querySelector("img[aria-hidden='true']");
    expect(img?.getAttribute("src")).toBe("https://r2.example/presigned/screenshot");

    // Click-to-open: the shared lightbox mounts with the full image.
    fireEvent.click(screen.getByRole("button", { name: "Preview screenshot.png" }));
    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview screenshot.png");
  });

  it("renders a document chip that downloads under the original filename", () => {
    render(
      <MessageEntry
        message={humanMessage("The notes are attached.")}
        attachments={[documentAttachment]}
        executionId="exec-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download notes.txt" }));
    expect(downloadSpy).toHaveBeenCalledWith(
      "attachments/01BBB/notes.txt",
      "notes.txt",
    );
  });

  it("renders no visible filename on image tiles — identity lives in the tooltip and accessible label", () => {
    urlState = { url: "https://r2.example/presigned/screenshot", error: null };

    render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        attachments={[imageAttachment]}
        executionId="exec-1"
      />,
    );

    // The tile is preview-only: no "screenshot.png" text node anywhere…
    expect(screen.queryByText("screenshot.png")).toBeNull();
    // …but the name stays reachable — tooltip on the listitem, aria on both.
    const tile = screen.getByRole("listitem", { name: "screenshot.png" });
    expect(tile.getAttribute("title")).toBe("screenshot.png");
    expect(
      screen.getByRole("button", { name: "Preview screenshot.png" }),
    ).toBeTruthy();
  });

  it("pulses the image tile only while the presigned URL is being minted", () => {
    urlState = { url: null, error: null };

    const { container } = render(
      <MessageEntry
        message={humanMessage("See the screenshot.")}
        attachments={[imageAttachment]}
        executionId="exec-1"
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
        attachments={[imageAttachment, documentAttachment]}
      />,
    );

    // Both files are present as evidence — the image as a glyph tile
    // (named via aria/tooltip), the document as a filename chip…
    expect(screen.getByRole("list", { name: "Submitted attachments" })).toBeTruthy();
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
        attachments={[imageAttachment]}
        executionId="exec-1"
      />,
    );

    // Never a broken-image glyph — the file stays reachable via download.
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Download screenshot.png" }),
    ).toBeTruthy();
  });

  it("falls back to the storage key's basename when the filename is missing", () => {
    render(
      <MessageEntry
        message={humanMessage("Unnamed attachment.")}
        attachments={[{ storageKey: "attachments/01CCC/data.bin" }]}
        executionId="exec-1"
      />,
    );

    expect(screen.getByText("data.bin")).toBeTruthy();
  });

  it("ignores attachments on non-human messages", () => {
    const aiMsg = create(AgentMessageSchema);
    aiMsg.type = MessageType.MESSAGE_AI;
    aiMsg.content = "Assistant reply.";

    render(
      <MessageEntry
        message={aiMsg}
        attachments={[documentAttachment]}
        executionId="exec-1"
      />,
    );

    expect(screen.queryByRole("list", { name: "Submitted attachments" })).toBeNull();
  });
});
