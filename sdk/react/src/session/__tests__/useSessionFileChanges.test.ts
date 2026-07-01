import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  FileChangeSchema,
  FileContentSchema,
  type FileChange,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileReviewBaselineCapturedSchema,
  FileReviewCandidateCapturedSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
  type CapturedFileChange,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  ExecutionPhase,
  FileChangeCaptureLevel,
  FileChangeKind,
  FileChangeSetStatus,
  FileChangeType,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useSessionFileChanges } from "../useSessionFileChanges";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function inlineSide(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function wholeFile(opts: {
  path: string;
  before?: string;
  after?: string;
  changeType?: FileChangeType;
  renameFrom?: string;
}): FileChange {
  return create(FileChangeSchema, {
    path: opts.path,
    changeType: opts.changeType ?? FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: opts.before !== undefined ? inlineSide(opts.before) : undefined,
    after: opts.after !== undefined ? inlineSide(opts.after) : undefined,
    renameFrom: opts.renameFrom ?? "",
  });
}

function hunkOnly(opts: {
  path: string;
  unifiedDiff: string;
  linesAdded: number;
  linesRemoved: number;
  changeType?: FileChangeType;
}): FileChange {
  return create(FileChangeSchema, {
    path: opts.path,
    changeType: opts.changeType ?? FileChangeType.MODIFY,
    captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
    unifiedDiff: opts.unifiedDiff,
    linesAdded: opts.linesAdded,
    linesRemoved: opts.linesRemoved,
  });
}

function toolCallWith(id: string, changes: FileChange[]): ToolCall {
  return create(ToolCallSchema, { id, name: "edit_file", fileChanges: changes });
}

function execWith(opts: {
  id: string;
  toolCalls?: ToolCall[];
  subAgentToolCalls?: ToolCall[];
}): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id: opts.id });
  const status = create(AgentExecutionStatusSchema);
  if (opts.toolCalls) {
    status.messages = [
      create(AgentMessageSchema, { toolCalls: opts.toolCalls }),
    ];
  }
  if (opts.subAgentToolCalls) {
    status.subAgentExecutions = [
      create(SubAgentExecutionSchema, {
        id: "sub-1",
        messages: [
          create(AgentMessageSchema, { toolCalls: opts.subAgentToolCalls }),
        ],
      }),
    ];
  }
  exec.status = status;
  return exec;
}

function run(executions: readonly AgentExecution[]) {
  return renderHook(() => useSessionFileChanges(executions)).result.current;
}

// --- File-review ledger fixtures (the primary, capture-mode source) ----------

function capturedWhole(opts: {
  id: string;
  path: string;
  before?: string;
  after?: string;
  kind?: FileChangeKind;
}): CapturedFileChange {
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore: opts.path,
    pathAfter: opts.path,
    kind: opts.kind ?? FileChangeKind.MODIFY,
    before: opts.before !== undefined ? inlineSide(opts.before) : undefined,
    after: opts.after !== undefined ? inlineSide(opts.after) : undefined,
    diffComplete: true,
  });
}

/** An execution carrying a live server projection of one change set. */
function execWithProjection(id: string, changes: CapturedFileChange[]): AgentExecution {
  const exec = execWith({ id });
  exec.status!.fileChangeSets = [
    create(FileChangeSetSchema, {
      id: `${id}:0`,
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes,
    }),
  ];
  return exec;
}

