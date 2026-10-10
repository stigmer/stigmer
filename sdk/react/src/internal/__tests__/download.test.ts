/**
 * Pins the one download routine every export goes through: the file
 * carries exactly the caller's bytes or text under the caller's MIME type
 * (text with the UTF-8 charset appended), the hidden link names the file,
 * is clicked once and is gone afterwards, and the object URL is revoked.
 * A binary download of a view onto a larger buffer carries only the
 * view's bytes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBinaryFile, downloadTextFile } from "../download";

interface Clicked {
  readonly href: string;
  readonly download: string;
  readonly attached: boolean;
}

let blobs: Blob[];
let clicks: Clicked[];
let revoked: string[];

beforeEach(() => {
  blobs = [];
  clicks = [];
  revoked = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:test/${blobs.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      clicks.push({
        href: this.href,
        download: this.download,
        attached: document.body.contains(this),
      });
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("downloadBinaryFile", () => {
  it("downloads only the view's bytes, under the caller's name and type, and cleans up", async () => {
    const shared = new Uint8Array([9, 1, 2, 3, 9]);

    downloadBinaryFile(shared.subarray(1, 4), "case.zip", "application/zip");

    expect(blobs).toHaveLength(1);
    expect(blobs[0]!.type).toBe("application/zip");
    expect(Array.from(new Uint8Array(await blobs[0]!.arrayBuffer()))).toEqual([
      1, 2, 3,
    ]);
    expect(clicks).toEqual([
      { href: "blob:test/1", download: "case.zip", attached: true },
    ]);
    expect(document.body.querySelector("a")).toBeNull();
    expect(revoked).toEqual(["blob:test/1"]);
  });
});

describe("downloadTextFile", () => {
  it("downloads the text as UTF-8 under the caller's type", async () => {
    downloadTextFile("# Notes\n", "notes.md", "text/markdown");

    expect(blobs[0]!.type).toBe("text/markdown;charset=utf-8;");
    expect(await blobs[0]!.text()).toBe("# Notes\n");
    expect(clicks.map((click) => click.download)).toEqual(["notes.md"]);
    expect(revoked).toEqual(["blob:test/1"]);
  });
});
