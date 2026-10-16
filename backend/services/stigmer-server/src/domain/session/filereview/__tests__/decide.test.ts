/**
 * Pins the one decision core (../decide.ts) on a real store: a person's
 * keep or undo lands in the session's log as its decided event, on the
 * change set's run and naming the person in decided_by, only
 * while the set's turn is the conversation's newest (a reconcile turn
 * never moves it on), only for a set of the session asked in, for a file
 * the set holds, through the digest and completeness gates, once per
 * target (a different decision on a decided target refused), a store
 * fault answering a bare Internal; and every undo on an ended turn starts
 * a reconcile turn, as the person, the decision standing whatever the
 * create answers.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { fileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import type { FileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import { fileDigest } from "../../../run/filereview/digest.js";
import { SessionEventBroker } from "../../events/broker.js";
import { eventOf } from "../../events/codec.js";
import { createRunAppendingEvents } from "../../events/run-writes.js";
import {
  CONFLICTING_DECISION_MESSAGE,
  CONVERSATION_MOVED_ON_MESSAGE,
  decideFileChanges,
  runIdOfChangeSet,
} from "../decide.js";
import type {
  FileDecisionAsked,
  FileDecisionDeps,
  ReconcileTurnCreator,
} from "../decide.js";
import type { ActionWord } from "../words.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});
const SESSION = "ses_1";
const ORG = "org_acme";
const PERSON = testCallerIdentity({ identityId: "usr_person" });

let temp: TempStore;
let created: Array<{ run: Run; caller: CallerIdentity }>;
let createAnswer: "persist" | Error;

function deps(): FileDecisionDeps {
  const base = {
    store: temp.store,
    sessionEventBroker: new SessionEventBroker(silentLogger),
  };
  const creator: ReconcileTurnCreator = {
    async create(run, caller) {
      created.push({ run, caller });
      if (createAnswer instanceof Error) {
        throw createAnswer;
      }
      // As the run create chain would: persisted, pending, in the session.
      const row = clone(RunSchema, run);
      row.metadata!.id = `run_reconcile_${created.length}`;
      row.status = create(RunStatusSchema, { phase: RunPhase.RUN_PENDING });
      await createRunAppendingEvents(base, row);
      return row;
    },
  };
  return {
    ...base,
    logger: silentLogger,
    reconcileTurns: () => creator,
  };
}

beforeEach(() => {
  temp = tempStore();
  created = [];
  createAnswer = "persist";
});

afterEach(async () => {
  await temp.cleanup();
});

/** A turn of the session with `sets` captured change sets (`<id>:1`, ...), stored as the create chain stores it. */
async function seedTurn(
  id: string,
  phase: RunPhase,
  sets = 1,
  sessionId = SESSION,
): Promise<FileReviewSeed[]> {
  const seeds = Array.from({ length: sets }, (_, i) =>
    fileReviewSeed(id, `${id}:${i + 1}`),
  );
  await storeTurn(id, phase, seeds, sessionId);
  return seeds;
}

async function storeTurn(
  id: string,
  phase: RunPhase,
  seeds: FileReviewSeed[],
  sessionId = SESSION,
): Promise<void> {
  const fileChanges = seeds.flatMap((seed) => seed.status.fileChanges ?? []);
  await createRunAppendingEvents(
    {
      store: temp.store,
      sessionEventBroker: new SessionEventBroker(silentLogger),
    },
    create(RunSchema, {
      metadata: { id, org: ORG },
      spec: {
        target: { case: "sessionId", value: sessionId },
        message: `turn ${id}`,
      },
      status: { phase, fileChanges },
    }),
  );
}

function setDecision(
  changeSetId: string,
  action: ActionWord,
  digest: string,
): FileDecisionAsked {
  return {
    changeSetId,
    scope: "change_set",
    fileChangeId: "",
    action,
    expectedDigest: digest,
    reason: "",
    acknowledgeUnreviewable: false,
  };
}

/** Decides as the person, in `sessionId`. */
function decide(asked: FileDecisionAsked, sessionId: string = SESSION) {
  return decideFileChanges(
    deps(),
    { runId: runIdOfChangeSet(asked.changeSetId), sessionId },
    asked,
    PERSON,
  );
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

/** The decided events of `runId` in the session's log, in order. */
async function decisionsOf(runId: string, sessionId = SESSION) {
  const records = await temp.store.sessionEvents.list(sessionId, {
    order: "asc",
    runId,
    types: ["stigmer.file_review.decided"],
    limit: 100,
  });
  return records.flatMap((record) => {
    const event = eventOf(record);
    return event.event.case === "stigmerFileReviewDecided" ? [event.event.value] : [];
  });
}

async function log(sessionId = SESSION): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(sessionId, {
    order: "asc",
    limit: 100,
  });
  return records.map(
    (record) => `${record.runId}:${eventTypeOf(eventOf(record))}`,
  );
}

