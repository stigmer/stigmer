/**
 * Pins the rules that keep a turn's file changes on the person's behalf
 * (autokeep.ts): a captured change set whose every mutation came from
 * commands the person approved (an allow in the session's log) is kept by
 * an approved_command decision, and every claim the server cannot verify
 * against its own records falls back to manual review, as does a set the
 * log shows a person decided. A plugin eval's try keeps its change set,
 * whatever produced it, except a set that cannot be kept whole, and a run
 * that is no try keeps nothing that way. Once a later message is sent, a
 * turn's undecided edits are kept with origin next_turn: a whole set nobody
 * decided by one change-set keep, a set decided in part by one file keep
 * per file left, an unreviewable set too, a set still being captured not
 * yet, and only once. What is decided is read from the log handed in
 * (`RunReviewLog`); what a rule decides is the decided events it returns,
 * with no decider. The record is the shared one-change seed
 * (../../__tests__/file-review-seed.ts).
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { DiffCompleteness } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { TurnCommandProvenanceSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { LogFields, Logger } from "../../../../boot/logger.js";
import { capturedSet, reviewableChange } from "../../__tests__/file-review-seed.js";
import { toolUseEventId } from "../../../session/events/ids.js";
import type { ActionWord, ScopeWord } from "../../../session/filereview/words.js";
import { autoKeepApprovedCommandSets, autoKeepPluginEvalTrySets, keepOutdatedSets } from "../autokeep.js";
import { fileReviewDecidedEventId } from "../decided.js";
import { aggregateDigest, fileDigest } from "../digest.js";
import { EMPTY_RUN_REVIEW_LOG, withDecisions } from "../logged.js";
import type { LoggedDecision, RunReviewLog } from "../logged.js";

const RUN_ID = "aex_autokeep";
const CHANGE_SET_ID = "cs-1";
const CONSENT_TOOL_CALL = "tc-shell-1";

interface Line {
  readonly level: "info" | "warn";
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function capturingLogger(): { logger: Logger; lines: Line[] } {
  const lines: Line[] = [];
  return {
    lines,
    logger: {
      debug: () => undefined,
      info: (message, fields) => lines.push({ level: "info", message, fields }),
      warn: (message, fields) => lines.push({ level: "warn", message, fields }),
      error: () => undefined,
    },
  };
}

/** The seeded set with the runner's command provenance on it. */
function setWithProvenance(options: { readonly authorizedByAutoApproveAll?: boolean } = {}): FileChangeSet {
  const set = capturedSet(CHANGE_SET_ID);
  set.commandProvenance = create(TurnCommandProvenanceSchema, {
    consentToolCallIds: options.authorizedByAutoApproveAll === true ? [] : [CONSENT_TOOL_CALL],
    authorizedByAutoApproveAll: options.authorizedByAutoApproveAll === true,
  });
  return set;
}

/** A log holding these decisions and the person's allow of the consent call when `allowed`. */
function logWith(decisions: ReadonlyArray<LoggedDecision> = [], allowed = false): RunReviewLog {
  return {
    decisions,
    allowed: new Set(allowed ? [toolUseEventId(RUN_ID, CONSENT_TOOL_CALL)] : []),
  };
}

/** A person's decision as the log states it. */
function personInLog(scope: ScopeWord, action: ActionWord, fileChangeId = ""): LoggedDecision {
  return { changeSetId: CHANGE_SET_ID, scope, fileChangeId, action, origin: "person", decidedBy: "usr_person" };
}

/** The decided events' bodies, in order. */
function decided(events: ReadonlyArray<SessionEvent>) {
  return events.map((event) => {
    if (event.event.case !== "stigmerFileReviewDecided") {
      throw new Error(`a rule returns decided events, not ${event.event.case}`);
    }
    expect(event.runId).toBe(RUN_ID);
    return event.event.value;
  });
}

/** The seeded set with a second complete change, `fc-2`, beside the seed's `fc-1`. */
function setWithTwoChanges(): FileChangeSet {
  const second = reviewableChange();
  second.id = "fc-2";
  second.pathBefore = "src/b.ts";
  second.pathAfter = "src/b.ts";
  second.fileDigest = fileDigest(second);
  return capturedSet(CHANGE_SET_ID, [reviewableChange(), second]);
}

