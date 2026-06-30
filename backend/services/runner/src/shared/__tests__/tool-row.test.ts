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
});
