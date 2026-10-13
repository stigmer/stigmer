// Covers the offloaded tool-output path: when a result is spilled to artifact
// storage its event carries the output's head, and
// stigmer.tool_result.full_output says where the whole output is stored. The
// view must surface the STABLE storageKey (+ contentHash) so consumers
// resolve the bytes/URL on demand, and its preview is the head without the
// runner's "view full output" marker.

import { describe, it, expect } from "vitest";
import { normalizeToolResult, withoutOffloadTail } from "../tool-view";
import { toolUseOf } from "./tool-use.js";

describe("normalizeToolResult — offloaded output ref", () => {
  it("emits an outputRef view carrying the stable storageKey and contentHash, previewing the head", () => {
    const view = normalizeToolResult(
      toolUseOf({
        name: "some_tool",
        result: "head of the output…\n\n[output truncated — 879 KB total; view full output]",
        outputRef: {
          storageKey: "artifacts/exec-1/toolcalls/tc-1.txt",
          contentHash: "sha256:abc",
          sizeBytes: 900_000n,
          mimeType: "text/plain",
          isImage: false,
        },
      }),
    );

    expect(view.type).toBe("outputRef");
    if (view.type !== "outputRef") return;
    expect(view.storageKey).toBe("artifacts/exec-1/toolcalls/tc-1.txt");
    expect(view.contentHash).toBe("sha256:abc");
    expect(view.isImage).toBe(false);
    expect(view.mimeType).toBe("text/plain");
    expect(view.sizeBytes).toBe(900_000);
    expect(view.preview).toBe("head of the output…");
  });

  it("gates on storageKey, not a URL — an image ref renders inline, with no text preview", () => {
    const view = normalizeToolResult(
      toolUseOf({
        name: "some_tool",
        result: "[image output — 12 KB, view inline]",
        outputRef: {
          storageKey: "artifacts/exec-1/toolcalls/tc-1.png",
          contentHash: "sha256:img",
          sizeBytes: 12_345n,
          mimeType: "image/png",
          isImage: true,
        },
      }),
    );

    expect(view.type).toBe("outputRef");
    if (view.type !== "outputRef") return;
    expect(view.isImage).toBe(true);
    expect(view.storageKey).toBe("artifacts/exec-1/toolcalls/tc-1.png");
    expect(view.preview).toBe("");
  });

  it("does not produce an outputRef view when no storageKey is present", () => {
    // A reference with no storageKey is not a usable offload pointer; fall back to text.
    const view = normalizeToolResult(toolUseOf({ name: "some_tool", result: "plain result", outputRef: { sizeBytes: 10n } }));
    expect(view.type).not.toBe("outputRef");
  });

  it("drops only a closing marker: one with a stray bracket, one not at the end, or none leaves the text whole", () => {
    const marker = "\n\n[output truncated — 9 KB total; view full output]";
    expect(withoutOffloadTail(`head${marker}`)).toBe("head");
    expect(withoutOffloadTail(`a${marker}b${marker}`)).toBe(`a${marker}b`);
    expect(withoutOffloadTail("head\n\n[output truncated — x] y]")).toBe("head\n\n[output truncated — x] y]");
    expect(withoutOffloadTail(`head${marker} tail`)).toBe(`head${marker} tail`);
    expect(withoutOffloadTail("plain]")).toBe("plain]");
    expect(withoutOffloadTail("x".repeat(100_000) + "\n\n[output truncated — ".repeat(10_000))).toHaveLength(100_000 + 22 * 10_000);
  });
});