/** A terminal execution: empty projection, changes only in the durable ledger. */
function execWithLedger(id: string, changes: CapturedFileChange[]): AgentExecution {
  const exec = execWith({ id });
  exec.status!.phase = ExecutionPhase.EXECUTION_COMPLETED;
  exec.status!.fileChangeSets = [];
  const changeSetId = `${id}:0`;
  exec.status!.fileReviewEventStream = create(FileReviewEventStreamSchema, {
    executionId: id,
    events: [
      create(FileReviewEventSchema, {
        changeSetId,
        eventType: FileReviewEventType.BASELINE_CAPTURED,
        payload: {
          case: "baselineCaptured",
          value: create(FileReviewBaselineCapturedSchema, { changeSetId }),
        },
      }),
      create(FileReviewEventSchema, {
        changeSetId,
        eventType: FileReviewEventType.CANDIDATE_CAPTURED,
        payload: {
          case: "candidateCaptured",
          value: create(FileReviewCandidateCapturedSchema, { changeSetId, changes }),
        },
      }),
    ],
  });
  return exec;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSessionFileChanges", () => {
  it("returns empty for no executions", () => {
    const r = run([]);
    expect(r.hasFileChanges).toBe(false);
    expect(r.fileChangeCount).toBe(0);
    expect(r.fileChanges).toEqual([]);
  });

  it("returns empty when executions have no file changes", () => {
    const r = run([execWith({ id: "e1", toolCalls: [toolCallWith("tc1", [])] })]);
    expect(r.hasFileChanges).toBe(false);
  });

  it("collects a single change from a main-thread tool call", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "a", after: "b" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/a.ts");
  });

  it("collects changes nested in sub-agent tool calls", () => {
    const r = run([
      execWith({
        id: "e1",
        subAgentToolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/sub.ts", before: "x", after: "y" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/sub.ts");
  });

  it("net-diffs multiple edits to the same path: first.before -> last.after", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "v0", after: "v1" })]),
          toolCallWith("tc2", [wholeFile({ path: "src/a.ts", before: "v1", after: "v2" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("reconciles create-then-modify on the same path to CREATE", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "src/new.ts", after: "first", changeType: FileChangeType.CREATE }),
          ]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/new.ts", before: "first", after: "second", changeType: FileChangeType.MODIFY }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.CREATE);
    expect(r.fileChanges[0].after?.body.case === "inline" && r.fileChanges[0].after.body.value).toBe("second");
  });

  it("reconciles modify-then-delete on the same path to DELETE", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/x.ts", before: "a", after: "b" })]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/x.ts", before: "b", changeType: FileChangeType.DELETE }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("reconciles create-then-delete on the same path to DELETE (path is not hidden)", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "src/tmp.ts", after: "scratch", changeType: FileChangeType.CREATE }),
          ]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/tmp.ts", before: "scratch", changeType: FileChangeType.DELETE }),
          ]),
        ],
      }),
    ]);
    // A file created and removed within one session still surfaces, as a DELETE
    // anchored on the first change's (empty) before — it is not silently dropped.
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("reconciles rename-then-modify on the same path to RENAME, preserving rename_from", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "src/new-name.ts", before: "a", after: "a", changeType: FileChangeType.RENAME, renameFrom: "src/old-name.ts" }),
          ]),
          toolCallWith("tc2", [
            wholeFile({ path: "src/new-name.ts", before: "a", after: "b", changeType: FileChangeType.MODIFY }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.RENAME);
    expect(r.fileChanges[0].renameFrom).toBe("src/old-name.ts");
    expect(r.fileChanges[0].after?.body.case === "inline" && r.fileChanges[0].after.body.value).toBe("b");
  });

  it("groups across main thread and sub-agents by path", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/shared.ts", before: "v0", after: "v1" })]),
        ],
        subAgentToolCalls: [
          toolCallWith("tc2", [wholeFile({ path: "src/shared.ts", before: "v1", after: "v2" })]),
        ],
      }),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("falls back to HUNK_ONLY when net sides are not both whole-file", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            hunkOnly({ path: "src/h.ts", unifiedDiff: "@@ -1 +1 @@\n-a\n+b", linesAdded: 1, linesRemoved: 1 }),
          ]),
          toolCallWith("tc2", [
            hunkOnly({ path: "src/h.ts", unifiedDiff: "@@ -1 +1 @@\n-b\n+c", linesAdded: 2, linesRemoved: 1 }),
          ]),
        ],
      }),
    ]);
    const net = r.fileChanges[0];
    expect(net.captureLevel).toBe(FileChangeCaptureLevel.HUNK_ONLY);
    expect(net.unifiedDiff).toBe("@@ -1 +1 @@\n-b\n+c");
    expect(net.linesAdded).toBe(2);
  });

  it("passes through a single change untouched (no synthesis)", () => {
    const original = wholeFile({ path: "src/a.ts", before: "a", after: "b" });
    const r = run([
      execWith({ id: "e1", toolCalls: [toolCallWith("tc1", [original])] }),
    ]);
    expect(r.fileChanges[0]).toBe(original);
  });

  it("sorts modified before created/renamed before deleted, then alpha", () => {
    const r = run([
      execWith({
        id: "e1",
        toolCalls: [
          toolCallWith("tc1", [
            wholeFile({ path: "z-del.ts", before: "x", changeType: FileChangeType.DELETE }),
            wholeFile({ path: "a-new.ts", after: "x", changeType: FileChangeType.CREATE }),
            wholeFile({ path: "m-mod.ts", before: "x", after: "y", changeType: FileChangeType.MODIFY }),
            wholeFile({ path: "b-mod.ts", before: "x", after: "y", changeType: FileChangeType.MODIFY }),
          ]),
        ],
      }),
    ]);
    expect(r.fileChanges.map((c) => c.path)).toEqual([
      "b-mod.ts",
      "m-mod.ts",
      "a-new.ts",
      "z-del.ts",
    ]);
  });

  it("sources changes from the live file-review projection (CapturedFileChange)", () => {
    const r = run([
      execWithProjection("e1", [
        capturedWhole({ id: "fc1", path: "src/led.ts", before: "a", after: "b" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/led.ts");
    expect(r.fileChanges[0].captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
  });

  it("folds the durable ledger for a terminal execution (empty projection)", () => {
    const r = run([
      execWithLedger("e1", [
        capturedWhole({ id: "fc1", path: "src/term.ts", before: "a", after: "b" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/term.ts");
  });

  it("net-diffs captures across turns from the ledger just like legacy edits", () => {
    // Two change sets touching the same path: first.before -> last.after.
    const exec = execWith({ id: "e1" });
    exec.status!.fileChangeSets = [
      create(FileChangeSetSchema, {
        id: "e1:0",
        status: FileChangeSetStatus.RECONCILED,
        changes: [capturedWhole({ id: "fc1", path: "src/a.ts", before: "v0", after: "v1" })],
      }),
      create(FileChangeSetSchema, {
        id: "e1:1",
        status: FileChangeSetStatus.AWAITING_REVIEW,
        changes: [capturedWhole({ id: "fc2", path: "src/a.ts", before: "v1", after: "v2" })],
      }),
    ];
    const r = run([exec]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("prefers the ledger and ignores stray legacy field-22 for a capture-mode execution", () => {
    const exec = execWithProjection("e1", [
      capturedWhole({ id: "fc1", path: "src/led.ts", before: "a", after: "b" }),
    ]);
    // A stray legacy tool-call change must NOT be double-counted alongside the ledger.
    exec.status!.messages = [
      create(AgentMessageSchema, {
        toolCalls: [
          toolCallWith("tc1", [wholeFile({ path: "src/legacy.ts", before: "a", after: "b" })]),
        ],
      }),
    ];
    const r = run([exec]);
    expect(r.fileChanges.map((c) => c.path)).toEqual(["src/led.ts"]);
  });

  it("preserves referential stability across re-renders for the same executions", () => {
    const executions = [
      execWith({
        id: "e1",
        toolCalls: [toolCallWith("tc1", [wholeFile({ path: "src/a.ts", before: "a", after: "b" })])],
      }),
    ];
    const { result, rerender } = renderHook(
      (e: readonly AgentExecution[]) => useSessionFileChanges(e),
      { initialProps: executions },
    );
    const first = result.current;
    rerender(executions);
    expect(result.current).toBe(first);
  });
});
