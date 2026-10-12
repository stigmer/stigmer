// Unit arms for the file-review helpers. What they pin:
// - a decision, on the session's method or the run's adapter, is correlated
//   by the change's or the set's id and bound to the digest the reviewer saw
//   (the change's file_digest at FILE scope, the set's aggregate_digest at
//   CHANGE_SET scope) unless the arm overrides it; a path the set does not
//   hold is red at the helper, naming the paths it does hold, before
//   anything is submitted;
// - the review wait answers the ended turn holding a set awaiting review, and
//   is red, naming the sets, when the turn ended with none;
// - the log readers split the three file-review event types out of a log in
//   order, and the reconcile wait returns a change set's reconciled event
//   only once the session is idle, naming the log it saw when it times out;
// - a session spec carries file_review only when asked.
// Pure: hand-built resources and stubbed clients, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { FileChangeSetSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { type SessionEvent, SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ReviewFileChangesResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  awaitFileReview,
  awaitReconciled,
  fileReviewLogOf,
  readFileReviewLog,
  reviewChangeSet,
  reviewFileByPath,
  submitChangeSetDecision,
  submitFileDecisionByPath,
} from "../file-review";
import { makeSessionSpec } from "../sessions";

const SET = create(FileChangeSetSchema, {
  id: "fcs_unit",
  aggregateDigest: "sha256:set",
  changes: [
    { id: "fc_added", pathAfter: "src/new.ts", fileDigest: "sha256:new" },
    { id: "fc_deleted", pathBefore: "src/old.ts", fileDigest: "sha256:old" },
  ],
});

function commandClient() {
  const answer = create(RunSchema, { metadata: { id: "aex_unit" } });
  const submitFileDecision = vi.fn(async () => answer);
  const clients = { agentExecutionCommand: { submitFileDecision } } as unknown as ConformanceClients;
  return { clients, submitFileDecision, answer };
}

describe("submitFileDecisionByPath", () => {
  it("decides the change at that path by its id, bound to its file digest, and returns the response", async () => {
    const c = commandClient();
    const response = await submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/old.ts", FileDecisionAction.REJECT);
    expect(response).toBe(c.answer);
    expect(c.submitFileDecision).toHaveBeenCalledWith({
      runId: "aex_unit",
      changeSetId: "fcs_unit",
      scope: FileDecisionScope.FILE,
      fileChangeId: "fc_deleted",
      action: FileDecisionAction.REJECT,
      expectedDigest: "sha256:old",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries the digest, acknowledgement and reason an arm overrides", async () => {
    const c = commandClient();
    await submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/new.ts", FileDecisionAction.APPROVE, {
      expectedDigest: "sha256:stale",
      acknowledgeUnreviewable: true,
      reason: "binary kept",
    });
    expect(c.submitFileDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        fileChangeId: "fc_added",
        expectedDigest: "sha256:stale",
        acknowledgeUnreviewable: true,
        reason: "binary kept",
      }),
    );
  });

  it("is red naming the set's paths when the path is not in it, and submits nothing", () => {
    const c = commandClient();
    expect(() =>
      submitFileDecisionByPath(c.clients, "aex_unit", SET, "src/missing.ts", FileDecisionAction.APPROVE),
    ).toThrow('change set fcs_unit has no change for src/missing.ts (paths: ["src/new.ts","src/old.ts"])');
    expect(c.submitFileDecision).not.toHaveBeenCalled();
  });
});

