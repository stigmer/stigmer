/**
 * Pins a run's file review as its session's log states it (../logged.ts):
 * decided events read in the ledger's terms, in log order, a word this
 * binary does not know passed over; a person's allows (and no deny) as the
 * consent; the first decision on exactly a target; a change-set decision
 * covering every file and a file decision its one file; and a set awaiting
 * review only once captured, while a file no decision covers remains (a
 * capture that changed no file until any decision).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import {
  awaitsReview,
  decisionOnTarget,
  decisionsOn,
  isCaptured,
  runReviewLogOf,
  undecidedFileIds,
} from "../logged.js";

function decided(changeSetId: string, scope: string, action: string, fileChangeId = "", origin = "person"): SessionEvent {
  return create(SessionEventSchema, {
    runId: "run_a",
    event: {
      case: "stigmerFileReviewDecided",
      value: { id: `d-${changeSetId}-${scope}-${fileChangeId}-${action}`, changeSetId, scope, fileChangeId, action, origin },
    },
  });
}

function confirmed(toolUseId: string, result: string): SessionEvent {
  return create(SessionEventSchema, {
    runId: "run_a",
    event: { case: "userToolConfirmation", value: { id: `c-${toolUseId}`, toolUseId, result } },
  });
}

const twoFiles = create(FileChangeSetSchema, {
  id: "run_a:0",
  status: FileChangeSetStatus.AWAITING_REVIEW,
  changes: [{ id: "fc-1" }, { id: "fc-2" }],
});

describe("a run's review log", () => {
  it("reads decisions in the ledger's terms and in log order, passing over a word it does not know and every other event", () => {
    const log = runReviewLogOf([
      decided("run_a:0", "file", "undo", "fc-1"),
      decided("run_a:0", "change_set", "keep", "ignored", "next_turn"),
      decided("run_a:0", "folder", "keep"),
      decided("run_a:0", "file", "shred", "fc-2"),
      create(SessionEventSchema, { runId: "run_a", event: { case: "agentThinking", value: { id: "t" } } }),
    ]);
    expect(log.decisions).toEqual([
      { changeSetId: "run_a:0", scope: FileDecisionScope.FILE, fileChangeId: "fc-1", action: FileDecisionAction.REJECT, origin: "person" },
      { changeSetId: "run_a:0", scope: FileDecisionScope.CHANGE_SET, fileChangeId: "", action: FileDecisionAction.APPROVE, origin: "next_turn" },
    ]);
  });

  it("holds the tool uses a person allowed, never one denied", () => {
    const log = runReviewLogOf([confirmed("run_a.1", "allow"), confirmed("run_a.2", "deny")]);
    expect([...log.allowed]).toEqual(["run_a.1"]);
  });

  it("finds the first decision on exactly a target, by set and by file", () => {
    const log = runReviewLogOf([
      decided("run_a:0", "file", "undo", "fc-1"),
      decided("run_a:0", "change_set", "keep"),
      decided("run_a:1", "change_set", "undo"),
    ]);
    expect(decisionOnTarget(log, "run_a:0", FileDecisionScope.CHANGE_SET, "")?.action).toBe(FileDecisionAction.APPROVE);
    expect(decisionOnTarget(log, "run_a:0", FileDecisionScope.FILE, "fc-1")?.action).toBe(FileDecisionAction.REJECT);
    expect(decisionOnTarget(log, "run_a:0", FileDecisionScope.FILE, "fc-2")).toBeUndefined();
    expect(decisionsOn(log, "run_a:1")).toHaveLength(1);
  });
});

describe("what still awaits review", () => {
  it("is every file no decision covers; a change-set decision covers them all", () => {
    expect(undecidedFileIds(twoFiles, [])).toEqual(["fc-1", "fc-2"]);
    const one = runReviewLogOf([decided("run_a:0", "file", "keep", "fc-2")]).decisions;
    expect(undecidedFileIds(twoFiles, one)).toEqual(["fc-1"]);
    expect(awaitsReview(twoFiles, one)).toBe(true);
    const all = runReviewLogOf([decided("run_a:0", "change_set", "undo")]).decisions;
    expect(undecidedFileIds(twoFiles, all)).toEqual([]);
    expect(awaitsReview(twoFiles, all)).toBe(false);
  });

  it("awaits nothing before the candidate is captured, and a capture with no file until any decision", () => {
    const capturing = create(FileChangeSetSchema, { id: "run_a:0", status: FileChangeSetStatus.CAPTURING });
    expect(isCaptured(capturing)).toBe(false);
    expect(awaitsReview(capturing, [])).toBe(false);
    expect(isCaptured(create(FileChangeSetSchema, { id: "run_a:0" }))).toBe(false);
    const empty = create(FileChangeSetSchema, { id: "run_a:0", status: FileChangeSetStatus.AWAITING_REVIEW });
    expect(awaitsReview(empty, [])).toBe(true);
    expect(awaitsReview(empty, runReviewLogOf([decided("run_a:0", "change_set", "keep")]).decisions)).toBe(false);
  });
});
