/**
 * @regression file-hitl-phase0 — pins file-edit HITL fix #4 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Unit tests for resume-time exact-apply (the HITL "what you approve is what gets
 * applied" guarantee for the Cursor deny-only harness).
 *
 * Since Phase 5 Slice 4 the approved bytes and target path are read from the
 * gated tool call's `args` (the single source — there is no separate captured
 * `file_changes` mirror). These pin the load-bearing invariants:
 * - an APPROVED whole-file write is written to disk with the EXACT approved bytes
 *   (args content) and its tool call is marked COMPLETED in place;
 * - the content resolver NEVER writes the elision marker (which would silently
 *   corrupt the file) — it degrades to a fall back (no write);
 * - everything that is not an approved whole-file write (hunk edits, shell, MCP,
 *   skipped/rejected, already-completed) is left untouched for the existing
 *   grant + reinvocation path;
 * - the apply targets the args path resolved under the workspace (multi-root) and
 *   refuses a target outside the workspace;
 * - the step is idempotent under Temporal activity retries.
 *
 * Deterministic; no Cursor API key.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  applyApprovedWholeFileWrites,
  resolveApprovedWholeFileContent,
} from "../exact-apply.js";
import { ELISION_MARKER } from "../../../shared/status-offload.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";

const ROOT = "/root";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── builders ─────────────────────────────────────────────────────────────────

/** An approved, still-pending whole-file write whose args carry path + content. */
function approvedWrite(
  args: Record<string, unknown>,
  overrides: MessageInitShape<typeof ToolCallSchema> = {},
): ToolCall {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "write",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.APPROVE,
    args: args as JsonObject,
    ...overrides,
  });
}

function messagesOf(...toolCalls: ToolCall[]): AgentMessage[] {
  return [create(AgentMessageSchema, { type: MessageType.MESSAGE_AI, toolCalls })];
}

function recordingBackend(): { backend: WorkspaceBackend; writes: Array<{ path: string; content: string }> } {
  const writes: Array<{ path: string; content: string }> = [];
  const backend = mockWorkspaceBackend({
    rootDir: ROOT,
    writeFile: vi.fn(async (path: string, content: string) => {
      writes.push({ path, content });
    }),
  });
  return { backend, writes };
}

const baseOpts = {
  workspaceDirs: [ROOT],
  executionId: "exec-test",
};

// ── applyApprovedWholeFileWrites ─────────────────────────────────────────────

