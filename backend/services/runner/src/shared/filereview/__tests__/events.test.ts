/**
 * Producer unit tests: deterministic event ids (matching the Go/Java EventID
 * format), the captured-change mapping + enforcement digests, candidate
 * completeness derivation, and append-only-by-id stream authoring.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DiffCompleteness,
  FileCaptureClass,
  FileChangeKind,
  FileReviewBlockReason,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  appendFileReviewEvents,
  buildBaselineCapturedEvent,
  buildCandidateCapturedEvent,
  buildCapturedFileChange,
  deriveDiffCompleteness,
  eventId,
  type ChangeSetContext,
} from "../events.js";
import { sha256Bytes } from "../digest.js";

const ctx: ChangeSetContext = {
  changeSetId: "exec-1:0",
  turnId: "turn-0",
  harnessId: "cursor",
  timestamp: "2026-06-30T00:00:00Z",
};

// Completeness-derivation fixtures: a fully-reviewable text change, a binary
// change (no text diff, is_binary on its byte-true side), and a content-less
// unavailable change (secret-withheld — non-binary, no keepable bytes).
function reviewableChange(id: string) {
  return buildCapturedFileChange({
    id, pathBefore: id, pathAfter: id, kind: FileChangeKind.MODIFY,
    captureClass: FileCaptureClass.GIT_TRACKED, before: "old\n", after: "new\n",
  });
}
function binaryChange(id: string) {
  return buildCapturedFileChange({
    id, pathBefore: "", pathAfter: `${id}.png`, kind: FileChangeKind.ADD,
    captureClass: FileCaptureClass.GIT_TRACKED,
    after: { kind: "binary", sha256: `sha-${id}` },
    diffComplete: false,
  });
}
function unavailableChange(id: string) {
  return buildCapturedFileChange({
    id, pathBefore: "", pathAfter: id, kind: FileChangeKind.MODIFY,
    captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
    diffComplete: false, blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
  });
}

describe("eventId", () => {
  it("matches the Go/Java deterministic format (changeSetId:scopeId:ENUM_NAME)", () => {
    expect(eventId("cs-1", "cs-1", FileReviewEventType.BASELINE_CAPTURED)).toBe(
      "cs-1:cs-1:FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED",
    );
    expect(eventId("cs-1", "cs-1", FileReviewEventType.CANDIDATE_CAPTURED)).toBe(
      "cs-1:cs-1:FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED",
    );
    expect(eventId("cs-1", "cs-1", FileReviewEventType.RECONCILED)).toBe(
      "cs-1:cs-1:FILE_REVIEW_EVENT_TYPE_RECONCILED",
    );
  });
});

describe("buildCapturedFileChange", () => {
  it("computes before/after sha256 and file_digest over the captured bytes", () => {
    const change = buildCapturedFileChange({
      id: "fc-1",
      pathBefore: "src/a.ts",
      pathAfter: "src/a.ts",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.GIT_TRACKED,
      before: "old\n",
      after: "new\n",
    });
    expect(change.beforeSha256).toBe(sha256Bytes(Buffer.from("old\n", "utf8")));
    expect(change.afterSha256).toBe(sha256Bytes(Buffer.from("new\n", "utf8")));
    expect(change.fileDigest).toHaveLength(64);
    expect(change.diffComplete).toBe(true);
    expect(change.before?.body.case).toBe("inline");
    expect(change.after?.body.case).toBe("inline");
    // Producer invariant: a reviewable (diff_complete) file carries no reason.
    expect(change.blockedReason).toBe(FileReviewBlockReason.UNSPECIFIED);
  });

  it("passes through an explicit blocked_reason (doc 15)", () => {
    const change = buildCapturedFileChange({
      id: "fc-secret",
      pathBefore: ".env",
      pathAfter: ".env",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
      diffComplete: false,
      blockedReason: FileReviewBlockReason.SECRET_WITHHELD,
    });
    expect(change.diffComplete).toBe(false);
    expect(change.blockedReason).toBe(FileReviewBlockReason.SECRET_WITHHELD);
  });

  it("keeps blocked_reason out of the enforcement digests (informational only)", () => {
    const common = {
      id: "fc-1",
      pathBefore: "a",
      pathAfter: "a",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.GIT_IGNORED_CAPTURED,
      before: "x",
      after: "y",
      diffComplete: false,
    } as const;
    // Two files identical except for the reason must be digest-indistinguishable —
    // structurally guaranteed (FileDigestInput excludes it), locked here anyway.
    const withUnspecified = buildCapturedFileChange(common);
    const withSize = buildCapturedFileChange({
      ...common,
      blockedReason: FileReviewBlockReason.SIZE_ELIDED,
    });
    expect(withSize.fileDigest).toBe(withUnspecified.fileDigest);

    const aggUnspecified = buildCandidateCapturedEvent(ctx, undefined, [withUnspecified]);
    const aggSize = buildCandidateCapturedEvent(ctx, undefined, [withSize]);
    if (
      aggUnspecified.payload.case === "candidateCaptured" &&
      aggSize.payload.case === "candidateCaptured"
    ) {
      expect(aggSize.payload.value.aggregateDigest).toBe(
        aggUnspecified.payload.value.aggregateDigest,
      );
    }
  });

  it("stamps display line counts from inline sides", () => {
    const modify = buildCapturedFileChange({
      id: "fc-counts",
      pathBefore: "src/a.ts",
      pathAfter: "src/a.ts",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.GIT_TRACKED,
      before: "one\ntwo\n",
      after: "one\nTWO\nthree\n",
    });
    expect(modify.linesAdded).toBe(2);
    expect(modify.linesRemoved).toBe(1);

    const add = buildCapturedFileChange({
      id: "fc-add-counts",
      pathBefore: "",
      pathAfter: "src/new.ts",
      kind: FileChangeKind.ADD,
      captureClass: FileCaptureClass.GIT_TRACKED,
      after: "a\nb\nc\n",
    });
    expect(add.linesAdded).toBe(3);
    expect(add.linesRemoved).toBe(0);
  });

  it("prefers explicit lineCounts (the CAS substrate's capture-time counts) over inline counting", () => {
    const change = buildCapturedFileChange({
      id: "fc-explicit",
      pathBefore: "notes.txt",
      pathAfter: "notes.txt",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.NON_GIT_CAS,
      before: {
        kind: "ref", sha256: "s1", storageKey: "k1", sizeBytes: 10, isBinary: false,
      },
      after: {
        kind: "ref", sha256: "s2", storageKey: "k2", sizeBytes: 12, isBinary: false,
      },
      lineCounts: { linesAdded: 7, linesRemoved: 4 },
    });
    expect(change.linesAdded).toBe(7);
    expect(change.linesRemoved).toBe(4);
  });

  it("leaves counts at zero when a side is not countable (binary / ref without explicit counts / withheld)", () => {
    // Binary side: no text diff exists, so no count may claim one does.
    const binary = binaryChange("bin");
    expect(binary.linesAdded).toBe(0);
    expect(binary.linesRemoved).toBe(0);

    // Ref side without explicit counts: the bytes are not here to count.
    const ref = buildCapturedFileChange({
      id: "fc-ref",
      pathBefore: "big.txt",
      pathAfter: "big.txt",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.NON_GIT_CAS,
      before: { kind: "ref", sha256: "s1", storageKey: "k1", sizeBytes: 9, isBinary: false },
      after: { kind: "ref", sha256: "s2", storageKey: "k2", sizeBytes: 9, isBinary: false },
    });
    expect(ref.linesAdded).toBe(0);
    expect(ref.linesRemoved).toBe(0);

    // Secret-withheld: content-less by design.
    const withheld = unavailableChange("secret");
    expect(withheld.linesAdded).toBe(0);
    expect(withheld.linesRemoved).toBe(0);
  });

  it("keeps line counts out of the enforcement digests (informational only)", () => {
    const common = {
      id: "fc-digest",
      pathBefore: "a",
      pathAfter: "a",
      kind: FileChangeKind.MODIFY,
      captureClass: FileCaptureClass.NON_GIT_CAS,
      before: {
        kind: "ref", sha256: "s1", storageKey: "k1", sizeBytes: 3, isBinary: false,
      },
      after: {
        kind: "ref", sha256: "s2", storageKey: "k2", sizeBytes: 3, isBinary: false,
      },
    } as const;
    // Identical content with and without counts must be digest-indistinguishable —
    // structurally guaranteed (FileDigestInput excludes counts), locked here so a
    // future refactor cannot silently fold display data into enforcement.
    const withoutCounts = buildCapturedFileChange(common);
    const withCounts = buildCapturedFileChange({
      ...common,
      lineCounts: { linesAdded: 5, linesRemoved: 2 },
    });
    expect(withCounts.fileDigest).toBe(withoutCounts.fileDigest);

    const aggWithout = buildCandidateCapturedEvent(ctx, undefined, [withoutCounts]);
    const aggWith = buildCandidateCapturedEvent(ctx, undefined, [withCounts]);
    if (
      aggWithout.payload.case === "candidateCaptured" &&
      aggWith.payload.case === "candidateCaptured"
    ) {
      expect(aggWith.payload.value.aggregateDigest).toBe(
        aggWithout.payload.value.aggregateDigest,
      );
    }
  });

  it("omits the before side for an ADD and the after side for a DELETE", () => {
    const add = buildCapturedFileChange({
      id: "fc-add",
      pathBefore: "",
      pathAfter: "src/new.ts",
      kind: FileChangeKind.ADD,
      captureClass: FileCaptureClass.GIT_TRACKED,
      after: "hello\n",
    });
    expect(add.before).toBeUndefined();
    expect(add.beforeSha256).toBe("");
    expect(add.after?.body.case).toBe("inline");

    const del = buildCapturedFileChange({
      id: "fc-del",
      pathBefore: "src/old.ts",
      pathAfter: "",
      kind: FileChangeKind.DELETE,
      captureClass: FileCaptureClass.GIT_TRACKED,
      before: "bye\n",
    });
    expect(del.after).toBeUndefined();
    expect(del.afterSha256).toBe("");
  });
});

describe("buildCandidateCapturedEvent", () => {
  it("derives COMPLETE when every file is complete", () => {
    const changes = [
      buildCapturedFileChange({
        id: "fc-1", pathBefore: "a", pathAfter: "a", kind: FileChangeKind.MODIFY,
        captureClass: FileCaptureClass.GIT_TRACKED, before: "x", after: "y",
      }),
    ];
    const ev = buildCandidateCapturedEvent(ctx, undefined, changes);
    expect(ev.payload.case).toBe("candidateCaptured");
    if (ev.payload.case === "candidateCaptured") {
      expect(ev.payload.value.diffCompleteness).toBe(DiffCompleteness.COMPLETE);
      expect(ev.payload.value.aggregateDigest).toHaveLength(64);
    }
  });

  it("derives PARTIAL_BLOCKED when a non-binary file is incomplete", () => {
    const changes = [
      buildCapturedFileChange({
        id: "fc-1", pathBefore: "a", pathAfter: "a", kind: FileChangeKind.MODIFY,
        captureClass: FileCaptureClass.GIT_TRACKED, before: "x", after: "y",
        diffComplete: false,
      }),
    ];
    const ev = buildCandidateCapturedEvent(ctx, undefined, changes);
    if (ev.payload.case === "candidateCaptured") {
      expect(ev.payload.value.diffCompleteness).toBe(DiffCompleteness.PARTIAL_BLOCKED);
    }
  });

  it("derives BINARY_SUMMARY_ONLY when the only incomplete file is binary", () => {
    const changes = [reviewableChange("fc-text"), binaryChange("fc-bin")];
    const ev = buildCandidateCapturedEvent(ctx, undefined, changes);
    if (ev.payload.case === "candidateCaptured") {
      expect(ev.payload.value.diffCompleteness).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
    }
  });
});

describe("deriveDiffCompleteness", () => {
  it("is COMPLETE when every file is complete (and for an empty set)", () => {
    expect(deriveDiffCompleteness([])).toBe(DiffCompleteness.COMPLETE);
    expect(deriveDiffCompleteness([reviewableChange("a"), reviewableChange("b")])).toBe(
      DiffCompleteness.COMPLETE,
    );
  });

  it("is BINARY_SUMMARY_ONLY when binary is the set's only blocker", () => {
    // Binary-only single file, and a mixed reviewable-text + binary set.
    expect(deriveDiffCompleteness([binaryChange("bin")])).toBe(
      DiffCompleteness.BINARY_SUMMARY_ONLY,
    );
    expect(
      deriveDiffCompleteness([reviewableChange("t1"), reviewableChange("t2"), binaryChange("b")]),
    ).toBe(DiffCompleteness.BINARY_SUMMARY_ONLY);
  });

  it("is PARTIAL_BLOCKED when a non-binary incomplete file is present, even alongside a binary", () => {
    expect(
      deriveDiffCompleteness([reviewableChange("t"), binaryChange("b"), unavailableChange("secret")]),
    ).toBe(DiffCompleteness.PARTIAL_BLOCKED);
  });
});

describe("appendFileReviewEvents", () => {
  it("seeds the stream and appends append-only by event_id", () => {
    const status = create(AgentExecutionStatusSchema, {});
    const baseline = buildBaselineCapturedEvent(ctx, undefined);
    const candidate = buildCandidateCapturedEvent(ctx, undefined, []);

    appendFileReviewEvents(status, "exec-1", [baseline, candidate]);
    expect(status.fileReviewEventStream?.executionId).toBe("exec-1");
    expect(status.fileReviewEventStream?.events).toHaveLength(2);

    // Re-appending the same events (a re-sent heartbeat) is idempotent.
    appendFileReviewEvents(status, "exec-1", [baseline, candidate]);
    expect(status.fileReviewEventStream?.events).toHaveLength(2);
  });
});