describe("submitChangeSetDecision", () => {
  it("decides the whole set by its id, bound to its aggregate digest", async () => {
    const c = commandClient();
    const response = await submitChangeSetDecision(c.clients, "aex_unit", SET, FileDecisionAction.APPROVE);
    expect(response).toBe(c.answer);
    expect(c.submitFileDecision).toHaveBeenCalledWith({
      runId: "aex_unit",
      changeSetId: "fcs_unit",
      scope: FileDecisionScope.CHANGE_SET,
      action: FileDecisionAction.APPROVE,
      expectedDigest: "sha256:set",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries an overridden digest and reason", async () => {
    const c = commandClient();
    await submitChangeSetDecision(c.clients, "aex_unit", SET, FileDecisionAction.REJECT, {
      expectedDigest: "sha256:stale",
      reason: "not this",
    });
    expect(c.submitFileDecision).toHaveBeenCalledWith(
      expect.objectContaining({ expectedDigest: "sha256:stale", reason: "not this", scope: FileDecisionScope.CHANGE_SET }),
    );
  });
});

function sessionCommandClient() {
  const answer = create(ReviewFileChangesResponseSchema, { reconcileRunId: "run_reconcile" });
  const reviewFileChanges = vi.fn(async () => answer);
  const clients = { sessionCommand: { reviewFileChanges } } as unknown as ConformanceClients;
  return { clients, reviewFileChanges, answer };
}

describe("reviewFileByPath", () => {
  it("keeps or undoes the change at that path by its id, bound to its file digest, and returns the answer", async () => {
    const c = sessionCommandClient();
    const response = await reviewFileByPath(c.clients, "ses_unit", SET, "src/old.ts", "undo");
    expect(response).toBe(c.answer);
    expect(c.reviewFileChanges).toHaveBeenCalledWith({
      sessionId: "ses_unit",
      changeSetId: "fcs_unit",
      scope: "file",
      fileChangeId: "fc_deleted",
      action: "undo",
      expectedDigest: "sha256:old",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries the digest, acknowledgement and reason an arm overrides", async () => {
    const c = sessionCommandClient();
    await reviewFileByPath(c.clients, "ses_unit", SET, "src/new.ts", "keep", {
      expectedDigest: "sha256:stale",
      acknowledgeUnreviewable: true,
      reason: "binary kept",
    });
    expect(c.reviewFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        fileChangeId: "fc_added",
        action: "keep",
        expectedDigest: "sha256:stale",
        acknowledgeUnreviewable: true,
        reason: "binary kept",
      }),
    );
  });

  it("is red naming the set's paths when the path is not in it, and decides nothing", () => {
    const c = sessionCommandClient();
    expect(() => reviewFileByPath(c.clients, "ses_unit", SET, "src/missing.ts", "keep")).toThrow(
      'change set fcs_unit has no change for src/missing.ts (paths: ["src/new.ts","src/old.ts"])',
    );
    expect(c.reviewFileChanges).not.toHaveBeenCalled();
  });
});

describe("reviewChangeSet", () => {
  it("keeps or undoes the whole set by its id, bound to its aggregate digest", async () => {
    const c = sessionCommandClient();
    const response = await reviewChangeSet(c.clients, "ses_unit", SET, "keep");
    expect(response).toBe(c.answer);
    expect(c.reviewFileChanges).toHaveBeenCalledWith({
      sessionId: "ses_unit",
      changeSetId: "fcs_unit",
      scope: "change_set",
      action: "keep",
      expectedDigest: "sha256:set",
      acknowledgeUnreviewable: false,
      reason: "",
    });
  });

  it("carries an overridden digest, acknowledgement and reason", async () => {
    const c = sessionCommandClient();
    await reviewChangeSet(c.clients, "ses_unit", SET, "undo", {
      expectedDigest: "sha256:stale",
      acknowledgeUnreviewable: true,
      reason: "not this",
    });
    expect(c.reviewFileChanges).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "change_set",
        action: "undo",
        expectedDigest: "sha256:stale",
        acknowledgeUnreviewable: true,
        reason: "not this",
      }),
    );
  });
});

function queryClient(answers: Array<ReturnType<typeof create<typeof RunSchema>>>) {
  let index = 0;
  const get = vi.fn(async () => answers[Math.min(index++, answers.length - 1)]);
  return { clients: { agentExecutionQuery: { get } } as unknown as ConformanceClients, get };
}

