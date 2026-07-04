import { describe, it, expect } from "vitest";
import {
  base64ToBytes,
  detectBinary,
  bytesToText,
  normalizeGitHubContent,
} from "../decodeGitHubContent";
import { MAX_WORKSPACE_FILE_READ_BYTES } from "../../workspace/WorkspaceFileReader";

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("base64ToBytes", () => {
  it("decodes plain base64 to bytes", () => {
    expect(bytesToText(base64ToBytes("SGVsbG8gV29ybGQh"))).toBe("Hello World!");
  });

  it("strips the newlines GitHub inserts every 60 chars", () => {
    // GitHub's Contents API line-wraps its base64; atob would otherwise reject it.
    const wrapped = "SGVsbG8g\nV29ybGQh\n";
    expect(bytesToText(base64ToBytes(wrapped))).toBe("Hello World!");
  });
});

describe("detectBinary", () => {
  it("flags a buffer containing a NUL byte", () => {
    expect(detectBinary(new Uint8Array([0x48, 0x00, 0x49]))).toBe(true);
  });

  it("treats NUL-free text as non-binary", () => {
    expect(detectBinary(utf8("just some text"))).toBe(false);
  });

  it("only sniffs the head — a NUL past the sniff window is not detected", () => {
    const bytes = new Uint8Array(9000).fill(0x61); // non-zero baseline
    bytes[8500] = 0; // beyond the 8000-byte sniff window
    expect(detectBinary(bytes)).toBe(false);
  });
});

describe("bytesToText", () => {
  it("decodes valid UTF-8", () => {
    expect(bytesToText(utf8("héllo — 世界"))).toBe("héllo — 世界");
  });

  it("returns null for invalid UTF-8", () => {
    // 0xFF is never a valid UTF-8 lead byte; the fatal decoder throws → null.
    expect(bytesToText(new Uint8Array([0xff]))).toBeNull();
  });
});

describe("normalizeGitHubContent", () => {
  it("maps clean text to a utf-8 content record with the full size", () => {
    const bytes = utf8("hello");
    expect(normalizeGitHubContent(bytes, bytes.length)).toEqual({
      text: "hello",
      isBinary: false,
      size: bytes.length,
      encoding: "utf-8",
    });
  });

  it("reports binary content with text null", () => {
    const result = normalizeGitHubContent(new Uint8Array([0x00, 0x01, 0x02]), 3);
    expect(result).toEqual({
      text: null,
      isBinary: true,
      size: 3,
      encoding: "base64",
    });
  });

  it("marks undecodable (non-binary) bytes as unknown encoding", () => {
    // 0xC0 is an invalid UTF-8 lead byte but not a NUL, so it is not "binary".
    const result = normalizeGitHubContent(new Uint8Array([0xc0, 0x41]), 2);
    expect(result).toEqual({
      text: null,
      isBinary: false,
      size: 2,
      encoding: "unknown",
    });
  });

  it("truncates at the 1 MB cap and flags it, while size reports the full length", () => {
    const total = MAX_WORKSPACE_FILE_READ_BYTES + 500;
    const bytes = new Uint8Array(total).fill(0x61); // 'a'
    const result = normalizeGitHubContent(bytes, total);

    expect(result.truncated).toBe(true);
    expect(result.size).toBe(total);
    expect(result.text).toHaveLength(MAX_WORKSPACE_FILE_READ_BYTES);
    expect(result.encoding).toBe("utf-8");
  });

  it("does not set truncated when exactly at the cap", () => {
    const bytes = new Uint8Array(MAX_WORKSPACE_FILE_READ_BYTES).fill(0x61);
    const result = normalizeGitHubContent(bytes, bytes.length);
    expect(result.truncated).toBeUndefined();
    expect(result.text).toHaveLength(MAX_WORKSPACE_FILE_READ_BYTES);
  });
});
