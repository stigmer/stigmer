/**
 * Pins writeArchive's identity (write.ts): the same files give the same
 * bytes whatever order they are listed in; those bytes are the CLI
 * archiver's for the CLI's walk order, where a directory's files come
 * before a sibling file whose name sorts after the directory's (`b/x.txt`
 * before `b.txt`), so a folder the server wrote hashes alike when the CLI
 * pushes it back; a path listed twice is refused; the archive reads back
 * through the server's own reader.
 */
import { describe, expect, it } from "vitest";

import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { archivePlugin, compareWalkOrder } from "@stigmer/plugin-package/client";

import { openArchiveFiles } from "../open-files.js";
import { writeArchive } from "../write.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const FILES = [
  { path: "b.txt", bytes: encoder.encode("a sibling file") },
  { path: "b/x.txt", bytes: encoder.encode("inside the directory") },
  { path: "a/prompt.md", bytes: encoder.encode("Refund my order.\n") },
];

describe("writeArchive", () => {
  it("writes the same bytes whatever order the files are listed in", () => {
    expect(writeArchive(FILES)).toEqual(writeArchive([...FILES].reverse()));
  });

  it("writes the CLI archiver's bytes for the CLI's walk order, not plain code-point order", () => {
    const walkOrder = [...FILES].sort((a, b) => compareWalkOrder(a.path, b.path));
    expect(walkOrder.map((file) => file.path)).toEqual(["a/prompt.md", "b/x.txt", "b.txt"]);
    const cli = archivePlugin({
      entries: walkOrder.map((file) => ({ path: file.path, size: file.bytes.length })),
      read: (path) => walkOrder.find((file) => file.path === path)?.bytes ?? new Uint8Array(),
    });
    expect(writeArchive(FILES)).toEqual(cli);
    // The plain code-point order (b.txt before b/x.txt) is another archive.
    expect(writeArchive(FILES)).not.toEqual(archivePlugin(inMemoryPluginFiles(new Map(FILES.map((file) => [file.path, file.bytes])))));
  });

  it("refuses a path listed twice", () => {
    expect(() => writeArchive([...FILES, { path: "b.txt", bytes: new Uint8Array() }])).toThrow("archive path 'b.txt' listed twice");
  });

  it("reads back through the server's reader", () => {
    const opened = openArchiveFiles(writeArchive(FILES), "eval");
    expect(opened.files.entries.map((entry) => entry.path).sort()).toEqual(["a/prompt.md", "b.txt", "b/x.txt"]);
    expect(decoder.decode(opened.files.read("b/x.txt"))).toBe("inside the directory");
  });
});
