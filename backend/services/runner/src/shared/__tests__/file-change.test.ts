import { describe, it, expect } from "vitest";
import {
  looksBinary,
  bytesLookBinary,
  resolveWorkspacePath,
} from "../file-change.js";

describe("looksBinary", () => {
  it("flags content containing a NUL byte", () => {
    expect(looksBinary("PNG\u0000\u0000IHDR")).toBe(true);
  });

  it("does not flag plain UTF-8 text, including unicode and empty", () => {
    expect(looksBinary("hello world")).toBe(false);
    expect(looksBinary("héllo — 世界 \n\t")).toBe(false);
    expect(looksBinary("")).toBe(false);
  });
});

describe("bytesLookBinary", () => {
  it("flags raw bytes containing a NUL", () => {
    expect(bytesLookBinary(Buffer.from([0x89, 0x50, 0x00, 0x4e]))).toBe(true);
    expect(bytesLookBinary(new Uint8Array([0x00]))).toBe(true);
  });

  it("does not flag NUL-free bytes (text, or high bytes without a NUL)", () => {
    expect(bytesLookBinary(Buffer.from("hello world", "utf8"))).toBe(false);
    expect(bytesLookBinary(Buffer.from("héllo — 世界", "utf8"))).toBe(false);
    expect(bytesLookBinary(Buffer.from([0xff, 0xfe, 0x80]))).toBe(false);
    expect(bytesLookBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe("resolveWorkspacePath", () => {
  const root = "/work/space";

  describe("native (virtualRoot=true)", () => {
    it("strips a leading slash and joins under the root", () => {
      // "/src/app.ts" is the deepagents virtual-root convention; the display
      // path drops the leading slash and the absolute path lives under root.
      expect(resolveWorkspacePath("/src/app.ts", root, true)).toEqual({
        path: "src/app.ts",
        absolutePath: "/work/space/src/app.ts",
      });
    });

    it("passes a bare relative path through and joins it", () => {
      expect(resolveWorkspacePath("src/app.ts", root, true)).toEqual({
        path: "src/app.ts",
        absolutePath: "/work/space/src/app.ts",
      });
    });

    it("normalizes a leading ./ segment", () => {
      expect(resolveWorkspacePath("./README.md", root, true)).toEqual({
        path: "README.md",
        absolutePath: "/work/space/README.md",
      });
    });
  });

  describe("cursor (virtualRoot=false)", () => {
    it("makes an absolute path under the root relative for display", () => {
      expect(resolveWorkspacePath("/work/space/src/app.ts", root, false)).toEqual({
        path: "src/app.ts",
        absolutePath: "/work/space/src/app.ts",
      });
    });

    it("displays an absolute path outside the root as-is (never an escaping ../)", () => {
      const outside = "/etc/hosts";
      expect(resolveWorkspacePath(outside, root, false)).toEqual({
        path: outside,
        absolutePath: outside,
      });
    });

    it("treats a relative path the same as the virtual case", () => {
      expect(resolveWorkspacePath("src/app.ts", root, false)).toEqual({
        path: "src/app.ts",
        absolutePath: "/work/space/src/app.ts",
      });
    });
  });
});
