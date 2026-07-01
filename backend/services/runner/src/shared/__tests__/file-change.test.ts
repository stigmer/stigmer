import { describe, it, expect } from "vitest";
import {
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  looksBinary,
  bytesLookBinary,
  buildFileChange,
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

describe("buildFileChange", () => {
  it("wraps inline before/after and marks a binary side", () => {
    const fc = buildFileChange({
      path: "assets/logo.bin",
      absolutePath: "/root/assets/logo.bin",
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: "text",
      after: "bin\u0000ary",
    });

    expect(fc.path).toBe("assets/logo.bin");
    expect(fc.absolutePath).toBe("/root/assets/logo.bin");
    expect(fc.changeType).toBe(FileChangeType.MODIFY);
    expect(fc.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    expect(fc.before?.body.case).toBe("inline");
    expect(fc.before?.isBinary).toBe(false);
    expect(fc.after?.body.case).toBe("inline");
    expect(fc.after?.isBinary).toBe(true);
  });

  it("omits an undefined side but preserves an empty string as a real value", () => {
    // CREATE: no before; an empty after is a real (empty) file, not absent.
    const created = buildFileChange({
      path: "new.ts",
      absolutePath: "/root/new.ts",
      changeType: FileChangeType.CREATE,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      after: "",
    });
    expect(created.before).toBeUndefined();
    expect(created.after?.body.case).toBe("inline");
    expect(created.after?.body.value).toBe("");
  });

  it("defaults the hunk-only / derivable fields to their zero values", () => {
    const fc = buildFileChange({
      path: "x.ts",
      absolutePath: "/root/x.ts",
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: "a",
      after: "b",
    });
    // Native leaves these for the presentation layer to derive.
    expect(fc.unifiedDiff).toBe("");
    expect(fc.linesAdded).toBe(0);
    expect(fc.linesRemoved).toBe(0);
    expect(fc.renameFrom).toBe("");
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
