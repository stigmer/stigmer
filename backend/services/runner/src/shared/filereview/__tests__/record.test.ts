/**
 * The run's file record read from the turn's ledger, and which of its sets a
 * write carries (`record.ts`): every set from its baseline, the candidate's
 * capture half once captured, the ledger's own change objects, and each set
 * sent once at its pin and once more with its candidate.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { FileChangeKind } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { FileRecordSender, fileRecordOf } from "../record.js";
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
    expect(fileRecordOf(rows).map((set) => set.id)).toEqual(["run_1:0", "run_1:1"]);
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
