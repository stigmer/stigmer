/**
 * Unit tests for resume-time exact-apply (the HITL "what you approve is what gets
 * applied" guarantee for the Cursor deny-only harness).
 *
 * These pin the load-bearing invariants:
 * - an APPROVED whole-file write is written to disk with the EXACT approved bytes
 *   and its tool call is marked COMPLETED in place;
 * - the content resolver recovers bytes from inline / args / an offloaded ref,
 *   and NEVER writes a truncated preview or the elision marker (which would
 *   silently corrupt the file) — those degrade to a fall back (no write);
 * - everything that is not an approved whole-file write (hunk edits, shell, MCP,
 *   skipped/rejected, already-completed) is left untouched for the existing
 *   grant + reinvocation path;
 * - the apply targets the change's absolutePath (multi-root) and refuses a target
 *   outside the workspace;
 * - the step is idempotent under Temporal activity retries.
 *
 * Deterministic; no Cursor API key. Real-browser/offload-fetch behavior is mocked
 * at the artifact-storage + global fetch boundary.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentMessageSchema,
  ToolCallSchema,
  FileChangeSchema,
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type {
  AgentMessage,
  FileChange,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
  ApprovalAction,
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  applyApprovedWholeFileWrites,
  resolveApprovedWholeFileContent,
} from "../exact-apply.js";
import { buildFileChange } from "../../../shared/file-change.js";
import { ELISION_MARKER } from "../../../shared/status-offload.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import type { ArtifactStorage } from "../../../shared/artifact-storage.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";

const ROOT = "/root";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── builders ─────────────────────────────────────────────────────────────────

function wholeFileChange(after: string | undefined, opts: { path?: string; before?: string } = {}): FileChange {
  const path = opts.path ?? "notes.md";
  return buildFileChange({
    path,
    absolutePath: `${ROOT}/${path}`,
    changeType: opts.before === undefined ? FileChangeType.CREATE : FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: opts.before,
    after,
  });
}

/** A WHOLE_FILE change whose `after` body is an offloaded ref (not inline). */
function offloadedChange(storageKey: string, truncatedPreview: string, path = "big.md"): FileChange {
  const fc = create(FileChangeSchema, {
    path,
    absolutePath: `${ROOT}/${path}`,
    changeType: FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
  });
  fc.after = create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, {
        storageKey,
        sizeBytes: BigInt(999_999),
        contentHash: "deadbeef",
        mimeType: "text/plain",
        isImage: false,
        truncatedPreview,
      }),
    },
  });
  return fc;
}

