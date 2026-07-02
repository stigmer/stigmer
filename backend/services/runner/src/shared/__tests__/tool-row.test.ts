/**
 * Unit tests for the shared tool-row file-review presentation helpers:
 * `stampFileEditRow` (the observational-row stamp both harnesses apply to
 * flowed file edits) and `hideToolCallRow`/`isToolCallRowHidden` (the collapse
 * shape kept for denial twins and legacy pre-stamping sessions).
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { hideToolCallRow, isToolCallRowHidden, stampFileEditRow } from "../tool-row.js";

describe("stampFileEditRow", () => {
  it("stamps additively: content, status, and identity all survive", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-1",
      name: "edit",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: '{"status":"completed","value":{"diffString":"+hi","linesAdded":1}}',
      argsPreview: '{"path":"src/app.ts"}',
      args: { path: "src/app.ts", old_string: "a", new_string: "b" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    // The row is an observational record: everything the streamed card rendered
    // from stays in place (the diff renders from result/args, never argsPreview).
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.args).toEqual({ path: "src/app.ts", old_string: "a", new_string: "b" });
    expect(tc.result).toContain("diffString");
    expect(tc.argsPreview).toBe('{"path":"src/app.ts"}');
  });

  it("never overwrites an existing stamp (the cross-turn mis-attribution guard)", () => {
    // A resume seeds prior turns' rows into the transcript; the turn-boundary
    // pass re-walks all of them. The stamp must be first-writer-wins or turn N
    // would claim turn N-1's rows.
    const tc = create(ToolCallSchema, {
      id: "tc-old",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      args: { path: "notes.md", content: "x" },
      fileChangeSetId: "exec-1:0",
    });

    stampFileEditRow(tc, "exec-1:1");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
  });

  it("withholds content for a secret-like TRACKED path but keeps the path visible (DD-12 D4)", () => {
    // The hook denies secret-like gitignored writes before they flow, but a
    // committed credentials file is outside its scope — the stamp is the last
    // line of defense against persisting its bytes in the transcript.
    const tc = create(ToolCallSchema, {
      id: "tc-secret",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "wrote credentials.json",
      argsPreview: '{"path":"config/credentials.json"}',
      args: { path: "config/credentials.json", content: "TOKEN=super-secret" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    expect(tc.args).toEqual({ path: "config/credentials.json" }); // path only, no body
    expect(tc.result).toBe("");
    expect(tc.argsPreview).toBe("");
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED); // still visible
  });

  it("fail-closes when the path cannot be determined: content withheld", () => {
    const tc = create(ToolCallSchema, {
      id: "tc-weird",
      name: "write",
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      result: "ok",
      args: { unrecognized_shape: "payload" },
    });

    stampFileEditRow(tc, "exec-1:0");

    expect(tc.fileChangeSetId).toBe("exec-1:0");
    expect(tc.args).toBeUndefined();
    expect(tc.result).toBe("");
  });
});

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
    });

    hideToolCallRow(tc);

    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
    expect(tc.requiresApproval).toBe(false);
    expect(tc.result).toBe("");
    expect(tc.error).toBe("");
    expect(tc.argsPreview).toBe("");
    expect(tc.approvalMessage).toBe("");
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
