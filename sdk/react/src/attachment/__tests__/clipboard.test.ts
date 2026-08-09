import { describe, it, expect } from "vitest";
import { extractClipboardFiles } from "../clipboard.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The function only reads `clipboardData.files` as an array-like, so a
 * plain array cast to FileList is a faithful stand-in (same pattern as the
 * composer fileref tests).
 */
function clipboardEventWith(files: File[]): { clipboardData: { files: FileList } } {
  return { clipboardData: { files: files as unknown as FileList } };
}

function imageFile(name: string, type = "image/png"): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

const SYNTHESIZED_NAME = /^pasted-image-\d{6}-\d+\.[a-z]+$/;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractClipboardFiles", () => {
  it("returns an empty array for a text-only paste (null clipboardData)", () => {
    expect(extractClipboardFiles({ clipboardData: null })).toEqual([]);
  });

  it("returns an empty array when the clipboard carries no files", () => {
    expect(extractClipboardFiles(clipboardEventWith([]))).toEqual([]);
  });

  it("renames the browser's generic image.png to a synthesized name", () => {
    const [file] = extractClipboardFiles(clipboardEventWith([imageFile("image.png")]));

    expect(file.name).toMatch(SYNTHESIZED_NAME);
    expect(file.name.endsWith(".png")).toBe(true);
    expect(file.type).toBe("image/png");
  });

  it("renames generic names for every image flavor browsers produce", () => {
    const cases: Array<[string, string, string]> = [
      ["image.jpg", "image/jpeg", ".jpg"],
      ["image.jpeg", "image/jpeg", ".jpg"],
      ["image.gif", "image/gif", ".gif"],
      ["image.webp", "image/webp", ".webp"],
      ["image.tiff", "image/tiff", ".tiff"],
      ["IMAGE.PNG", "image/png", ".png"],
      // Empty name with an image MIME (some WebKit paste payloads).
      ["", "image/png", ".png"],
    ];

    for (const [name, type, expectedExt] of cases) {
      const [file] = extractClipboardFiles(clipboardEventWith([imageFile(name, type)]));
      expect(file.name, `input name '${name}'`).toMatch(SYNTHESIZED_NAME);
      expect(file.name.endsWith(expectedExt), `'${file.name}' should end with ${expectedExt}`).toBe(true);
    }
  });

  it("gives two images pasted together distinct names", () => {
    const files = extractClipboardFiles(
      clipboardEventWith([imageFile("image.png"), imageFile("image.png")]),
    );

    expect(files).toHaveLength(2);
    expect(files[0].name).not.toBe(files[1].name);
  });

  it("gives images from separate pastes distinct names (session inputs/ dir accumulates)", () => {
    const [first] = extractClipboardFiles(clipboardEventWith([imageFile("image.png")]));
    const [second] = extractClipboardFiles(clipboardEventWith([imageFile("image.png")]));

    expect(first.name).not.toBe(second.name);
  });

  it("keeps the real name of a file pasted from a file manager", () => {
    const [file] = extractClipboardFiles(
      clipboardEventWith([imageFile("architecture-sketch.png")]),
    );

    expect(file.name).toBe("architecture-sketch.png");
  });

  it("does not rename a non-image file even when named image.png", () => {
    const pdf = new File([new Uint8Array([0x25, 0x50])], "image.png", {
      type: "application/pdf",
    });

    const [file] = extractClipboardFiles(clipboardEventWith([pdf]));
    expect(file.name).toBe("image.png");
  });

  it("preserves bytes and metadata across a rename", async () => {
    const original = new File([new Uint8Array([1, 2, 3, 4])], "image.png", {
      type: "image/png",
      lastModified: 1723200000000,
    });

    const [renamed] = extractClipboardFiles(clipboardEventWith([original]));

    expect(renamed.type).toBe("image/png");
    expect(renamed.lastModified).toBe(1723200000000);
    expect(new Uint8Array(await renamed.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
  });
});
