/**
 * The run's file record read from the turn's ledger, and which of its sets a
 * write carries (`record.ts`): every set from its baseline, the candidate's
 * capture half once captured, the ledger's own change objects, and each set
 * sent once at its pin and once more with its candidate.
 */

import { create } from "@bufbuild/protobuf";
import { FileChangeSetSchema, type FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { describe, expect, it } from "vitest";

import { FileChangeKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FileRecordSender, adoptedChangeSetOf, changeSetIdForInvocation, fileRecordOf } from "../record.js";
import { TurnRowsSchema, type TurnRows } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { FileReviewEventType } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { FileReviewEventSchema, FileReviewEventStreamSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/ledger_pb.js";

const SET = "run_1:0";

function baseline(rows: TurnRows, id = SET): void {
  rows.fileReviewEventStream ??= create(FileReviewEventStreamSchema, { runId: "run_1" });
  rows.fileReviewEventStream.events.push(
    create(FileReviewEventSchema, {
      eventId: `${id}:b`,
      changeSetId: id,
      eventType: FileReviewEventType.BASELINE_CAPTURED,
      payload: {
        case: "baselineCaptured",
        value: { changeSetId: id, turnId: id, harnessId: "unit", baselineSnapshot: { git: { treeOid: "base" } } },
      },
    }),
  );
}

function candidate(rows: TurnRows, id = SET): void {
  rows.fileReviewEventStream!.events.push(
    create(FileReviewEventSchema, {
      eventId: `${id}:c`,
      changeSetId: id,
      eventType: FileReviewEventType.CANDIDATE_CAPTURED,
      payload: {
        case: "candidateCaptured",
        value: {
          changeSetId: id,
          candidateSnapshot: { git: { treeOid: "after" } },
          changes: [{ id: `${id}:a.md`, pathAfter: "a.md", kind: FileChangeKind.ADD, diffComplete: true, fileDigest: "da" }],
          aggregateDigest: "agg",
          commandProvenance: { consentToolCallIds: ["call-1"] },
        },
      },
    }),
  );
}

describe("fileRecordOf", () => {
  it("is empty for rows with no ledger", () => {
    expect(fileRecordOf(create(TurnRowsSchema))).toEqual([]);
  });

  it("holds a set from its baseline: still being captured, with no candidate snapshot", () => {
    const rows = create(TurnRowsSchema);
    baseline(rows);
    const [set] = fileRecordOf(rows);
    expect([set!.id, set!.turnId, set!.harnessId, set!.baselineSnapshot?.git?.treeOid]).toEqual([SET, SET, "unit", "base"]);
    expect(set!.candidateSnapshot).toBeUndefined();
    expect(set!.changes).toEqual([]);
  });

  it("carries the candidate's capture half and its provenance, holding the ledger's own change objects", () => {
    const rows = create(TurnRowsSchema);
    baseline(rows);
    candidate(rows);
    const [set] = fileRecordOf(rows);
    expect(set!.candidateSnapshot?.git?.treeOid).toBe("after");
    expect(set!.aggregateDigest).toBe("agg");
    expect(set!.commandProvenance?.consentToolCallIds).toEqual(["call-1"]);
    const ledger = rows.fileReviewEventStream!.events[1]!.payload;
    expect(ledger.case === "candidateCaptured" && set!.changes[0]).toBe(ledger.case === "candidateCaptured" ? ledger.value.changes[0] : undefined);
  });

  it("keeps the sets in the order their baselines opened them and skips an event with no change set", () => {
    const rows = create(TurnRowsSchema);
    baseline(rows, "run_1:0");
    baseline(rows, "run_1:1");
    candidate(rows, "run_1:0");
    rows.fileReviewEventStream!.events.push({ ...rows.fileReviewEventStream!.events[0]!, changeSetId: "" });
    rows.fileReviewEventStream!.events.push(
      create(FileReviewEventSchema, {
        eventId: "f",
        changeSetId: "run_1:1",
        eventType: FileReviewEventType.FAILED,
        payload: { case: "failed", value: { changeSetId: "run_1:1", detail: "a capture that failed adds nothing to the record" } },
      }),
    );
    expect(fileRecordOf(rows).map((set) => set.id)).toEqual(["run_1:0", "run_1:1"]);
    expect(fileRecordOf(rows)[1]!.candidateSnapshot).toBeUndefined();
  });
});

describe("FileRecordSender", () => {
  it("sends a set at its pin, not again until its candidate, then never again", () => {
    const sender = new FileRecordSender();
    const rows = create(TurnRowsSchema);
    expect(sender.pending(rows)).toEqual([]);

    baseline(rows);
    const atPin = sender.pending(rows);
    expect(atPin.map((set) => [set.id, set.candidateSnapshot === undefined])).toEqual([[SET, true]]);
    sender.written(atPin);
    expect(sender.pending(rows), "the writes between carry nothing").toEqual([]);

    candidate(rows);
    const atBoundary = sender.pending(rows);
    expect(atBoundary.map((set) => set.candidateSnapshot?.git?.treeOid)).toEqual(["after"]);
    sender.written(atBoundary);
    expect(sender.pending(rows), "a captured set is sent once").toEqual([]);
  });

  it("sends a set again when the write that carried it did not land", () => {
    const sender = new FileRecordSender();
    const rows = create(TurnRowsSchema);
    baseline(rows);
    candidate(rows);
    expect(sender.pending(rows)).toHaveLength(1);
    expect(sender.pending(rows), "nothing was written").toHaveLength(1);
  });
});

describe("changeSetIdForInvocation: which set an invocation captures into", () => {
  const RUN = "run_1";
  const open = (id: string): FileChangeSet => create(FileChangeSetSchema, { id, baselineSnapshot: { git: { treeOid: "base" } } });
  const captured = (id: string): FileChangeSet =>
    create(FileChangeSetSchema, { id, baselineSnapshot: { git: { treeOid: "base" } }, candidateSnapshot: { git: { treeOid: "after" } } });

  it("mints <run>:<turnSeq> for a run with no record", () => {
    expect(changeSetIdForInvocation(RUN, 0, [])).toBe("run_1:0");
  });

  it("adopts the newest set while it is open and the invocation is its turn: a recovery at 0, a retry at its own cycle", () => {
    expect(changeSetIdForInvocation(RUN, 0, [open("run_1:0")]), "a recovered first turn").toBe("run_1:0");
    expect(changeSetIdForInvocation(RUN, 0, [captured("run_1:0"), open("run_1:1")]), "a recovery during the second cycle, re-run at 0").toBe("run_1:1");
    expect(changeSetIdForInvocation(RUN, 1, [captured("run_1:0"), open("run_1:1")]), "a retry of the second cycle").toBe("run_1:1");
  });

  it("mints a new approval cycle's own id, even after a cycle that changed nothing", () => {
    expect(changeSetIdForInvocation(RUN, 1, [captured("run_1:0")])).toBe("run_1:1");
    expect(changeSetIdForInvocation(RUN, 1, [open("run_1:0")]), "an open set of an earlier cycle is that cycle's").toBe("run_1:1");
  });

  it("never writes into a captured set: a recovery after a captured cycle takes the first free suffix", () => {
    expect(changeSetIdForInvocation(RUN, 0, [captured("run_1:0")])).toBe("run_1:0.1");
    expect(changeSetIdForInvocation(RUN, 0, [captured("run_1:0"), captured("run_1:0.1")])).toBe("run_1:0.2");
    expect(changeSetIdForInvocation(RUN, 0, [captured("run_1:0"), open("run_1:0.1")]), "and adopts that suffix while it is open").toBe("run_1:0.1");
  });

  it("does not adopt a set of another shape", () => {
    expect(changeSetIdForInvocation(RUN, 0, [open("legacy-set")])).toBe("run_1:0");
    expect(changeSetIdForInvocation(RUN, 0, [open("run_1:x")])).toBe("run_1:0");
  });

  it("adoptedChangeSetOf finds the open set under its id, and nothing for a captured or unknown one", () => {
    const record = [captured("run_1:0"), open("run_1:1")];
    expect(adoptedChangeSetOf("run_1:1", record)?.id).toBe("run_1:1");
    expect(adoptedChangeSetOf("run_1:0", record)).toBeUndefined();
    expect(adoptedChangeSetOf("run_1:2", record)).toBeUndefined();
  });
});

