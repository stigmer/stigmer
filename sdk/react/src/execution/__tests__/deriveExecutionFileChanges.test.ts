import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  FileChangeSchema,
  FileContentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
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
import {
  deriveExecutionFileChanges,
  toFileDiffEntry,
} from "../deriveExecutionFileChanges";

// ---------------------------------------------------------------------------
// Fixtures — CapturedFileChange only (apply-then-review ledger; see the
// sibling useSessionFileChanges suite, which covers the session-wrapper
// behavior over the same core).
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
function execWithProjection(
  id: string,
  changes: CapturedFileChange[],
): AgentExecution {
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
function execWithLedger(
  id: string,
  changes: CapturedFileChange[],
): AgentExecution {
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
          value: create(FileReviewCandidateCapturedSchema, {
            changeSetId,
            changes,
          }),
        },
      }),
    ],
  });
  return exec;
}

function inlineText(side: { body: { case?: string; value?: unknown } } | undefined) {
  return side?.body.case === "inline" ? side.body.value : undefined;
}

// ---------------------------------------------------------------------------
// deriveExecutionFileChanges — the cross-EXECUTION semantics. Same-execution
// net-collapse cases (create-then-delete, rename, sorting, …) are covered by
// the useSessionFileChanges suite, which delegates to this core.
// ---------------------------------------------------------------------------

describe("deriveExecutionFileChanges", () => {
  it("returns empty for no executions", () => {
    expect(deriveExecutionFileChanges([])).toEqual([]);
  });

  it("net-diffs the same path ACROSS executions: first execution's before -> last execution's after", () => {
    // The workflow case: two agent-call children touching one file.
    const r = deriveExecutionFileChanges([
      execWithLedger("aex_1", [
        captured({ id: "fc1", pathAfter: "src/shared.ts", before: "v0", after: "v1" }),
      ]),
      execWithLedger("aex_2", [
        captured({ id: "fc2", pathAfter: "src/shared.ts", before: "v1", after: "v2" }),
      ]),
    ]);
    expect(r).toHaveLength(1);
    expect(inlineText(r[0].before)).toBe("v0");
    expect(inlineText(r[0].after)).toBe("v2");
    expect(r[0].changeType).toBe(FileChangeType.MODIFY);
  });

  it("anchors the net diff on INPUT order — reversed executions produce the reversed anchors (chronology is a correctness input)", () => {
    const first = execWithLedger("aex_1", [
      captured({ id: "fc1", pathAfter: "src/shared.ts", before: "v0", after: "v1" }),
    ]);
    const second = execWithLedger("aex_2", [
      captured({ id: "fc2", pathAfter: "src/shared.ts", before: "v1", after: "v2" }),
    ]);

    const reversed = deriveExecutionFileChanges([second, first]);
    expect(inlineText(reversed[0].before)).toBe("v1");
    expect(inlineText(reversed[0].after)).toBe("v1");
  });

  it("reconciles create (execution 1) then delete (execution 2) to DELETE across the span", () => {
    const r = deriveExecutionFileChanges([
      execWithLedger("aex_1", [
        captured({ id: "fc1", pathAfter: "src/tmp.ts", after: "scratch", kind: FileChangeKind.ADD }),
      ]),
      execWithLedger("aex_2", [
        captured({ id: "fc2", pathBefore: "src/tmp.ts", pathAfter: "src/tmp.ts", before: "scratch", kind: FileChangeKind.DELETE }),
      ]),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].changeType).toBe(FileChangeType.DELETE);
  });

  it("mixes projection (live child) and ledger (terminal child) sources in one rollup", () => {
    const r = deriveExecutionFileChanges([
      execWithLedger("aex_done", [
        captured({ id: "fc1", pathAfter: "src/a.ts", before: "a", after: "b" }),
      ]),
      execWithProjection("aex_live", [
        captured({ id: "fc2", pathAfter: "src/b.ts", before: "x", after: "y" }),
      ]),
    ]);
    expect(r.map((c) => c.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("keeps distinct paths from distinct executions distinct", () => {
    const r = deriveExecutionFileChanges([
      execWithLedger("aex_1", [
        captured({ id: "fc1", pathAfter: "src/one.ts", before: "a", after: "b" }),
      ]),
      execWithLedger("aex_2", [
        captured({ id: "fc2", pathAfter: "src/two.ts", before: "c", after: "d" }),
      ]),
    ]);
    expect(r).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// toFileDiffEntry — the FileChange → FileDiffEntry projection
// ---------------------------------------------------------------------------

describe("toFileDiffEntry", () => {
  it("maps change types to the file-list vocabulary", () => {
    const of = (changeType: FileChangeType) =>
      toFileDiffEntry(create(FileChangeSchema, { path: "p", changeType }));
    expect(of(FileChangeType.CREATE).changeType).toBe("added");
    expect(of(FileChangeType.DELETE).changeType).toBe("removed");
    expect(of(FileChangeType.MODIFY).changeType).toBe("modified");
    expect(of(FileChangeType.RENAME).changeType).toBe("modified");
  });

  it("uses the runner's authoritative counts for hunk-only captures", () => {
    const entry = toFileDiffEntry(
      create(FileChangeSchema, {
        path: "src/a.ts",
        changeType: FileChangeType.MODIFY,
        captureLevel: FileChangeCaptureLevel.HUNK_ONLY,
        unifiedDiff: "@@ -1 +1 @@\n-a\n+b",
        linesAdded: 3,
        linesRemoved: 2,
      }),
    );
    expect(entry.additions).toBe(3);
    expect(entry.deletions).toBe(2);
  });

  it("derives counts from inline whole-file content", () => {
    const entry = toFileDiffEntry(
      create(FileChangeSchema, {
        path: "src/a.ts",
        changeType: FileChangeType.MODIFY,
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
        before: inlineSide("line1\nline2\n"),
        after: inlineSide("line1\nline2 changed\nline3\n"),
      }),
    );
    expect(entry.additions).toBe(2);
    expect(entry.deletions).toBe(1);
  });

  it("falls back to capture-time counts when a whole-file side is offloaded", () => {
    const entry = toFileDiffEntry(
      create(FileChangeSchema, {
        path: "src/big.ts",
        changeType: FileChangeType.MODIFY,
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
        before: create(FileContentSchema, {
          body: {
            case: "ref",
            value: { storageKey: "artifacts/aex_1/before", contentHash: "h1" },
          },
        }),
        after: inlineSide("new"),
        linesAdded: 10,
        linesRemoved: 4,
      }),
    );
    expect(entry.additions).toBe(10);
    expect(entry.deletions).toBe(4);
  });
});
