// Unit tests for the file-review fold and its display read-seam. The
// cross-edition parity with the Go/Java projectors is locked separately by
// file-review-fold.corpus.test.ts; these cover the TS-specific edges and the
// deliberate terminal divergence of displayFileChangeSets.

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  FileChangeSetSchema,
  CapturedFileChangeSchema,
  FileDecisionSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
  FileReviewBaselineCapturedSchema,
  FileReviewCandidateCapturedSchema,
  FileReviewReconciledSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  displayFileChangeSets,
  foldFileReviewEventStream,
} from "../file-review-fold";

// ---------------------------------------------------------------------------
// Event builders (keep the tests readable)
// ---------------------------------------------------------------------------

function change(id: string, path = `src/${id}.ts`): CapturedFileChange {
  return create(CapturedFileChangeSchema, {
    id,
    pathAfter: path,
    kind: FileChangeKind.MODIFY,
    diffComplete: true,
  });
}

function baseline(changeSetId: string) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.BASELINE_CAPTURED,
    payload: {
      case: "baselineCaptured",
      value: create(FileReviewBaselineCapturedSchema, {
        changeSetId,
        turnId: "t1",
        harnessId: "deep-agent",
      }),
    },
  });
}

function candidate(changeSetId: string, changes: CapturedFileChange[], agg = "agg") {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.CANDIDATE_CAPTURED,
    payload: {
      case: "candidateCaptured",
      value: create(FileReviewCandidateCapturedSchema, {
        changeSetId,
        changes,
        aggregateDigest: agg,
      }),
    },
  });
}

function fileDecision(
  changeSetId: string,
  fileChangeId: string,
  action = FileDecisionAction.APPROVE,
) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.FILE_DECIDED,
    payload: {
      case: "fileDecided",
      value: create(FileDecisionSchema, {
        changeSetId,
        fileChangeId,
        scope: FileDecisionScope.FILE,
        action,
      }),
    },
  });
}

function changeSetDecision(changeSetId: string) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.FILE_DECIDED,
    payload: {
      case: "fileDecided",
      value: create(FileDecisionSchema, {
        changeSetId,
        scope: FileDecisionScope.CHANGE_SET,
        action: FileDecisionAction.APPROVE,
      }),
    },
  });
}

function reconciled(changeSetId: string) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.RECONCILED,
    payload: {
      case: "reconciled",
      value: create(FileReviewReconciledSchema, { changeSetId }),
    },
  });
}

function failed(changeSetId: string) {
  return create(FileReviewEventSchema, {
    changeSetId,
    eventType: FileReviewEventType.FAILED,
    payload: { case: undefined },
  });
}

function stream(...events: ReturnType<typeof baseline>[]) {
  return create(FileReviewEventStreamSchema, { executionId: "aex_1", events });
}

// ---------------------------------------------------------------------------
// foldFileReviewEventStream
// ---------------------------------------------------------------------------

