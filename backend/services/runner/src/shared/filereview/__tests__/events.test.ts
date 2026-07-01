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

  it("derives PARTIAL_BLOCKED when any file is incomplete", () => {
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
