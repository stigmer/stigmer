import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import {
  render,
  cleanup,
  waitFor,
  fireEvent,
  screen,
} from "@testing-library/react";
import { AttachmentChipList } from "../AttachmentChipList.js";
import type { AttachmentChipListProps } from "../AttachmentChipList.js";
import type { AttachmentEntry } from "../useAttachments.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(overrides: Partial<AttachmentEntry> = {}): AttachmentEntry {
  return {
    id: overrides.id ?? "entry-1",
    file:
      overrides.file ??
      new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
        type: "image/png",
      }),
    phase: overrides.phase ?? "ready",
    contentType: overrides.contentType ?? "image/png",
    storageKey: overrides.storageKey ?? "attachments/test/shot.png",
    error: overrides.error ?? null,
  };
}

function renderChips(
  entries: AttachmentEntry[],
  props: Partial<AttachmentChipListProps> = {},
) {
  return render(
    <AttachmentChipList
      entries={entries}
      onRemove={vi.fn()}
      onRetry={vi.fn()}
      {...props}
    />,
  );
}

/** The chip's miniature `<img>` (decorative, `aria-hidden`) — never the lightbox image. */
function chipImage(container: HTMLElement): HTMLImageElement | null {
  return container.querySelector('img[aria-hidden="true"]');
}

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
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Image miniature — visible in every phase (#371 gap 2)
// ---------------------------------------------------------------------------

describe("AttachmentChipList — image miniature", () => {
  it("renders an object-URL miniature for a ready image entry", async () => {
    const { container } = renderChips([entry()]);

    await waitFor(() => {
      const img = chipImage(container);
      expect(img).toBeTruthy();
      expect(img!.getAttribute("src")).toContain("blob:");
      expect(img!.getAttribute("alt")).toBe("");
    });
  });

  it("keeps the generic file icon for non-image entries", () => {
    const md = entry({
      file: new File(["# notes"], "notes.md", { type: "text/markdown" }),
      contentType: "text/markdown",
    });

    const { container } = renderChips([md]);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("keeps the miniature visible while uploading — the spinner overlays it, never replaces it", async () => {
    const uploading = entry({ id: "up", phase: "uploading", storageKey: null });

    const { container } = renderChips([uploading]);

    await waitFor(() => expect(chipImage(container)).toBeTruthy());
    // Spinner present alongside the image, not instead of it.
    expect(container.querySelector("svg.animate-spin")).toBeTruthy();
  });

  it("keeps the miniature visible on upload error, alongside the retry action", async () => {
    const errored = entry({
      id: "err",
      phase: "error",
      error: "boom",
      storageKey: null,
    });

    const { container } = renderChips([errored]);

    await waitFor(() => expect(chipImage(container)).toBeTruthy());
    expect(
      screen.getByRole("button", { name: "Retry uploading shot.png" }),
    ).toBeTruthy();
  });

  it("revokes the object URL on unmount", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const { container, unmount } = renderChips([entry()]);

    await waitFor(() => expect(chipImage(container)).toBeTruthy());
    const src = chipImage(container)!.getAttribute("src")!;

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith(src);
  });

  it("revokes the object URL when the entry is removed from the list", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const image = entry();
    const { container, rerender } = render(
      <AttachmentChipList entries={[image]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );

    await waitFor(() => expect(chipImage(container)).toBeTruthy());
    const src = chipImage(container)!.getAttribute("src")!;

    rerender(
      <AttachmentChipList entries={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(revokeSpy).toHaveBeenCalledWith(src);
  });

  it("degrades to the compact file chip when the image fails to decode", async () => {
    const { container } = renderChips([entry()]);

    await waitFor(() => expect(chipImage(container)).toBeTruthy());
    fireEvent.error(chipImage(container)!);

    // No broken-image glyph, no preview affordance — just the file treatment.
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview shot.png" })).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Remove shot.png" }),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Click-to-open — built-in lightbox and the onPreview seam (#371 gap 3)
// ---------------------------------------------------------------------------

describe("AttachmentChipList — preview", () => {
  it("opens the built-in lightbox with the full image when the chip body is clicked", async () => {
    renderChips([entry()]);

    expect(document.querySelector("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe("Preview shot.png");
    // The lightbox derives its own object URL; the full image carries the
    // filename as meaningful alt text (unlike the decorative miniature).
    await waitFor(() => {
      const full = dialog!.querySelector("img");
      expect(full).toBeTruthy();
      expect(full!.getAttribute("src")).toContain("blob:");
      expect(full!.getAttribute("alt")).toBe("shot.png");
    });
  });

  it("closes the lightbox on Escape (the dialog's cancel event)", () => {
    renderChips([entry()]);

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));
    const dialog = document.querySelector("dialog")!;

    fireEvent(dialog, new Event("cancel"));

    expect(document.querySelector("dialog")).toBeNull();
  });

  it("closes the lightbox on backdrop click, but not on content clicks", async () => {
    renderChips([entry()]);

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));
    const dialog = document.querySelector("dialog")!;
    await waitFor(() => expect(dialog.querySelector("img")).toBeTruthy());

    // A click landing on content (the image) must not close.
    fireEvent.click(dialog.querySelector("img")!);
    expect(document.querySelector("dialog")).toBeTruthy();

    // A click landing on the dialog element itself is the backdrop.
    fireEvent.click(dialog);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("closes the lightbox via its close button", () => {
    renderChips([entry()]);

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Close image preview" }),
    );

    expect(document.querySelector("dialog")).toBeNull();
  });

  it("closes the lightbox when the previewed entry is removed from the list", () => {
    const image = entry();
    const { rerender } = renderChips([image]);

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));
    expect(document.querySelector("dialog")).toBeTruthy();

    rerender(
      <AttachmentChipList entries={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(document.querySelector("dialog")).toBeNull();
  });

  it("routes the click to onPreview instead of opening the built-in lightbox", () => {
    const onPreview = vi.fn();
    const image = entry();
    renderChips([image], { onPreview });

    fireEvent.click(screen.getByRole("button", { name: "Preview shot.png" }));

    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith(image);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("offers no preview affordance on non-image entries", () => {
    const md = entry({
      file: new File(["# notes"], "notes.md", { type: "text/markdown" }),
      contentType: "text/markdown",
    });

    renderChips([md]);

    expect(screen.queryByRole("button", { name: /^Preview/ })).toBeNull();
  });

  it("keeps preview clickable while remove/retry are disabled (preview is read-only)", async () => {
    const { container } = renderChips([entry()], { disabled: true });

    await waitFor(() => expect(chipImage(container)).toBeTruthy());

    const preview = screen.getByRole("button", {
      name: "Preview shot.png",
    }) as HTMLButtonElement;
    const remove = screen.getByRole("button", {
      name: "Remove shot.png",
    }) as HTMLButtonElement;

    expect(preview.disabled).toBe(false);
    expect(remove.disabled).toBe(true);

    fireEvent.click(preview);
    expect(document.querySelector("dialog")).toBeTruthy();
  });

  it("handles unicode filenames across the chip, preview target, and lightbox", () => {
    const name = "スクリーンショット 2026-08-10.png";
    const unicode = entry({
      file: new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
        type: "image/png",
      }),
    });

    renderChips([unicode]);

    fireEvent.click(screen.getByRole("button", { name: `Preview ${name}` }));

    const dialog = document.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute("aria-label")).toBe(`Preview ${name}`);
  });
});
