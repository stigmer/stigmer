/**
 * Unit tests for the shared tool-row collapse helpers — the "hidden row" shape
 * both harnesses use so file_change_sets is the single review surface.
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ToolCallSchema, FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { hideToolCallRow, isToolCallRowHidden } from "../tool-row.js";

describe("hideToolCallRow", () => {
  it("collapses a completed file-edit row to the hidden shape", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "wrote file",
      argsPreview: "path=src/app.ts",
      args: { file_path: "src/app.ts", content: "console.log('hi')" },
      requiresApproval: true,
      approvalMessage: "Write file",
      fileChanges: [create(FileChangeSchema, { path: "src/app.ts" })],
    });

    hideToolCallRow(tc);

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.requiresApproval).toBe(false);
    expect(tc.result).toBe("");
    expect(tc.error).toBe("");
    expect(tc.argsPreview).toBe("");
    expect(tc.approvalMessage).toBe("");
    expect(tc.fileChanges).toHaveLength(0);
    expect(tc.completedAt).not.toBe("");
    // Identity is preserved (append-only): id + name survive the collapse.
    expect(tc.id).toBe("tc-1");
    expect(tc.name).toBe("write");
  });

  it("scrubs args so a hidden row carries no content (design doc 12, D4)", () => {
    // A file-mutating tool's args hold the full write body. For a secret-like
    // path this content would otherwise persist into the transcript / Temporal
    // history, defeating the never-persist-secret-contents contract. The hidden
    // row is redundant with the file_change_set, so args must be dropped.
    const tc = create(ToolCallSchema, {
      id: "tc-secret",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { file_path: ".env", content: "API_KEY=super-secret-value" },
    });

    hideToolCallRow(tc);

    expect(tc.args).toBeUndefined();
    expect(isToolCallRowHidden(tc)).toBe(true);
  });

  it("is idempotent", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "ok",
    });
    hideToolCallRow(tc);
    const firstCompletedAt = tc.completedAt;
    hideToolCallRow(tc);
    expect(isToolCallRowHidden(tc)).toBe(true);
    expect(tc.completedAt).toBe(firstCompletedAt); // not overwritten
  });
});

describe("isToolCallRowHidden", () => {
  it("recognizes a hidden row", () => {
    const tc = create(ToolCallSchema, { id: "x", name: "write", status: ToolCallStatus.TOOL_CALL_COMPLETED, result: "y" });
    expect(isToolCallRowHidden(tc)).toBe(false);
    hideToolCallRow(tc);
    expect(isToolCallRowHidden(tc)).toBe(true);
  });

  it("does not treat a live WAITING_APPROVAL row as hidden", () => {
    const tc = create(ToolCallSchema, {
      id: "x",
      name: "shell",
      status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
      requiresApproval: true,
    });
    expect(isToolCallRowHidden(tc)).toBe(false);
  });

  it("does not treat a SKIPPED row with lingering args as hidden", () => {
    // A row collapsed by an older code path may still carry args; the predicate
    // must report it as not-yet-hidden so it gets re-scrubbed rather than skipped.
    const tc = create(ToolCallSchema, {
      id: "x",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_SKIPPED,
      args: { file_path: ".env", content: "leftover" },
    });
    expect(isToolCallRowHidden(tc)).toBe(false);
  });
});