/** The seeded set with its one change not reviewable whole. */
function blockedSet(): FileChangeSet {
  const set = capturedSet(CHANGE_SET_ID);
  const [change] = set.changes;
  if (change === undefined) throw new Error("the seed carries one change");
  change.diffComplete = false;
  set.diffCompleteness = DiffCompleteness.PARTIAL_BLOCKED;
  return set;
}

describe("autoKeepApprovedCommandSets", () => {
  it("keeps a reviewable set whose every command the person approved, as an approved_command decision naming nobody, and says so", () => {
    const { logger, lines } = capturingLogger();
    const set = setWithProvenance();

    const kept = decided(autoKeepApprovedCommandSets([set], RUN_ID, false, logger, logWith([], true)));

    expect(kept.map((d) => [d.id, d.changeSetId, d.scope, d.action, d.origin, d.expectedDigest, d.decidedBy])).toEqual([
      [
        fileReviewDecidedEventId(CHANGE_SET_ID, "change_set", ""),
        CHANGE_SET_ID,
        "change_set",
        "keep",
        "approved_command",
        set.aggregateDigest,
        "",
      ],
    ]);
    expect(lines).toEqual([
      {
        level: "info",
        message: "Auto-kept change set: every change produced by an approved command",
        fields: {
          executionId: RUN_ID,
          changeSetId: CHANGE_SET_ID,
          consentToolCallIds: [CONSENT_TOOL_CALL],
          authorizedByAutoApproveAll: false,
        },
      },
    ]);
  });

  it("keeps nothing on a second pass: the log shows the set decided", () => {
    const { logger } = capturingLogger();
    const set = setWithProvenance();
    const first = autoKeepApprovedCommandSets([set], RUN_ID, false, logger, logWith([], true));

    expect(autoKeepApprovedCommandSets([set], RUN_ID, false, logger, withDecisions(logWith([], true), first))).toEqual([]);
  });

  it("leaves a set a person decided in part to the person, as the log states it", () => {
    const log = logWith([personInLog("file", "undo", "fc-1")], true);
    expect(autoKeepApprovedCommandSets([setWithProvenance()], RUN_ID, false, capturingLogger().logger, log)).toEqual([]);
  });

  it("leaves the set for manual review when the log holds no allow for the cited command", () => {
    const { logger, lines } = capturingLogger();

    expect(autoKeepApprovedCommandSets([setWithProvenance()], RUN_ID, false, logger, logWith())).toEqual([]);
    expect(lines.map((l) => [l.level, l.message])).toEqual([
      [
        "warn",
        "Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review",
      ],
    ]);
  });

  it("leaves a set with no provenance, and one not reviewable whole, for a person", () => {
    const { logger, lines } = capturingLogger();
    expect(autoKeepApprovedCommandSets([capturedSet(CHANGE_SET_ID)], RUN_ID, false, logger, logWith([], true))).toEqual([]);

    const blocked = blockedSet();
    blocked.commandProvenance = setWithProvenance().commandProvenance;
    expect(autoKeepApprovedCommandSets([blocked], RUN_ID, false, logger, logWith([], true))).toEqual([]);
    expect(lines.map((l) => [l.level, l.message])).toEqual([
      ["info", "Auto-keep skipped: set not fully reviewable — manual review"],
    ]);
  });

  it("refuses an auto-approve-all claim the run's spec does not grant, and honours one it does", () => {
    const set = setWithProvenance({ authorizedByAutoApproveAll: true });
    expect(autoKeepApprovedCommandSets([set], RUN_ID, false, capturingLogger().logger, logWith())).toEqual([]);

    const granted = decided(autoKeepApprovedCommandSets([set], RUN_ID, true, capturingLogger().logger, logWith()));
    expect(granted.map((d) => d.origin)).toEqual(["approved_command"]);
  });

  it("refuses a claim that cites no consent at all", () => {
    const set = setWithProvenance();
    set.commandProvenance = create(TurnCommandProvenanceSchema, {});
    expect(autoKeepApprovedCommandSets([set], RUN_ID, true, capturingLogger().logger, logWith([], true))).toEqual([]);
  });

  it("leaves a set still being captured for the write that captures it", () => {
    const set = capturedSet(CHANGE_SET_ID, [], false);
    set.commandProvenance = setWithProvenance().commandProvenance;
    expect(autoKeepApprovedCommandSets([set], RUN_ID, false, capturingLogger().logger, logWith([], true))).toEqual([]);
  });
});

