import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
  type FileDecision,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  DiffCompleteness,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewBlockReason,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  changeForRowPath,
  changeSetReviewability,
  deriveEffectiveVerdicts,
  fileReviewability,
  fileReviewRowState,
} from "../file-review-status";

/** Inline text side (the git substrate's shape). */
function inline(value: string, isBinary = false): FileContent {
  return create(FileContentSchema, { body: { case: "inline", value }, isBinary });
}

/** Offloaded blob-ref side (large/CAS bodies), carrying its own is_binary. */
function ref(isBinary: boolean): FileContent {
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, {
        storageKey: "artifacts/x/filereview/c.after.txt",
        sizeBytes: 1_048_576n,
        contentHash: "sha256:deadbeef",
      }),
    },
    isBinary,
  });
}

function change(opts: {
  kind?: FileChangeKind;
  diffComplete: boolean;
  before?: FileContent;
  after?: FileContent;
  blockedReason?: FileReviewBlockReason;
}) {
  const fc = create(CapturedFileChangeSchema, {
    id: "cs:0:p",
    pathBefore: "p",
    pathAfter: "p",
    kind: opts.kind ?? FileChangeKind.MODIFY,
    diffComplete: opts.diffComplete,
    blockedReason: opts.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
  });
  if (opts.before) fc.before = opts.before;
  if (opts.after) fc.after = opts.after;
  return fc;
}

describe("fileReviewability", () => {
  it("classifies a complete text diff as reviewable", () => {
    expect(
      fileReviewability(
        change({ diffComplete: true, before: inline("old\n"), after: inline("new\n") }),
      ),
    ).toEqual({ kind: "reviewable" });
  });

  it("stays reviewable when complete even if a side is (incongruously) flagged binary — diff_complete wins", () => {
    // diff_complete is the authoritative signal; a complete change is reviewable.
    expect(
      fileReviewability(
        change({ diffComplete: true, before: inline("a", true), after: inline("b", true) }),
      ),
    ).toEqual({ kind: "reviewable" });
  });

  it("classifies an incomplete change with a binary before side as binary", () => {
    expect(
      fileReviewability(
        change({ diffComplete: false, before: inline("\u0000\u0001", true), after: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("classifies an incomplete change with only an after binary side as binary", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: inline("\u0000", true) })),
    ).toEqual({ kind: "binary" });
  });

  it("classifies a binary side that was offloaded to a ref as binary (offload preserves is_binary)", () => {
    expect(
      fileReviewability(change({ diffComplete: false, after: ref(true) })),
    ).toEqual({ kind: "binary" });
  });

  it("prefers binary over a stray blocked_reason (is_binary is the authoritative binary signal)", () => {
    // Defensive: even if a reason were somehow set on a binary change, the wire
    // proves binary via is_binary, which the classifier resolves first.
    expect(
      fileReviewability(
        change({
          diffComplete: false,
          after: inline("\u0000", true),
          blockedReason: FileReviewBlockReason.SIZE_ELIDED,
        }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("classifies a secret-withheld change as unavailable with reason 'secret' (doc 15)", () => {
    // The secret gate authors the change content-less, diff_complete=false, and
    // records SECRET_WITHHELD so the UI can say *why*.
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD }),
      ),
    ).toEqual({ kind: "unavailable", reason: "secret" });
  });

  it("classifies a size-elided change as unavailable with reason 'size' — distinct from secret (doc 15)", () => {
    // The size backstop drops the inline bodies, sets diff_complete=false, and
    // records SIZE_ELIDED. Once byte-identical to the secret case; now honestly
    // distinguished by the recorded reason.
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.SIZE_ELIDED }),
      ),
    ).toEqual({ kind: "unavailable", reason: "size" });
  });

  it("classifies a content-less change with no recorded reason as unavailable/'unknown'", () => {
    // Historical rows (pre doc 15) and any future/unmapped cause fall back to the
    // defensive generic bucket rather than fabricating a specific cause.
    expect(fileReviewability(change({ diffComplete: false }))).toEqual({
      kind: "unavailable",
      reason: "unknown",
    });
  });

  it("maps the generic UNREVIEWABLE reason to 'unknown'", () => {
    expect(
      fileReviewability(
        change({ diffComplete: false, blockedReason: FileReviewBlockReason.UNREVIEWABLE }),
      ),
    ).toEqual({ kind: "unavailable", reason: "unknown" });
  });

  it("does not misread a one-sided binary ADD as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.ADD, diffComplete: false, after: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });

  it("does not misread a one-sided binary DELETE as unavailable", () => {
    expect(
      fileReviewability(
        change({ kind: FileChangeKind.DELETE, diffComplete: false, before: inline("\u0000", true) }),
      ),
    ).toEqual({ kind: "binary" });
  });
});

