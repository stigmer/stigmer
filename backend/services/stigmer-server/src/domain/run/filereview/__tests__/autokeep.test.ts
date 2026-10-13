/**
 * Pins the approved-command auto-keep policy (autokeep.ts): a captured
 * change set whose every mutation came from commands the human approved
 * (an allow in the session's log, whatever the call's row says) is kept
 * by a policy decision, and every claim the server cannot verify against
 * its own records falls back to manual review, as does a set the log
 * shows a person decided. A plugin eval's
 * try keeps its change set by its own policy, whatever produced it, except
 * a set that cannot be approved whole, and a run that is no try keeps
 * nothing that way. Once a later message is sent, a turn's undecided
 * edits are kept with origin next turn: a whole set nobody decided by one
 * change-set keep, a set decided in part by one file keep per file left,
 * an unreviewable set too, a set still capturing not yet, and only once.
 * What is decided is read from the log handed in (`RunReviewLog`), never
 * from the ledger, which a keep only writes; a test's log after a keep is
 * the one the write's decided mirror leaves (`mirrored`). The seed is the
 * shared one-change file-review ledger (../../__tests__/file-review-seed.ts)
 * with the runner's command provenance added to its candidate.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  DiffCompleteness,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  FileDecisionSchema,
  TurnCommandProvenanceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import type { LogFields, Logger } from "../../../../boot/logger.js";
import { fileReviewSeed, reviewableChange } from "../../__tests__/file-review-seed.js";
import { originWordOf } from "../../../session/filereview/words.js";
import { toolUseEventId } from "../../../session/events/ids.js";
import { ACTOR_POLICY, ACTOR_USER, recordFileDecisionEventWithActor } from "../author.js";
import { autoKeepApprovedCommandSets, autoKeepPluginEvalTrySets, keepOutdatedSets } from "../autokeep.js";
import { aggregateDigest, fileDigest } from "../digest.js";
import { EMPTY_RUN_REVIEW_LOG } from "../logged.js";
import type { LoggedDecision, RunReviewLog } from "../logged.js";
import { projectFileChangeSets } from "../project.js";

const EXECUTION_ID = "aex_autokeep";
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

/**
 * The seeded execution with the candidate's command provenance set and,
 * when `approval` is given, the cited shell call on the transcript carrying
 * that server-authored approval.
 */
function statusWithProvenance(options: {
  readonly approval?: ApprovalAction;
  readonly authorizedByAutoApproveAll?: boolean;
}): RunStatus {
  const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
  const candidate = status.fileReviewEventStream?.events[1];
  if (candidate?.payload.case !== "candidateCaptured") {
    throw new Error("the seed's second event is the candidate");
  }
  candidate.payload.value.commandProvenance = create(TurnCommandProvenanceSchema, {
    consentToolCallIds: options.authorizedByAutoApproveAll === true ? [] : [CONSENT_TOOL_CALL],
    authorizedByAutoApproveAll: options.authorizedByAutoApproveAll === true,
  });
  if (options.approval !== undefined) {
    status.messages.push(
      create(AgentMessageSchema, {
        toolCalls: [{ id: CONSENT_TOOL_CALL, name: "run_shell", approvalAction: options.approval }],
      }),
    );
  }
  return status;
}

/** A log holding these decisions and the person's allow of the consent call when `allowed`. */
function logWith(decisions: ReadonlyArray<LoggedDecision> = [], allowed = false): RunReviewLog {
  return {
    decisions,
    allowed: new Set(allowed ? [toolUseEventId(EXECUTION_ID, CONSENT_TOOL_CALL)] : []),
  };
}

/** The log the write's decided mirror leaves: one decision per FILE_DECIDED the ledger holds. */
function mirrored(status: RunStatus, base: RunReviewLog = EMPTY_RUN_REVIEW_LOG): RunReviewLog {
  const decisions = (status.fileReviewEventStream?.events ?? []).flatMap((ev) =>
    ev.payload.case === "fileDecided"
      ? [
          {
            changeSetId: ev.payload.value.changeSetId,
            scope: ev.payload.value.scope,
            fileChangeId: ev.payload.value.fileChangeId,
            action: ev.payload.value.action,
            origin: originWordOf(ev.payload.value.origin) ?? "",
          },
        ]
      : [],
  );
  return { decisions, allowed: base.allowed };
}