describe("applyApprovedWholeFileWrites", () => {
  it("writes the EXACT approved bytes to the resolved path and marks the tool COMPLETED", async () => {
    const tc = approvedWrite({ path: "notes.md", contents: "# Notes\n- Planton\n" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: "# Notes\n- Planton\n" }]);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).not.toBe("");
  });

  it("applies the COMPLETE args content verbatim (full-change fidelity regression)", async () => {
    // The gate's args carry the COMPLETE proposed content (stamped from the
    // authoritative hook input via applyGateInput), so exact-apply must land ALL
    // of it — never a partial. This locks that what exact-apply writes equals the
    // approved args content, whatever it contains.
    const complete = "# Notes\n- Planton\n\n## TODO\n- first\n- second\n";
    const tc = approvedWrite({ path: "notes.md", contents: complete });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: complete }]);
    expect(writes[0].content).toContain("## TODO");
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("SAFETY: never writes the elision marker (falls back instead)", async () => {
    // The args content was elided to the marker by the size backstop.
    const tc = approvedWrite({ path: "notes.md", contents: ELISION_MARKER });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("preserves an empty-string write (a legitimately emptied / new empty file)", async () => {
    const tc = approvedWrite({ path: "empty.txt", contents: "" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toEqual([{ path: `${ROOT}/empty.txt`, content: "" }]);
  });

  it("targets a file in a NON-primary workspace root (multi-root)", async () => {
    const otherRoot = "/other";
    const tc = approvedWrite({ path: `${otherRoot}/pkg/x.ts`, contents: "b" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      workspaceDirs: [ROOT, otherRoot],
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes[0].path).toBe(`${otherRoot}/pkg/x.ts`);
  });

  it("refuses a target OUTSIDE every workspace root (falls back, no write)", async () => {
    const tc = approvedWrite({ path: "/etc/passwd", contents: "pwned" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("is idempotent: an already-COMPLETED call is skipped, never written twice", async () => {
    const tc = approvedWrite(
      { path: "notes.md", contents: "done\n" },
      { status: ToolCallStatus.TOOL_CALL_COMPLETED },
    );
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("falls back when the workspace write fails (never silently drops)", async () => {
    const tc = approvedWrite({ path: "notes.md", contents: "x" });
    const backend = mockWorkspaceBackend({
      rootDir: ROOT,
      writeFile: vi.fn(async () => {
        throw new Error("EACCES");
      }),
    });

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("applies an APPROVE_ALL whole-file write too", async () => {
    const tc = approvedWrite(
      { path: "notes.md", contents: "v2\n" },
      { approvalAction: ApprovalAction.APPROVE_ALL },
    );
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toHaveLength(1);
  });

  it("leaves a hunk edit untouched (old_string/new_string stays on the reinvocation path)", async () => {
    const tc = approvedWrite({ path: "notes.md", old_string: "a", new_string: "b" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("leaves a SKIPPED / REJECTED / undecided whole-file write untouched", async () => {
    const skipped = approvedWrite({ path: "a.md", contents: "x" }, { id: "s", approvalAction: ApprovalAction.SKIP });
    const rejected = approvedWrite({ path: "b.md", contents: "x" }, { id: "r", approvalAction: ApprovalAction.REJECT });
    const undecided = approvedWrite({ path: "c.md", contents: "x" }, { id: "u", approvalAction: ApprovalAction.UNSPECIFIED });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(skipped, rejected, undecided),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("leaves a non-file approved tool (shell) untouched", async () => {
    const tc = approvedWrite({ command: "ls" }, { id: "sh", name: "shell" });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("applies only the approved write among a mixed batch, returning just its id", async () => {
    const write = approvedWrite({ path: "notes.md", contents: "new\n" }, { id: "w" });
    const shell = approvedWrite({ command: "ls" }, { id: "sh", name: "shell" });
    const skipped = approvedWrite({ path: "b.md", contents: "x" }, { id: "s", approvalAction: ApprovalAction.SKIP });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(write, shell, skipped),
      workspaceBackend: backend,
    });

    expect(applied).toEqual(new Set(["w"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: "new\n" }]);
  });
});

// ── resolveApprovedWholeFileContent ──────────────────────────────────────────

describe("resolveApprovedWholeFileContent", () => {
  it("reads the whole-file content from args.content", () => {
    const tc = approvedWrite({ file_path: "notes.md", content: "ARGS" });
    expect(resolveApprovedWholeFileContent(tc)).toBe("ARGS");
  });

  it("reads the whole-file content from args.contents", () => {
    const tc = approvedWrite({ file_path: "notes.md", contents: "ARGS-CONTENTS" });
    expect(resolveApprovedWholeFileContent(tc)).toBe("ARGS-CONTENTS");
  });

  it("returns null for an elided marker in args", () => {
    const tc = approvedWrite({ file_path: "notes.md", contents: ELISION_MARKER });
    expect(resolveApprovedWholeFileContent(tc)).toBeNull();
  });

  it("returns null when the args carry no whole-file content (a hunk edit)", () => {
    const tc = approvedWrite({ file_path: "notes.md", old_string: "a", new_string: "b" });
    expect(resolveApprovedWholeFileContent(tc)).toBeNull();
  });

  it("preserves an empty-string content (a legitimately emptied file)", () => {
    const tc = approvedWrite({ file_path: "notes.md", contents: "" });
    expect(resolveApprovedWholeFileContent(tc)).toBe("");
  });
});
