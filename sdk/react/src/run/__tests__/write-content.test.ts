/**
 * The one write-content rule for the gate and the settled row (stigmer#1107):
 * which argument field carries a write's proposed content, and how the gate
 * overlays that content from the row's authoritative `args` onto the
 * sanitized preview without letting any other field cross over.
 */
import { describe, it, expect } from "vitest";
import {
  extractWriteContentFromArgs,
  parseArgsPreview,
  withAuthoritativeWriteContent,
} from "../tool-categories";

describe("extractWriteContentFromArgs", () => {
  it("returns the first content field holding a non-empty string, in list order", () => {
    expect(extractWriteContentFromArgs({ contents: "a", content: "b" })).toBe("a");
    expect(extractWriteContentFromArgs({ content: "", new_string: "b" })).toBe("b");
    expect(extractWriteContentFromArgs({ new_text: "cursor", replacement: "x" })).toBe("cursor");
  });

  it("returns null when no content field holds a string", () => {
    expect(extractWriteContentFromArgs({ file_path: "/x" })).toBeNull();
    expect(extractWriteContentFromArgs({ content: 42 })).toBeNull();
    expect(extractWriteContentFromArgs({})).toBeNull();
  });
});

describe("parseArgsPreview", () => {
  it("parses an object preview and rejects everything else", () => {
    expect(parseArgsPreview('{"path":"/x"}')).toEqual({ path: "/x" });
    expect(parseArgsPreview("")).toBeNull();
    expect(parseArgsPreview('"a string"')).toBeNull();
    expect(parseArgsPreview("[1,2]")).toBeNull();
    expect(parseArgsPreview('{"path":"/x","content":"trunc…')).toBeNull();
  });
});

describe("withAuthoritativeWriteContent", () => {
  const preview = { file_path: "/x", token: "[REDACTED]", content: "[381 chars]" };

  it("replaces an elided content value under the field args carry it in", () => {
    const out = withAuthoritativeWriteContent(preview, {
      file_path: "/x",
      token: "raw-secret",
      content: "the whole file\n",
    });
    expect(out.content).toBe("the whole file\n");
  });

  it("adds a content field the preview left out", () => {
    const out = withAuthoritativeWriteContent(
      { file_path: "/x" },
      { file_path: "/x", new_string: "after" },
    );
    expect(out).toEqual({ file_path: "/x", new_string: "after" });
  });

  it("copies nothing but the content: a redacted field stays redacted", () => {
    const out = withAuthoritativeWriteContent(preview, {
      file_path: "/y",
      token: "raw-secret",
      content: "c",
      extra: "never shown",
    });
    expect(out.token).toBe("[REDACTED]");
    expect(out.file_path).toBe("/x");
    expect("extra" in out).toBe(false);
  });

  it("returns the preview object itself when args carry no content, or are absent", () => {
    expect(withAuthoritativeWriteContent(preview, { file_path: "/x" })).toBe(preview);
    expect(withAuthoritativeWriteContent(preview, undefined)).toBe(preview);
  });

  it("never mutates its inputs", () => {
    const args = { file_path: "/x", content: "c" };
    const out = withAuthoritativeWriteContent(preview, args);
    expect(out).not.toBe(preview);
    expect(preview.content).toBe("[381 chars]");
    expect(args.content).toBe("c");
  });
});