describe("the change set's run", () => {
  it("is the text before the first ':' of the change set id", () => {
    expect(runIdOfChangeSet("run_1:3")).toBe("run_1");
    expect(runIdOfChangeSet("run_1:3:x")).toBe("run_1");
    expect(runIdOfChangeSet("run_1")).toBe("");
    expect(runIdOfChangeSet(":3")).toBe("");
  });

  it("must be one of the session's: another session's, an absent run, or no run at all is NOT_FOUND", async () => {
    const [seed] = await seedTurn(
      "run_1",
      RunPhase.RUN_COMPLETED,
      1,
      "ses_other",
    );
    const asked = setDecision(
      "run_1:1",
      "keep",
      seed!.aggregate,
    );
    expect((await refusal(decide(asked))).code).toBe(Code.NotFound);
    expect(
      (await refusal(decide({ ...asked, changeSetId: "run_gone:1" }))).code,
    ).toBe(Code.NotFound);
    expect(
      (await refusal(decide({ ...asked, changeSetId: "no-run" }))).code,
    ).toBe(Code.NotFound);
    expect(await decisionsOf("run_1", "ses_other")).toEqual([]);
  });
});

describe("a keep", () => {
  it("records the person's decision on the newest turn, with its decided event, and starts no turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const outcome = await decide(
      setDecision("run_1:1", "keep", seed!.aggregate),
    );

    expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
    expect(
      (await decisionsOf("run_1")).map((d) => [d.changeSetId, d.scope, d.action, d.origin, d.expectedDigest, d.decidedBy]),
    ).toEqual([["run_1:1", "change_set", "keep", "person", seed!.aggregate, "usr_person"]]);
    expect(outcome.run.status?.fileChanges.map((cs) => cs.id)).toEqual(["run_1:1"]);
    expect(created).toEqual([]);
  });

  it("the same decision again writes nothing and answers success", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      "keep",
      seed!.aggregate,
    );
    await decide(asked);
    const before = await log();

    const again = await decide(asked);
    expect(again.recorded).toBe(false);
    expect(await decisionsOf("run_1")).toHaveLength(1);
    expect(await log()).toEqual(before);
  });

  it("refuses a different decision on a target already decided, writes nothing and starts no turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    await decide(
      setDecision("run_1:1", "keep", seed!.aggregate),
    );
    const before = await log();

    const error = await refusal(
      decide(setDecision("run_1:1", "undo", seed!.aggregate)),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      CONFLICTING_DECISION_MESSAGE,
    ]);
    expect((await decisionsOf("run_1")).map((d) => d.action)).toEqual(["keep"]);
    expect(await log()).toEqual(before);
    expect(created).toEqual([]);
  });

  it("refuses a FILE decision naming a file the change set does not hold, and writes nothing", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const error = await refusal(
      decide({
        ...setDecision("run_1:1", "undo", seed!.aggregate),
        scope: "file",
        fileChangeId: "run_1:1:no-such-file.ts",
      }),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "file change run_1:1:no-such-file.ts not found in change set run_1:1",
    ]);
    expect(await decisionsOf("run_1")).toEqual([]);
  });

  it("refuses a digest the person did not review, and a keep of a change that cannot be shown whole; an undo of that change passes", async () => {
    const seed = fileReviewSeed("run_1", "run_1:1");
    seed.change.diffComplete = false;
    seed.change.fileDigest = fileDigest(seed.change);
    await storeTurn("run_1", RunPhase.RUN_COMPLETED, [seed]);
    const file = (
      action: ActionWord,
      digest: string,
    ): FileDecisionAsked => ({
      ...setDecision("run_1:1", action, digest),
      scope: "file",
      fileChangeId: seed.change.id,
    });

    expect(
      (await refusal(decide(file("undo", "0".repeat(64)))))
        .code,
    ).toBe(Code.InvalidArgument);
    expect(
      (
        await refusal(
          decide(file("keep", seed.change.fileDigest)),
        )
      ).code,
    ).toBe(Code.FailedPrecondition);
    expect(await decisionsOf("run_1")).toEqual([]);
    expect(
      (await decide(file("undo", seed.change.fileDigest)))
        .recorded,
    ).toBe(true);
  });
});