describe("foldFileReviewEventStream", () => {
  it("returns [] for undefined / empty streams", () => {
    expect(foldFileReviewEventStream(undefined)).toEqual([]);
    expect(foldFileReviewEventStream(stream())).toEqual([]);
  });

  it("opens a set as CAPTURING on baseline, before any candidate", () => {
    const [set] = foldFileReviewEventStream(stream(baseline("cs1")));
    expect(set.status).toBe(FileChangeSetStatus.CAPTURING);
    expect(set.turnId).toBe("t1");
    expect(set.harnessId).toBe("deep-agent");
    expect(set.changes).toHaveLength(0);
  });

  it("moves to AWAITING_REVIEW once a candidate carries changes", () => {
    const [set] = foldFileReviewEventStream(
      stream(baseline("cs1"), candidate("cs1", [change("fc1")], "agg1")),
    );
    expect(set.status).toBe(FileChangeSetStatus.AWAITING_REVIEW);
    expect(set.changes.map((c) => c.id)).toEqual(["fc1"]);
    expect(set.aggregateDigest).toBe("agg1");
  });

  it("replaces the change list wholesale on a later candidate", () => {
    const [set] = foldFileReviewEventStream(
      stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1"), change("fc2")]),
        candidate("cs1", [change("fc3")]),
      ),
    );
    expect(set.changes.map((c) => c.id)).toEqual(["fc3"]);
  });

  it("marks DECIDED only when every file has a verdict", () => {
    const partial = foldFileReviewEventStream(
      stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1"), change("fc2")]),
        fileDecision("cs1", "fc1"),
      ),
    )[0];
    expect(partial.status).toBe(FileChangeSetStatus.AWAITING_REVIEW);
    expect(partial.decisions).toHaveLength(1);

    const full = foldFileReviewEventStream(
      stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1"), change("fc2")]),
        fileDecision("cs1", "fc1"),
        fileDecision("cs1", "fc2"),
      ),
    )[0];
    expect(full.status).toBe(FileChangeSetStatus.DECIDED);
  });

  it("treats a CHANGE_SET decision as covering every file", () => {
    const [set] = foldFileReviewEventStream(
      stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1"), change("fc2")]),
        changeSetDecision("cs1"),
      ),
    );
    expect(set.status).toBe(FileChangeSetStatus.DECIDED);
  });

  it("keeps terminal RECONCILED/FAILED sticky against a later decision", () => {
    const reconciledSet = foldFileReviewEventStream(
      stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1")]),
        reconciled("cs1"),
        fileDecision("cs1", "fc1"), // arrives after reconcile — must not downgrade
      ),
    )[0];
    expect(reconciledSet.status).toBe(FileChangeSetStatus.RECONCILED);

    const failedSet = foldFileReviewEventStream(
      stream(baseline("cs1"), candidate("cs1", [change("fc1")]), failed("cs1"))
    )[0];
    expect(failedSet.status).toBe(FileChangeSetStatus.FAILED);
  });

  it("groups multiple change sets in first-seen order", () => {
    const sets = foldFileReviewEventStream(
      stream(
        baseline("cs2"),
        candidate("cs2", [change("fc-a")]),
        baseline("cs1"),
        candidate("cs1", [change("fc-b")]),
      ),
    );
    expect(sets.map((s) => s.id)).toEqual(["cs2", "cs1"]);
  });

  it("skips events with no change_set_id", () => {
    const orphan = create(FileReviewEventSchema, {
      changeSetId: "",
      eventType: FileReviewEventType.BASELINE_CAPTURED,
    });
    expect(foldFileReviewEventStream(stream(orphan))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// displayFileChangeSets — projection-first, fold-on-terminal
// ---------------------------------------------------------------------------

describe("displayFileChangeSets", () => {
  it("returns [] for undefined status", () => {
    expect(displayFileChangeSets(undefined)).toEqual([]);
  });

  it("prefers the server projection when present (preserving its reference)", () => {
    const projected = [create(FileChangeSetSchema, { id: "cs1" })];
    const status = create(AgentExecutionStatusSchema, {
      fileChangeSets: projected,
      // A ledger is also present, but the projection wins for a live execution.
      fileReviewEventStream: stream(baseline("cs1")),
    });
    const result = displayFileChangeSets(status);
    expect(result).toBe(status.fileChangeSets); // same ref — no re-fold, memo-safe
  });

  it("folds the ledger when the projection is empty (terminal execution)", () => {
    const status = create(AgentExecutionStatusSchema, {
      fileChangeSets: [], // terminal: server projects nil
      fileReviewEventStream: stream(
        baseline("cs1"),
        candidate("cs1", [change("fc1")]),
        changeSetDecision("cs1"),
        reconciled("cs1"),
      ),
    });
    const result = displayFileChangeSets(status);
    expect(result.map((s) => s.id)).toEqual(["cs1"]);
    expect(result[0].status).toBe(FileChangeSetStatus.RECONCILED);
  });

  it("returns [] when neither projection nor ledger has content", () => {
    const status = create(AgentExecutionStatusSchema, {});
    expect(displayFileChangeSets(status)).toEqual([]);
  });
});