/** A person's decision as the log states it. */
function personInLog(scope: FileDecisionScope, action: FileDecisionAction, fileChangeId = ""): LoggedDecision {
  return { changeSetId: CHANGE_SET_ID, scope, fileChangeId, action, origin: "person" };
}

function decisionsOf(status: RunStatus) {
  const stream = status.fileReviewEventStream;
  if (stream === undefined) throw new Error("the seed carries a file-review ledger");
  const [cs] = projectFileChangeSets(stream);
  return cs?.decisions ?? [];
}

describe("autoKeepApprovedCommandSets", () => {
  it("keeps a reviewable set whose every command the human approved, as a policy decision, and says so", () => {
    const { logger, lines } = capturingLogger();
    const status = statusWithProvenance({});

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger, logWith([], true))).toBe(1);

    const decisions = decisionsOf(status);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.origin).toBe(FileDecisionOrigin.POLICY_APPROVED_COMMAND);
    expect(lines).toEqual([
      {
        level: "info",
        message: "Auto-kept change set: every change produced by an approved command",
        fields: {
          executionId: EXECUTION_ID,
          changeSetId: CHANGE_SET_ID,
          consentToolCallIds: [CONSENT_TOOL_CALL],
          authorizedByAutoApproveAll: false,
        },
      },
    ]);
  });

  it("is a no-op on a second pass: the decision already exists", () => {
    const { logger } = capturingLogger();
    const status = statusWithProvenance({});
    autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger, logWith([], true));

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger, mirrored(status, logWith([], true)))).toBe(0);
    expect(decisionsOf(status)).toHaveLength(1);
  });

  it("leaves a set a person decided in part to the person, as the log states it", () => {
    const status = statusWithProvenance({});
    const log = logWith([personInLog(FileDecisionScope.FILE, FileDecisionAction.REJECT, "fc-1")], true);
    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, capturingLogger().logger, log)).toBe(0);
    expect(decisionsOf(status)).toHaveLength(0);
  });

  it("leaves the set for manual review when the log holds no allow for the cited command, whatever its row says", () => {
    const { logger, lines } = capturingLogger();
    const status = statusWithProvenance({ approval: ApprovalAction.APPROVE });

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger, logWith())).toBe(0);
    expect(decisionsOf(status)).toHaveLength(0);
    expect(lines.map((l) => [l.level, l.message])).toEqual([
      [
        "warn",
        "Auto-keep skipped: claimed consent did not verify against server-authored approvals — manual review",
      ],
    ]);
  });

  it("leaves the set for manual review when the cited command is not on the transcript at all", () => {
    const { logger } = capturingLogger();
    const status = statusWithProvenance({});

    expect(autoKeepApprovedCommandSets(status, EXECUTION_ID, false, logger, logWith())).toBe(0);
    expect(decisionsOf(status)).toHaveLength(0);
  });

  it("refuses an auto-approve-all claim the execution's spec does not grant, and honours one it does", () => {
    const refused = statusWithProvenance({ authorizedByAutoApproveAll: true });
    expect(autoKeepApprovedCommandSets(refused, EXECUTION_ID, false, capturingLogger().logger, logWith())).toBe(0);

    const granted = statusWithProvenance({ authorizedByAutoApproveAll: true });
    expect(autoKeepApprovedCommandSets(granted, EXECUTION_ID, true, capturingLogger().logger, logWith())).toBe(1);
    expect(decisionsOf(granted)[0]?.origin).toBe(FileDecisionOrigin.POLICY_APPROVED_COMMAND);
  });
});