function approvedEdit(overrides: Partial<ToolCall> = {}): ToolCall {
  return create(ToolCallSchema, {
    id: "tc-1",
    name: "edit",
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    approvalAction: ApprovalAction.APPROVE,
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

function fakeArtifactStorage(downloadUrl: string): ArtifactStorage {
  return {
    upload: vi.fn(async () => ""),
    getDownloadUrl: vi.fn(async () => downloadUrl),
    exists: vi.fn(async () => true),
  };
}

const baseOpts = {
  workspaceDirs: [ROOT],
  executionId: "exec-test",
};

// ── applyApprovedWholeFileWrites ─────────────────────────────────────────────

describe("applyApprovedWholeFileWrites", () => {
  it("writes the EXACT approved bytes to absolutePath and marks the tool COMPLETED", async () => {
    const tc = approvedEdit({
      fileChanges: [wholeFileChange("# Notes\n- Planton\n", { before: "# Notes\n- Planton Cloud\n" })],
    });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: "# Notes\n- Planton\n" }]);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(tc.completedAt).not.toBe("");
    // The approved change stays on the call as the authoritative record.
    expect(tc.fileChanges).toHaveLength(1);
  });

  it("applies the COMPLETE multi-change `after` verbatim (full-change fidelity regression)", async () => {
    // The reported bug: a single turn requested two changes (a rename AND a new
    // `## TODO` section). The gate's `after` is now the COMPLETE content (sourced
    // from the authoritative hook input via applyGateInput), so exact-apply must
    // land BOTH changes — never a partial that drops the TODO. This locks the
    // contract that what exact-apply writes equals the gate's `after`, whatever it
    // contains.
    const complete = "# Notes\n- Planton\n\n## TODO\n- first\n- second\n";
    const tc = approvedEdit({
      fileChanges: [wholeFileChange(complete, { before: "# Notes\n- Planton Cloud\n" })],
    });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: complete }]);
    // Both the rename and the TODO section are present in the landed bytes.
    expect(writes[0].content).toContain("- Planton\n");
    expect(writes[0].content).toContain("## TODO");
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  });

  it("resolves an offloaded `after` ref via getDownloadUrl + fetch, then applies it", async () => {
    const fullBody = "FULL OFFLOADED CONTENT\n".repeat(10_000);
    const store = fakeArtifactStorage("https://artifacts.example/big.md");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => fullBody })),
    );
    const tc = approvedEdit({ fileChanges: [offloadedChange("artifacts/exec/x.after.txt", "PREVIEW HEAD")] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: store,
    });

    expect(store.getDownloadUrl).toHaveBeenCalledWith("artifacts/exec/x.after.txt");
    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toHaveLength(1);
    expect(writes[0].content).toBe(fullBody);
    // SAFETY: it wrote the full body, never the truncated preview.
    expect(writes[0].content).not.toContain("PREVIEW HEAD");
  });

  it("falls back (no write) when an offloaded ref cannot be fetched", async () => {
    const store = fakeArtifactStorage("https://artifacts.example/x");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "" })));
    const tc = approvedEdit({ fileChanges: [offloadedChange("k", "PREVIEW")] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: store,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
    // Left for the grant + reinvocation path.
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("SAFETY: never writes the elision marker (falls back instead)", async () => {
    // after was elided to the marker by the size backstop, and args is absent.
    const tc = approvedEdit({ fileChanges: [wholeFileChange(ELISION_MARKER, { before: "old" })] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("recovers bytes from inline args.content when `after` was offloaded but args survived", async () => {
    const tc = approvedEdit({
      args: { file_path: "notes.md", content: "FROM ARGS\n" },
      fileChanges: [offloadedChange("k", "PREVIEW", "notes.md")],
    });
    const { backend, writes } = recordingBackend();
    // No artifact storage -> the ref cannot be fetched, so args.content is the
    // only resolvable source. It must be used (not the preview).
    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes[0].content).toBe("FROM ARGS\n");
  });

  it("targets a file in a NON-primary workspace root (multi-root)", async () => {
    const otherRoot = "/other";
    const fc = buildFileChange({
      path: "pkg/x.ts",
      absolutePath: `${otherRoot}/pkg/x.ts`,
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: "a",
      after: "b",
    });
    const tc = approvedEdit({ fileChanges: [fc] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      workspaceDirs: [ROOT, otherRoot],
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes[0].path).toBe(`${otherRoot}/pkg/x.ts`);
  });

  it("refuses a target OUTSIDE every workspace root (falls back, no write)", async () => {
    const fc = buildFileChange({
      path: "../../etc/passwd",
      absolutePath: "/etc/passwd",
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      before: "x",
      after: "pwned",
    });
    const tc = approvedEdit({ fileChanges: [fc] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("is idempotent: an already-COMPLETED call is skipped, never written twice", async () => {
    const tc = approvedEdit({
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      fileChanges: [wholeFileChange("done\n", { before: "old" })],
    });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("falls back when the workspace write fails (never silently drops)", async () => {
    const tc = approvedEdit({ fileChanges: [wholeFileChange("x", { before: "y" })] });
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
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("applies an APPROVE_ALL whole-file write too", async () => {
    const tc = approvedEdit({
      approvalAction: ApprovalAction.APPROVE_ALL,
      fileChanges: [wholeFileChange("v2\n", { before: "v1" })],
    });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["tc-1"]));
    expect(writes).toHaveLength(1);
  });

  it("leaves a HUNK_ONLY edit untouched (hunk edits stay on the reinvocation path)", async () => {
    const tc = approvedEdit({
      fileChanges: [
        buildFileChange({
          path: "notes.md",
          absolutePath: `${ROOT}/notes.md`,
          changeType: FileChangeType.MODIFY,
          captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
          unifiedDiff: "@@ -1 +1 @@\n-a\n+b",
        }),
      ],
    });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
    expect(tc.status).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  });

  it("leaves a SKIPPED / REJECTED / undecided whole-file write untouched", async () => {
    const skipped = approvedEdit({ id: "s", approvalAction: ApprovalAction.SKIP, fileChanges: [wholeFileChange("x", { before: "y" })] });
    const rejected = approvedEdit({ id: "r", approvalAction: ApprovalAction.REJECT, fileChanges: [wholeFileChange("x", { before: "y" })] });
    const undecided = approvedEdit({ id: "u", approvalAction: ApprovalAction.UNSPECIFIED, fileChanges: [wholeFileChange("x", { before: "y" })] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(skipped, rejected, undecided),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("leaves a non-file approved tool (shell) untouched", async () => {
    const tc = approvedEdit({ id: "sh", name: "shell", args: { command: "ls" } });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(tc),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied.size).toBe(0);
    expect(writes).toHaveLength(0);
  });

  it("applies only the approved write among a mixed batch, returning just its id", async () => {
    const write = approvedEdit({ id: "w", fileChanges: [wholeFileChange("new\n", { before: "old" })] });
    const shell = approvedEdit({ id: "sh", name: "shell", args: { command: "ls" } });
    const skipped = approvedEdit({ id: "s", approvalAction: ApprovalAction.SKIP, fileChanges: [wholeFileChange("x", { before: "y", path: "b.md" })] });
    const { backend, writes } = recordingBackend();

    const applied = await applyApprovedWholeFileWrites({
      ...baseOpts,
      messages: messagesOf(write, shell, skipped),
      workspaceBackend: backend,
      artifactStorage: undefined,
    });

    expect(applied).toEqual(new Set(["w"]));
    expect(writes).toEqual([{ path: `${ROOT}/notes.md`, content: "new\n" }]);
  });
});

// ── resolveApprovedWholeFileContent ──────────────────────────────────────────

describe("resolveApprovedWholeFileContent", () => {
  it("prefers the inline after body", async () => {
    const tc = approvedEdit({ args: { file_path: "notes.md", content: "ARGS" } });
    const fc = wholeFileChange("INLINE", { before: "x" });
    expect(await resolveApprovedWholeFileContent(tc, fc, undefined)).toBe("INLINE");
  });

  it("falls to inline args.content when after is absent", async () => {
    const tc = approvedEdit({ args: { file_path: "notes.md", contents: "ARGS-CONTENTS" } });
    const fc = create(FileChangeSchema, {
      path: "notes.md",
      absolutePath: `${ROOT}/notes.md`,
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    });
    expect(await resolveApprovedWholeFileContent(tc, fc, undefined)).toBe("ARGS-CONTENTS");
  });

  it("returns null for an elided inline after with no args", async () => {
    const tc = approvedEdit();
    const fc = wholeFileChange(ELISION_MARKER, { before: "x" });
    expect(await resolveApprovedWholeFileContent(tc, fc, undefined)).toBeNull();
  });

  it("returns null when nothing is resolvable", async () => {
    const tc = approvedEdit();
    const fc = create(FileChangeSchema, {
      path: "notes.md",
      absolutePath: `${ROOT}/notes.md`,
      changeType: FileChangeType.MODIFY,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    });
    expect(await resolveApprovedWholeFileContent(tc, fc, undefined)).toBeNull();
  });

  it("preserves an empty-string after (a legitimately emptied file)", async () => {
    const tc = approvedEdit();
    const fc = wholeFileChange("", { before: "had content" });
    expect(await resolveApprovedWholeFileContent(tc, fc, undefined)).toBe("");
  });
});
