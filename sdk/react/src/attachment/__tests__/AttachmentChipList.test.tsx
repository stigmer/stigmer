import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { AttachmentChipList } from "../AttachmentChipList.js";
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

function renderChips(entries: AttachmentEntry[]) {
  return render(
    <AttachmentChipList entries={entries} onRemove={vi.fn()} onRetry={vi.fn()} />,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AttachmentChipList — image thumbnails", () => {
  it("renders an object-URL thumbnail for a ready image entry", async () => {
    const { container } = renderChips([entry()]);

    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img).toBeTruthy();
      expect(img!.getAttribute("src")).toContain("blob:");
      expect(img!.getAttribute("aria-hidden")).toBe("true");
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

  it("shows no thumbnail while uploading or errored (spinner / error dot own the slot)", () => {
    const uploading = entry({ id: "up", phase: "uploading", storageKey: null });
    const errored = entry({ id: "err", phase: "error", error: "boom", storageKey: null });

    const { container } = renderChips([uploading, errored]);

    expect(container.querySelector("img")).toBeNull();
  });

  it("revokes the object URL on unmount", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const { container, unmount } = renderChips([entry()]);

    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    const src = container.querySelector("img")!.getAttribute("src")!;

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith(src);
  });

  it("revokes the object URL when the entry is removed from the list", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const image = entry();
    const { container, rerender } = render(
      <AttachmentChipList entries={[image]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );

    await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
    const src = container.querySelector("img")!.getAttribute("src")!;

    rerender(
      <AttachmentChipList entries={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(revokeSpy).toHaveBeenCalledWith(src);
  });
});
