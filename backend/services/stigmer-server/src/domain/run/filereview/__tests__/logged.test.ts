/**
 * Pins a run's file review as its session's log states it (../logged.ts):
 * decided events read in the event's words, in log order, with their
 * decider (empty for a decision written before the event named one), a
 * word this binary does not know passed over; a person's allows (and no
 * deny) as the consent; the first decision on exactly a target; a write's
 * own decisions folded in (`withDecisions`); a change-set decision
 * covering every file and a file decision its one file; and a set awaiting
 * review only once its candidate is captured, while a file no decision
 * covers remains (a capture that changed no file until any decision).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SnapshotKind } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { FileChangeSetSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import {
  awaitsReview,
  decisionOnTarget,
  decisionsOn,
  loggedDecisionOf,
  runReviewLogOf,
  undecidedFileIds,
  withDecisions,
} from "../logged.js";

function decided(
  changeSetId: string,
  scope: string,
  action: string,
  fileChangeId = "",
  origin = "person",
  decidedBy = "",
): SessionEvent {
  return create(SessionEventSchema, {
    runId: "run_a",
    event: {
      case: "stigmerFileReviewDecided",
      value: { id: `d-${changeSetId}-${scope}-${fileChangeId}-${action}`, changeSetId, scope, fileChangeId, action, origin, decidedBy },
    },
  });
}

function confirmed(toolUseId: string, result: string): SessionEvent {
  return create(SessionEventSchema, {
    runId: "run_a",
    event: { case: "userToolConfirmation", value: { id: `c-${toolUseId}`, toolUseId, result } },
  });
}

const CANDIDATE = { kind: SnapshotKind.GIT_TREE_REF, git: { treeOid: "after", ref: "refs/stigmer/candidate" } };

const twoFiles = create(FileChangeSetSchema, {
  id: "run_a:0",
  candidateSnapshot: CANDIDATE,
  changes: [{ id: "fc-1" }, { id: "fc-2" }],
});

describe("a run's review log", () => {
  it("reads decisions in the event's words and in log order, with their decider, passing over a word it does not know and every other event", () => {
    const log = runReviewLogOf([
      decided("run_a:0", "file", "undo", "fc-1", "person", "usr_ada"),
      decided("run_a:0", "change_set", "keep", "ignored", "next_turn"),
      decided("run_a:0", "folder", "keep"),
      decided("run_a:0", "file", "shred", "fc-2"),
      create(SessionEventSchema, { runId: "run_a", event: { case: "agentThinking", value: { id: "t" } } }),
    ]);
    expect(log.decisions).toEqual([
      { changeSetId: "run_a:0", scope: "file", fileChangeId: "fc-1", action: "undo", origin: "person", decidedBy: "usr_ada" },
      { changeSetId: "run_a:0", scope: "change_set", fileChangeId: "", action: "keep", origin: "next_turn", decidedBy: "" },
    ]);
  });

  it("reads one decided event alone, and nothing from any other event", () => {
    expect(loggedDecisionOf(decided("run_a:0", "change_set", "undo", "", "person", ""))?.decidedBy).toBe("");
    expect(loggedDecisionOf(confirmed("run_a.1", "allow"))).toBeUndefined();
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
    expect(decisionOnTarget(log, "run_a:0", "change_set", "")?.action).toBe("keep");
    expect(decisionOnTarget(log, "run_a:0", "file", "fc-1")?.action).toBe("undo");
    expect(decisionOnTarget(log, "run_a:0", "file", "fc-2")).toBeUndefined();
    expect(decisionsOn(log, "run_a:1")).toHaveLength(1);
  });

  it("folds a write's own decisions in after the log's, keeping the allows, and is the same log for none", () => {
    const log = runReviewLogOf([confirmed("run_a.1", "allow"), decided("run_a:0", "file", "undo", "fc-1")]);
    expect(withDecisions(log, [])).toBe(log);
    const after = withDecisions(log, [decided("run_a:0", "file", "keep", "fc-2", "next_turn")]);
    expect(after.decisions.map((d) => [d.fileChangeId, d.action])).toEqual([
      ["fc-1", "undo"],
      ["fc-2", "keep"],
    ]);
    expect(after.allowed).toBe(log.allowed);
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
    const capturing = create(FileChangeSetSchema, {
      id: "run_a:0",
      baselineSnapshot: { kind: SnapshotKind.GIT_TREE_REF, git: { treeOid: "base" } },
    });
    expect(awaitsReview(capturing, [])).toBe(false);
    const empty = create(FileChangeSetSchema, { id: "run_a:0", candidateSnapshot: CANDIDATE });
    expect(awaitsReview(empty, [])).toBe(true);
    expect(awaitsReview(empty, runReviewLogOf([decided("run_a:0", "change_set", "keep")]).decisions)).toBe(false);
  });
});