describe("autoKeepPluginEvalTrySets", () => {
  it("keeps a try's undecided change set by its own rule, once", () => {
    const { logger } = capturingLogger();
    const set = capturedSet(CHANGE_SET_ID);
    const first = autoKeepPluginEvalTrySets([set], RUN_ID, true, logger, logWith());
    expect(decided(first).map((d) => [d.origin, d.reason, d.decidedBy])).toEqual([
      [
        "eval_try",
        "Kept automatically: a plugin eval's try keeps its edits, as Claude Code's evals do; nobody reviews a try",
        "",
      ],
    ]);
    expect(
      autoKeepPluginEvalTrySets([set], RUN_ID, true, logger, withDecisions(logWith(), first)),
      "a decided set is left alone",
    ).toEqual([]);
  });

  it("leaves a set that cannot be kept whole to the try's timeout, and says so", () => {
    const { logger, lines } = capturingLogger();

    expect(autoKeepPluginEvalTrySets([blockedSet()], RUN_ID, true, logger, logWith())).toEqual([]);
    expect(lines.map((l) => [l.level, l.message, l.fields?.["changeSetId"]])).toEqual([
      ["warn", "Eval try keep skipped: set cannot be approved whole", CHANGE_SET_ID],
    ]);
  });

  it("keeps nothing for a run that is not a try", () => {
    expect(autoKeepPluginEvalTrySets([capturedSet(CHANGE_SET_ID)], RUN_ID, false, capturingLogger().logger, logWith())).toEqual([]);
  });
});

describe("keepOutdatedSets", () => {
  it("keeps a set nobody decided with one change-set keep, origin next_turn, bound to its aggregate", () => {
    const set = capturedSet(CHANGE_SET_ID);

    expect(
      decided(keepOutdatedSets([set], RUN_ID, logWith())).map((d) => [
        d.id,
        d.scope,
        d.action,
        d.origin,
        d.expectedDigest,
        d.fileChangeId,
        d.reason,
        d.decidedBy,
      ]),
    ).toEqual([
      [
        fileReviewDecidedEventId(CHANGE_SET_ID, "change_set", ""),
        "change_set",
        "keep",
        "next_turn",
        aggregateDigest(set.changes),
        "",
        "Kept automatically: the next message was sent before these edits were decided",
        "",
      ],
    ]);
  });

  it("keeps each file a person left undecided in a partly decided set, and leaves the person's decision standing", () => {
    const set = setWithTwoChanges();
    const kept = decided(keepOutdatedSets([set], RUN_ID, logWith([personInLog("file", "undo", "fc-1")])));
    expect(kept.map((d) => [d.id, d.scope, d.fileChangeId, d.action, d.origin, d.expectedDigest])).toEqual([
      [fileReviewDecidedEventId(CHANGE_SET_ID, "file", "fc-2"), "file", "fc-2", "keep", "next_turn", set.changes[1]?.fileDigest],
    ]);
  });

  it("leaves a set already decided alone", () => {
    expect(keepOutdatedSets([capturedSet(CHANGE_SET_ID)], RUN_ID, logWith([personInLog("change_set", "undo")]))).toEqual([]);
  });

  it("reads what is decided from the log: every file decided leaves the set alone", () => {
    const log = logWith([personInLog("file", "undo", "fc-1"), personInLog("file", "keep", "fc-2")]);
    expect(keepOutdatedSets([setWithTwoChanges()], RUN_ID, log)).toEqual([]);
  });

  it("keeps nothing on a second pass: the keeps are in the log", () => {
    const set = setWithTwoChanges();
    const log = logWith([personInLog("file", "keep", "fc-2")]);
    const first = keepOutdatedSets([set], RUN_ID, log);
    expect(first).toHaveLength(1);

    expect(keepOutdatedSets([set], RUN_ID, withDecisions(log, first))).toEqual([]);
  });

  it("keeps an unreviewable set too: the files are already on disk, so no completeness gate applies", () => {
    expect(keepOutdatedSets([blockedSet()], RUN_ID, logWith())).toHaveLength(1);
  });

  it("leaves a set still being captured for the write that captures it, and a run with no record keeps nothing", () => {
    expect(keepOutdatedSets([capturedSet(CHANGE_SET_ID, [], false)], RUN_ID, EMPTY_RUN_REVIEW_LOG)).toEqual([]);
    expect(keepOutdatedSets([], RUN_ID, EMPTY_RUN_REVIEW_LOG)).toEqual([]);
  });
});
