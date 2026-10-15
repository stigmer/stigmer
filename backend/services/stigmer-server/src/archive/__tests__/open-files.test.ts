/**
 * Pins the archive gate every pushed folder kind shares (open-files.ts):
 * the files it lists are the archive's own, read lazily; a path it does not
 * list is refused naming the caller's noun; and an entry whose payload no
 * longer matches its checksum is refused when read, naming the entry and
 * the noun, so a push's refusal says which file of which kind's archive.
 */
import { describe, expect, it } from "vitest";

import { buildZip } from "@stigmer/zip-structure/testing";

import { openArchiveFiles } from "../open-files.js";

const decoder = new TextDecoder();

describe("openArchiveFiles", () => {
  it("lists the archive's files and reads one on demand", () => {
    const opened = openArchiveFiles(buildZip([{ name: "c/prompt.md", content: "Hi." }]), "eval");
    expect(opened.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(opened.files.entries.map((entry) => entry.path)).toEqual(["c/prompt.md"]);
    expect(decoder.decode(opened.files.read("c/prompt.md"))).toBe("Hi.");
  });

  it("refuses a path the archive does not list, naming the kind", () => {
    const opened = openArchiveFiles(buildZip([{ name: "a.md", content: "x" }]), "eval");
    expect(() => opened.files.read("b.md")).toThrow("eval file 'b.md' is not listed");
  });

  it("refuses an entry whose payload fails its checksum, naming the entry and the kind", () => {
    const zip = buildZip([{ name: "c/prompt.md", content: "hello" }]);
    const at = Buffer.from(zip).indexOf("hello");
    const corrupt = new Uint8Array(zip);
    corrupt[at] = "j".charCodeAt(0);
    const opened = openArchiveFiles(corrupt, "plugin");
    expect(() => opened.files.read("c/prompt.md")).toThrow(
      "failed to read 'c/prompt.md' from the plugin archive: zip: checksum error",
    );
  });
});