describe("changeSetReviewability", () => {
  function set(completeness: DiffCompleteness) {
    return create(FileChangeSetSchema, { id: "cs", diffCompleteness: completeness });
  }

  it("maps the server rollup to the set-level verdict", () => {
    expect(changeSetReviewability(set(DiffCompleteness.COMPLETE))).toBe("complete");
    expect(changeSetReviewability(set(DiffCompleteness.BINARY_SUMMARY_ONLY))).toBe("binary-only");
    expect(changeSetReviewability(set(DiffCompleteness.PARTIAL_BLOCKED))).toBe("blocked");
  });

  it("treats UNSPECIFIED as blocked (fail-closed)", () => {
    expect(changeSetReviewability(set(DiffCompleteness.UNSPECIFIED))).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Effective verdicts + the stamped row's badge state
// ---------------------------------------------------------------------------

function fileChange(id: string, path: string) {
  return create(CapturedFileChangeSchema, {
    id,
    pathBefore: path,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    diffComplete: true,
  });
}

function decision(opts: {
  scope: FileDecisionScope;
  action: FileDecisionAction;
  fileChangeId?: string;
}): FileDecision {
  return create(FileDecisionSchema, {
    changeSetId: "cs:0",
    scope: opts.scope,
    action: opts.action,
    fileChangeId: opts.fileChangeId ?? "",
  });
}

function reviewSet(opts: {
  status: FileChangeSetStatus;
  changes?: ReturnType<typeof fileChange>[];
  decisions?: FileDecision[];
}) {
  return create(FileChangeSetSchema, {
    id: "cs:0",
    status: opts.status,
    changes: opts.changes ?? [fileChange("cs:0:a.ts", "a.ts")],
    decisions: opts.decisions ?? [],
  });
}

describe("deriveEffectiveVerdicts", () => {
  it("applies a CHANGE_SET decision to every file (a settled 'Keep all')", () => {
    const set = reviewSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [fileChange("f1", "a.ts"), fileChange("f2", "b.ts")],
      decisions: [decision({ scope: FileDecisionScope.CHANGE_SET, action: FileDecisionAction.APPROVE })],
    });
    const verdicts = deriveEffectiveVerdicts(set);
    expect(verdicts.get("f1")).toBe(FileDecisionAction.APPROVE);
    expect(verdicts.get("f2")).toBe(FileDecisionAction.APPROVE);
  });

  it("lets a FILE decision override the CHANGE_SET baseline (most-specific-wins)", () => {
    const set = reviewSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [fileChange("f1", "a.ts"), fileChange("f2", "b.ts")],
      decisions: [
        decision({ scope: FileDecisionScope.FILE, action: FileDecisionAction.REJECT, fileChangeId: "f2" }),
        decision({ scope: FileDecisionScope.CHANGE_SET, action: FileDecisionAction.APPROVE }),
      ],
    });
    const verdicts = deriveEffectiveVerdicts(set);
    expect(verdicts.get("f1")).toBe(FileDecisionAction.APPROVE);
    // FILE beats CHANGE_SET regardless of ledger order.
    expect(verdicts.get("f2")).toBe(FileDecisionAction.REJECT);
  });

  it("leaves an undecided file absent (a set terminated mid-review)", () => {
    const set = reviewSet({
      status: FileChangeSetStatus.DECIDED,
      changes: [fileChange("f1", "a.ts"), fileChange("f2", "b.ts")],
      decisions: [decision({ scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "f1" })],
    });
    const verdicts = deriveEffectiveVerdicts(set);
    expect(verdicts.get("f1")).toBe(FileDecisionAction.APPROVE);
    expect(verdicts.has("f2")).toBe(false);
  });
});

describe("changeForRowPath", () => {
  const set = reviewSet({
    status: FileChangeSetStatus.AWAITING_REVIEW,
    changes: [fileChange("f1", "src/a.ts")],
  });

  it("matches an exact workspace-relative path", () => {
    expect(changeForRowPath(set, "src/a.ts")?.id).toBe("f1");
  });

  it("matches an absolute row path by /-boundary suffix", () => {
    expect(changeForRowPath(set, "/home/user/ws/src/a.ts")?.id).toBe("f1");
    // A partial-segment overlap is NOT a match.
    expect(changeForRowPath(set, "othersrc/a.ts")).toBeNull();
  });

  it("returns null for an unknown or empty path", () => {
    expect(changeForRowPath(set, "src/b.ts")).toBeNull();
    expect(changeForRowPath(set, "")).toBeNull();
  });
});

describe("fileReviewRowState", () => {
  it("returns null with no set (not yet projected / unknown id)", () => {
    expect(fileReviewRowState(undefined, "a.ts")).toBeNull();
  });

  it("reads AWAITING_REVIEW as pending regardless of path", () => {
    const set = reviewSet({ status: FileChangeSetStatus.AWAITING_REVIEW });
    expect(fileReviewRowState(set, "a.ts")).toBe("pending");
    expect(fileReviewRowState(set, null)).toBe("pending");
  });

  it("reads FAILED as failed", () => {
    expect(
      fileReviewRowState(reviewSet({ status: FileChangeSetStatus.FAILED }), "a.ts"),
    ).toBe("failed");
  });

  it("resolves a decided file's verdict by row path (kept / discarded)", () => {
    const set = reviewSet({
      status: FileChangeSetStatus.RECONCILED,
      changes: [fileChange("f1", "a.ts"), fileChange("f2", "b.ts")],
      decisions: [
        decision({ scope: FileDecisionScope.FILE, action: FileDecisionAction.APPROVE, fileChangeId: "f1" }),
        decision({ scope: FileDecisionScope.FILE, action: FileDecisionAction.REJECT, fileChangeId: "f2" }),
      ],
    });
    expect(fileReviewRowState(set, "a.ts")).toBe("kept");
    expect(fileReviewRowState(set, "/abs/ws/b.ts")).toBe("discarded");
  });

  it("degrades to null — never a wrong badge — for a file absent from the set or with no verdict", () => {
    const set = reviewSet({
      status: FileChangeSetStatus.DECIDED,
      changes: [fileChange("f1", "a.ts")],
      decisions: [],
    });
    // Superseded/reverted within the turn: the row's file is not in the set.
    expect(fileReviewRowState(set, "gone.ts")).toBeNull();
    // In the set but never decided (terminated mid-review).
    expect(fileReviewRowState(set, "a.ts")).toBeNull();
    // No usable path on the row.
    expect(fileReviewRowState(set, null)).toBeNull();
  });

  it("returns null for a CAPTURING set (no reviewable state yet)", () => {
    expect(
      fileReviewRowState(reviewSet({ status: FileChangeSetStatus.CAPTURING }), "a.ts"),
    ).toBeNull();
  });
});
