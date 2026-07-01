import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
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
//
// Under apply-then-review the hook sources exclusively from the file-review
// ledger (the live `file_change_sets` projection, or the folded
// `file_review_event_stream` for a terminal execution). The tool-call-coupled
// `ToolCall.file_changes` (message.proto field 22) was removed in Phase 5
// Slice 4, so every fixture here is a CapturedFileChange.
// ---------------------------------------------------------------------------

function inlineSide(value: string) {
  return create(FileContentSchema, { body: { case: "inline", value } });
}

function captured(opts: {
  id: string;
  pathBefore?: string;
  pathAfter?: string;
  before?: string;
  after?: string;
  kind?: FileChangeKind;
}): CapturedFileChange {
  const pathBefore = opts.pathBefore ?? opts.pathAfter ?? "";
  const pathAfter = opts.pathAfter ?? opts.pathBefore ?? "";
  return create(CapturedFileChangeSchema, {
    id: opts.id,
    pathBefore,
    pathAfter,
    kind: opts.kind ?? FileChangeKind.MODIFY,
    before: opts.before !== undefined ? inlineSide(opts.before) : undefined,
    after: opts.after !== undefined ? inlineSide(opts.after) : undefined,
    diffComplete: true,
  });
}

function execWith(id: string): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema);
  return exec;
}

/** An execution carrying a live server projection of one change set. */
function execWithProjection(id: string, changes: CapturedFileChange[]): AgentExecution {
  const exec = execWith(id);
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
  const exec = execWith(id);
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

function run(executions: readonly AgentExecution[]) {
  return renderHook(() => useSessionFileChanges(executions)).result.current;
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

  it("returns empty when an execution has no file-review changes", () => {
    const r = run([execWith("e1")]);
    expect(r.hasFileChanges).toBe(false);
  });

  it("collects a single change from the live projection", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "a", after: "b" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/a.ts");
    expect(r.fileChanges[0].captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
  });

  it("collects changes from the durable ledger for a terminal execution", () => {
    const r = run([
      execWithLedger("e1", [
        captured({ id: "fc1", pathAfter: "src/term.ts", before: "a", after: "b" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].path).toBe("src/term.ts");
  });

  it("net-diffs multiple edits to the same path: first.before -> last.after", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "v0", after: "v1" }),
        captured({ id: "fc2", pathAfter: "src/a.ts", before: "v1", after: "v2" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("reconciles create-then-modify on the same path to CREATE", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/new.ts", after: "first", kind: FileChangeKind.ADD }),
        captured({ id: "fc2", pathAfter: "src/new.ts", before: "first", after: "second", kind: FileChangeKind.MODIFY }),
      ]),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.CREATE);
    expect(r.fileChanges[0].after?.body.case === "inline" && r.fileChanges[0].after.body.value).toBe("second");
  });

  it("reconciles modify-then-delete on the same path to DELETE", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/x.ts", before: "a", after: "b" }),
        captured({ id: "fc2", pathBefore: "src/x.ts", pathAfter: "src/x.ts", before: "b", kind: FileChangeKind.DELETE }),
      ]),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("reconciles create-then-delete on the same path to DELETE (path is not hidden)", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/tmp.ts", after: "scratch", kind: FileChangeKind.ADD }),
        captured({ id: "fc2", pathBefore: "src/tmp.ts", pathAfter: "src/tmp.ts", before: "scratch", kind: FileChangeKind.DELETE }),
      ]),
    ]);
    // A file created and removed within one session still surfaces, as a DELETE
    // anchored on the first change's (empty) before — it is not silently dropped.
    expect(r.fileChangeCount).toBe(1);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("reconciles rename-then-modify on the same path to RENAME, preserving rename_from", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathBefore: "src/old-name.ts", pathAfter: "src/new-name.ts", before: "a", after: "a", kind: FileChangeKind.RENAME }),
        captured({ id: "fc2", pathAfter: "src/new-name.ts", before: "a", after: "b", kind: FileChangeKind.MODIFY }),
      ]),
    ]);
    expect(r.fileChanges[0].changeType).toBe(FileChangeType.RENAME);
    expect(r.fileChanges[0].renameFrom).toBe("src/old-name.ts");
    expect(r.fileChanges[0].after?.body.case === "inline" && r.fileChanges[0].after.body.value).toBe("b");
  });

  it("groups changes across change sets by path (the execution-scoped ledger covers sub-agents)", () => {
    const exec = execWith("e1");
    exec.status!.fileChangeSets = [
      create(FileChangeSetSchema, {
        id: "e1:0",
        status: FileChangeSetStatus.RECONCILED,
        changes: [captured({ id: "fc1", pathAfter: "src/shared.ts", before: "v0", after: "v1" })],
      }),
      create(FileChangeSetSchema, {
        id: "e1:1",
        status: FileChangeSetStatus.AWAITING_REVIEW,
        changes: [captured({ id: "fc2", pathAfter: "src/shared.ts", before: "v1", after: "v2" })],
      }),
    ];
    const r = run([exec]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("passes a single change through with its bytes intact (no synthesis)", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "a", after: "b" }),
      ]),
    ]);
    expect(r.fileChangeCount).toBe(1);
    const only = r.fileChanges[0];
    expect(only.path).toBe("src/a.ts");
    expect(only.before?.body.case === "inline" && only.before.body.value).toBe("a");
    expect(only.after?.body.case === "inline" && only.after.body.value).toBe("b");
  });

  it("sorts modified before created/renamed before deleted, then alpha", () => {
    const r = run([
      execWithProjection("e1", [
        captured({ id: "fc1", pathBefore: "z-del.ts", pathAfter: "z-del.ts", before: "x", kind: FileChangeKind.DELETE }),
        captured({ id: "fc2", pathAfter: "a-new.ts", after: "x", kind: FileChangeKind.ADD }),
        captured({ id: "fc3", pathAfter: "m-mod.ts", before: "x", after: "y", kind: FileChangeKind.MODIFY }),
        captured({ id: "fc4", pathAfter: "b-mod.ts", before: "x", after: "y", kind: FileChangeKind.MODIFY }),
      ]),
    ]);
    expect(r.fileChanges.map((c) => c.path)).toEqual([
      "b-mod.ts",
      "m-mod.ts",
      "a-new.ts",
      "z-del.ts",
    ]);
  });

  it("net-diffs captures across turns from the ledger", () => {
    // Two change sets touching the same path: first.before -> last.after.
    const exec = execWith("e1");
    exec.status!.fileChangeSets = [
      create(FileChangeSetSchema, {
        id: "e1:0",
        status: FileChangeSetStatus.RECONCILED,
        changes: [captured({ id: "fc1", pathAfter: "src/a.ts", before: "v0", after: "v1" })],
      }),
      create(FileChangeSetSchema, {
        id: "e1:1",
        status: FileChangeSetStatus.AWAITING_REVIEW,
        changes: [captured({ id: "fc2", pathAfter: "src/a.ts", before: "v1", after: "v2" })],
      }),
    ];
    const r = run([exec]);
    expect(r.fileChangeCount).toBe(1);
    const net = r.fileChanges[0];
    expect(net.before?.body.case === "inline" && net.before.body.value).toBe("v0");
    expect(net.after?.body.case === "inline" && net.after.body.value).toBe("v2");
  });

  it("preserves referential stability across re-renders for the same executions", () => {
    const executions = [
      execWithProjection("e1", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "a", after: "b" }),
      ]),
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