describe("autoKeepPluginEvalTrySets", () => {
  it("keeps a try's undecided change set by policy, once", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    const { logger } = capturingLogger();
    expect(autoKeepPluginEvalTrySets(status, EXECUTION_ID, true, logger, logWith())).toBe(1);
    expect(decisionsOf(status).map((d) => [d.origin, d.reason])).toEqual([
      [
        FileDecisionOrigin.POLICY_EVAL_TRY,
        "Kept automatically: a plugin eval's try keeps its edits, as Claude Code's evals do; nobody reviews a try",
      ],
    ]);
    expect(autoKeepPluginEvalTrySets(status, EXECUTION_ID, true, logger, mirrored(status)), "a decided set is left alone").toBe(0);
  });

  it("leaves a set that cannot be approved whole to the try's timeout, and says so", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    const candidate = status.fileReviewEventStream?.events[1];
    if (candidate?.payload.case !== "candidateCaptured") {
      throw new Error("the seed's second event is the candidate");
    }
    const [change] = candidate.payload.value.changes;
    if (change === undefined) throw new Error("the seed's candidate carries one change");
    change.diffComplete = false;
    candidate.payload.value.diffCompleteness = DiffCompleteness.PARTIAL_BLOCKED;
    const { logger, lines } = capturingLogger();

    expect(autoKeepPluginEvalTrySets(status, EXECUTION_ID, true, logger, logWith())).toBe(0);
    expect(decisionsOf(status)).toEqual([]);
    expect(lines.map((l) => [l.level, l.message, l.fields?.["changeSetId"]])).toEqual([
      ["warn", "Eval try keep skipped: set cannot be approved whole", CHANGE_SET_ID],
    ]);
  });

  it("keeps nothing for a run that is not a try", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    expect(autoKeepPluginEvalTrySets(status, EXECUTION_ID, false, capturingLogger().logger, logWith())).toBe(0);
    expect(decisionsOf(status)).toEqual([]);
  });
});

/** The seeded status with a second complete change, `fc-2`, beside the seed's `fc-1`. */
function statusWithTwoChanges(): RunStatus {
  const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
  const candidate = status.fileReviewEventStream?.events[1];
  if (candidate?.payload.case !== "candidateCaptured") {
    throw new Error("the seed's second event is the candidate");
  }
  const second = reviewableChange();
  second.id = "fc-2";
  second.pathBefore = "src/b.ts";
  second.pathAfter = "src/b.ts";
  second.fileDigest = fileDigest(second);
  candidate.payload.value.changes.push(second);
  candidate.payload.value.aggregateDigest = aggregateDigest(candidate.payload.value.changes);
  return status;
}

function personDecides(status: RunStatus, scope: FileDecisionScope, action: FileDecisionAction, fileChangeId = ""): void {
  const decision = create(FileDecisionSchema, {
    changeSetId: CHANGE_SET_ID,
    fileChangeId,
    scope,
    action,
    origin: FileDecisionOrigin.USER,
    decidedAt: "2026-10-12T09:00:00Z",
  });
  decision.id = `${CHANGE_SET_ID}:${scope === FileDecisionScope.FILE ? fileChangeId : CHANGE_SET_ID}`;
  recordFileDecisionEventWithActor(status, EXECUTION_ID, decision, ACTOR_USER);
}

function actorsOf(status: RunStatus): string[] {
  return (status.fileReviewEventStream?.events ?? []).filter((ev) => ev.payload.case === "fileDecided").map((ev) => ev.actor);
}