describe("awaitFileReview", () => {
  it("answers the ended turn once it holds a set awaiting review", async () => {
    const working = create(RunSchema, { metadata: { id: "aex_unit" }, status: { phase: RunPhase.RUN_IN_PROGRESS } });
    const ended = create(RunSchema, {
      metadata: { id: "aex_unit" },
      status: {
        phase: RunPhase.RUN_COMPLETED,
        fileChangeSets: [{ id: "aex_unit:1", status: FileChangeSetStatus.AWAITING_REVIEW }],
      },
    });
    const q = queryClient([working, ended]);
    expect(await awaitFileReview(q.clients, "aex_unit", { pollMs: 1 })).toBe(ended);
    expect(q.get).toHaveBeenCalledTimes(2);
  });

  it("is red naming the sets when the turn ended with none awaiting review", async () => {
    const ended = create(RunSchema, {
      metadata: { id: "aex_unit" },
      status: { phase: RunPhase.RUN_COMPLETED, fileChangeSets: [{ id: "aex_unit:1", status: FileChangeSetStatus.DECIDED }] },
    });
    await expect(awaitFileReview(queryClient([ended]).clients, "aex_unit", { pollMs: 1 })).rejects.toThrow(
      'execution aex_unit has no change set AWAITING_REVIEW (sets: ["DECIDED"])',
    );
  });
});

function event(init: Parameters<typeof create<typeof SessionEventSchema>>[1]): SessionEvent {
  return create(SessionEventSchema, init);
}

const CHANGES = event({ event: { case: "stigmerFileReviewChanges", value: { id: "run_a.fr1", changeSetId: "run_a:1" } } });
const DECIDED = event({ event: { case: "stigmerFileReviewDecided", value: { id: "sevt_fd_1", changeSetId: "run_a:1", action: "undo" } } });
const RECONCILED = event({
  event: { case: "stigmerFileReviewReconciled", value: { id: "run_a.fr1.r", changeSetId: "run_a:1", undonePaths: ["a.txt"] } },
});
const RUNNING = event({ event: { case: "sessionStatusRunning", value: { id: "evt_running" } } });
const IDLE = event({ event: { case: "sessionStatusIdle", value: { id: "evt_idle", stopReason: { type: "end_turn" } } } });

function eventsClient(answers: SessionEvent[][]) {
  let index = 0;
  const listEvents = vi.fn(async () => ({ events: answers[Math.min(index++, answers.length - 1)] }));
  return { clients: { sessionQuery: { listEvents } } as unknown as ConformanceClients, listEvents };
}

describe("the file-review log readers", () => {
  it("split the three file-review types out of a log, in order, leaving every other type out", async () => {
    const log = [RUNNING, CHANGES, DECIDED, RECONCILED, IDLE];
    expect(fileReviewLogOf(log)).toEqual({
      changes: [CHANGES.event.value],
      decided: [DECIDED.event.value],
      reconciled: [RECONCILED.event.value],
    });
    const c = eventsClient([log]);
    expect(await readFileReviewLog(c.clients, "ses_unit")).toEqual(fileReviewLogOf(log));
    expect(c.listEvents).toHaveBeenCalledWith({ sessionId: "ses_unit", pageSize: 1000 });
  });

  it("wait for a change set's reconciled event until the session is idle again", async () => {
    const c = eventsClient([
      [CHANGES, DECIDED, RUNNING],
      [CHANGES, DECIDED, RUNNING, RECONCILED],
      [CHANGES, DECIDED, RUNNING, RECONCILED, IDLE],
    ]);
    expect(await awaitReconciled(c.clients, "ses_unit", "run_a:1", { pollMs: 1 })).toEqual(RECONCILED.event.value);
    expect(c.listEvents).toHaveBeenCalledTimes(3);
  });

  it("name the log they saw when the change set is never reconciled", async () => {
    const c = eventsClient([[CHANGES, DECIDED, RECONCILED, IDLE]]);
    await expect(awaitReconciled(c.clients, "ses_unit", "run_b:1", { pollMs: 1, timeoutMs: 5 })).rejects.toThrow(
      'session ses_unit: change set run_b:1 was not reconciled with the session idle within 5ms ' +
        '(log: ["stigmerFileReviewChanges","stigmerFileReviewDecided","stigmerFileReviewReconciled","sessionStatusIdle"])',
    );
  });
});

describe("makeSessionSpec and file review", () => {
  it("carries file_review only when the session asks for it", () => {
    expect(makeSessionSpec({ fileReview: true }).fileReview).toBe(true);
    expect(makeSessionSpec({}).fileReview).toBeUndefined();
  });
});