describe("a store fault", () => {
  it("during the write is an Internal that names no detail, and nothing is written", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    vi.spyOn(temp.store, "writeResourceAppendingEvents").mockRejectedValueOnce(
      new Error("disk I/O error"),
    );

    const error = await refusal(
      decide(
        setDecision("run_1:1", "undo", seed!.aggregate),
      ),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.Internal,
      "failed to persist file decision",
    ]);
    expect(await decisionsOf("run_1")).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe("the window", () => {
  it("closes when a later message is sent: a decision on the earlier turn is refused and nothing is written", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    await seedTurn("run_2", RunPhase.RUN_PENDING);

    const error = await refusal(
      decide(
        setDecision("run_1:1", "undo", seed!.aggregate),
      ),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      CONVERSATION_MOVED_ON_MESSAGE,
    ]);
    expect(await decisionsOf("run_1")).toEqual([]);
    expect(created).toEqual([]);
  });

  it("a person's own decision repeated after it closed still answers success", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      "keep",
      seed!.aggregate,
    );
    await decide(asked);
    await seedTurn("run_2", RunPhase.RUN_PENDING);

    expect((await decide(asked)).recorded).toBe(false);
  });

  it("stays open through a reconcile turn, which sends no message", async () => {
    const [first, second] = await seedTurn("run_1", RunPhase.RUN_COMPLETED, 2);
    await decide(
      setDecision("run_1:1", "undo", first!.aggregate),
    );
    expect(created).toHaveLength(1);

    const keep = await decide(
      setDecision("run_1:2", "keep", second!.aggregate),
    );
    expect(keep.recorded).toBe(true);
    expect(await log()).not.toContain("run_reconcile_1:user.message");
  });
});

describe("an undo", () => {
  it("on an ended turn starts a reconcile turn as the person, in the session and its organization, with no message", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const outcome = await decide(
      setDecision("run_1:1", "undo", seed!.aggregate),
    );

    expect(outcome.reconcileRunId).toBe("run_reconcile_1");
    expect(created).toHaveLength(1);
    const { run, caller } = created[0]!;
    expect(caller).toBe(PERSON);
    expect(run.metadata?.org).toBe(ORG);
    expect(run.spec?.target).toEqual({ case: "sessionId", value: SESSION });
    expect([run.spec?.reconcileFileReview, run.spec?.message]).toEqual([
      true,
      "",
    ]);
    expect((await decisionsOf("run_1")).map((d) => [d.action, d.decidedBy])).toEqual([["undo", "usr_person"]]);
  });

  it("starts one for every undo, even while another is unfinished: that one may have read what is owed already", async () => {
    const [first, second] = await seedTurn("run_1", RunPhase.RUN_COMPLETED, 2);
    await decide(
      setDecision("run_1:1", "undo", first!.aggregate),
    );
    const outcome = await decide(
      setDecision("run_1:2", "undo", second!.aggregate),
    );

    expect(outcome.recorded).toBe(true);
    expect(outcome.reconcileRunId).not.toBe("");
    expect(created).toHaveLength(2);
  });

  it("repeated starts no second turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      "undo",
      seed!.aggregate,
    );
    await decide(asked);
    expect((await decide(asked)).reconcileRunId).toBe("");
    expect(created).toHaveLength(1);
  });

  it("on a turn still working starts none: its next start restores the file", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_IN_PROGRESS);
    const outcome = await decide(
      setDecision("run_1:1", "undo", seed!.aggregate),
    );
    expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
    expect(created).toEqual([]);
  });

  it("stands when the reconcile turn's create is refused or fails, and names no turn", async () => {
    for (const [id, answer] of [
      ["run_1", new ConnectError("out of capacity", Code.ResourceExhausted)],
      ["run_2", new Error("transport down")],
    ] as const) {
      createAnswer = answer;
      const [seed] = await seedTurn(id, RunPhase.RUN_COMPLETED);
      const outcome = await decide(
        setDecision(`${id}:1`, "undo", seed!.aggregate),
      );

      expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
      expect((await decisionsOf(id)).map((d) => d.action)).toEqual(["undo"]);
    }
    expect(created).toHaveLength(2);
  });
});