describe("keepOutdatedSets", () => {
  it("keeps a set nobody decided with one change-set keep, by policy, origin next turn, bound to its aggregate", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    const aggregate = fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).aggregate;

    expect(keepOutdatedSets(status, EXECUTION_ID, logWith())).toBe(1);
    expect(
      decisionsOf(status).map((d) => [d.id, d.scope, d.action, d.origin, d.expectedDigest, d.fileChangeId, d.reason]),
    ).toEqual([
      [
        `${CHANGE_SET_ID}:${CHANGE_SET_ID}`,
        FileDecisionScope.CHANGE_SET,
        FileDecisionAction.APPROVE,
        FileDecisionOrigin.POLICY_NEXT_TURN,
        aggregate,
        "",
        "Kept automatically: the next message was sent before these edits were decided",
      ],
    ]);
    expect(actorsOf(status)).toEqual([ACTOR_POLICY]);
  });

  it("keeps each file a person left undecided in a partly decided set, and leaves the person's decision standing", () => {
    const status = statusWithTwoChanges();
    personDecides(status, FileDecisionScope.FILE, FileDecisionAction.REJECT, "fc-1");

    expect(keepOutdatedSets(status, EXECUTION_ID, mirrored(status))).toBe(1);
    const second = statusWithTwoChanges().fileReviewEventStream?.events[1];
    const fc2Digest =
      second?.payload.case === "candidateCaptured" ? second.payload.value.changes[1]?.fileDigest : undefined;
    expect(decisionsOf(status).map((d) => [d.scope, d.fileChangeId, d.action, d.origin, d.expectedDigest])).toEqual([
      [FileDecisionScope.FILE, "fc-1", FileDecisionAction.REJECT, FileDecisionOrigin.USER, ""],
      [FileDecisionScope.FILE, "fc-2", FileDecisionAction.APPROVE, FileDecisionOrigin.POLICY_NEXT_TURN, fc2Digest],
    ]);
  });

  it("leaves a set already decided alone", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    personDecides(status, FileDecisionScope.CHANGE_SET, FileDecisionAction.REJECT);

    expect(keepOutdatedSets(status, EXECUTION_ID, mirrored(status))).toBe(0);
    expect(decisionsOf(status).map((d) => d.origin)).toEqual([FileDecisionOrigin.USER]);
  });

  it("reads what is decided from the log, not the ledger: a decision only the log holds leaves the set alone", () => {
    const status = statusWithTwoChanges();
    const log = logWith([
      personInLog(FileDecisionScope.FILE, FileDecisionAction.REJECT, "fc-1"),
      personInLog(FileDecisionScope.FILE, FileDecisionAction.APPROVE, "fc-2"),
    ]);
    expect(keepOutdatedSets(status, EXECUTION_ID, log)).toBe(0);
    expect(decisionsOf(status)).toEqual([]);
  });

  it("is a no-op on a second pass: the keeps already exist", () => {
    const status = statusWithTwoChanges();
    personDecides(status, FileDecisionScope.FILE, FileDecisionAction.APPROVE, "fc-2");
    expect(keepOutdatedSets(status, EXECUTION_ID, mirrored(status))).toBe(1);

    expect(keepOutdatedSets(status, EXECUTION_ID, mirrored(status))).toBe(0);
    expect(decisionsOf(status)).toHaveLength(2);
  });

  it("keeps an unreviewable set too: the files are already on disk, so no completeness gate applies", () => {
    const status = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    const candidate = status.fileReviewEventStream?.events[1];
    if (candidate?.payload.case !== "candidateCaptured") {
      throw new Error("the seed's second event is the candidate");
    }
    const [change] = candidate.payload.value.changes;
    if (change === undefined) throw new Error("the seed's candidate carries one change");
    change.diffComplete = false;
    candidate.payload.value.diffCompleteness = DiffCompleteness.PARTIAL_BLOCKED;

    expect(keepOutdatedSets(status, EXECUTION_ID, logWith())).toBe(1);
  });

  it("leaves a set still capturing for the write that folds its candidate, and a run with no ledger keeps nothing", () => {
    const capturing = create(RunStatusSchema, fileReviewSeed(EXECUTION_ID, CHANGE_SET_ID).status);
    capturing.fileReviewEventStream?.events.splice(1);
    expect(keepOutdatedSets(capturing, EXECUTION_ID, logWith())).toBe(0);
    expect(keepOutdatedSets(create(RunStatusSchema), EXECUTION_ID, logWith())).toBe(0);
  });
});
