// Covers the offloaded tool-output path: when a result is spilled to artifact
// storage the runner replaces it with a ToolCallOutputRef. The view must surface
// the STABLE storageKey (+ contentHash) so consumers resolve the bytes/URL on
// demand — it must never depend on a persisted (ephemeral) URL.

import { describe, it, expect } from "vitest";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  ToolCallSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ToolCallStatus,
  ToolKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { normalizeToolResult } from "../tool-view";

function toolCallWithOutputRef(ref: ReturnType<typeof create<typeof ToolCallOutputRefSchema>> | undefined, result = "") {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "some_tool",
    toolKind: ToolKind.UNSPECIFIED,
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    args: {} as JsonObject,
    result,
    outputRef: ref,
  });
}

describe("normalizeToolResult — offloaded output ref", () => {
  it("emits an outputRef view carrying the stable storageKey and contentHash", () => {
    const ref = create(ToolCallOutputRefSchema, {
      storageKey: "artifacts/exec-1/toolcalls/tc-1.txt",
      contentHash: "sha256:abc",
      sizeBytes: 900_000n,
      mimeType: "text/plain",
      isImage: false,
      truncatedPreview: "head of the output…",
    });

    const view = normalizeToolResult(toolCallWithOutputRef(ref, "[output truncated]"));

    expect(view.type).toBe("outputRef");
    if (view.type !== "outputRef") return;
    expect(view.storageKey).toBe("artifacts/exec-1/toolcalls/tc-1.txt");
    expect(view.contentHash).toBe("sha256:abc");
    expect(view.isImage).toBe(false);
    expect(view.mimeType).toBe("text/plain");
    expect(view.sizeBytes).toBe(900_000);
    expect(view.preview).toBe("head of the output…");
  });

  it("gates on storageKey, not a URL — an image ref renders inline", () => {
    const ref = create(ToolCallOutputRefSchema, {
      storageKey: "artifacts/exec-1/toolcalls/tc-1.png",
      contentHash: "sha256:img",
      sizeBytes: 12_345n,
      mimeType: "image/png",
      isImage: true,
    });

    const view = normalizeToolResult(toolCallWithOutputRef(ref));

    expect(view.type).toBe("outputRef");
    if (view.type !== "outputRef") return;
    expect(view.isImage).toBe(true);
    expect(view.storageKey).toBe("artifacts/exec-1/toolcalls/tc-1.png");
  });

  it("does not produce an outputRef view when no storageKey is present", () => {
    // A ref with no storageKey is not a usable offload pointer; fall back to text.
    const ref = create(ToolCallOutputRefSchema, { sizeBytes: 10n });
    const view = normalizeToolResult(toolCallWithOutputRef(ref, "plain result"));
    expect(view.type).not.toBe("outputRef");
  });
});
