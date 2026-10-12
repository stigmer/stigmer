/**
 * Pins the one decision core (../decide.ts) on a real store: a person's
 * keep or undo lands on the change set's run with its decided event, only
 * while the set's turn is the conversation's newest (a reconcile turn
 * never moves it on), only for a set of the session asked in, for a file
 * the set holds, through the digest and completeness gates, once per
 * target, a store fault answering a bare Internal; and an undo on an ended
 * turn starts one reconcile turn, as the person, unless one is unfinished
 * in the session, the decision standing whatever the create answers.
 */
import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { FileReviewEventSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { fileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import type { FileReviewSeed } from "../../../run/__tests__/file-review-seed.js";
import { fileDigest } from "../../../run/filereview/digest.js";
import { StreamBroker } from "../../../run/stream-broker.js";
import { SessionEventBroker } from "../../events/broker.js";
import { eventTypeOf } from "../../events/catalog.js";
import { eventOf } from "../../events/codec.js";
import { createRunAppendingEvents } from "../../events/run-writes.js";
import {
  CONVERSATION_MOVED_ON_MESSAGE,
  decideFileChanges,
  runIdOfChangeSet,
} from "../decide.js";
import type {
  FileDecisionAsked,
  FileDecisionDeps,
  ReconcileTurnCreator,
} from "../decide.js";

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
    broker: new StreamBroker(silentLogger),
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

type LedgerEvent = MessageInitShape<typeof FileReviewEventSchema>;

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
  const events: LedgerEvent[] = seeds.flatMap(
    (seed) => seed.status.fileReviewEventStream?.events ?? [],
  );
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
      status: { phase, fileReviewEventStream: { runId: id, events } },
    }),
  );
}

function setDecision(
  changeSetId: string,
  action: FileDecisionAction,
  digest: string,
): FileDecisionAsked {
  return {
    changeSetId,
    scope: FileDecisionScope.CHANGE_SET,
    fileChangeId: "",
    action,
    expectedDigest: digest,
    reason: "",
    acknowledgeUnreviewable: false,
  };
}

/** Decides as the person, in `sessionId` (null: on the run, as the run's own method asks). */
function decide(asked: FileDecisionAsked, sessionId: string | null = SESSION) {
  return decideFileChanges(
    deps(),
    {
      runId: runIdOfChangeSet(asked.changeSetId),
      ...(sessionId === null ? {} : { sessionId }),
    },
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

async function stored(id: string): Promise<Run> {
  return temp.store.getResource(ApiResourceKind.run, id, RunSchema);
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
      FileDecisionAction.APPROVE,
      seed!.aggregate,
    );
    expect((await refusal(decide(asked))).code).toBe(Code.NotFound);
    expect(
      (await refusal(decide({ ...asked, changeSetId: "run_gone:1" }))).code,
    ).toBe(Code.NotFound);
    expect(
      (await refusal(decide({ ...asked, changeSetId: "no-run" }))).code,
    ).toBe(Code.NotFound);
    expect((await stored("run_1")).status?.fileChangeSets ?? []).toEqual([]);
  });
});

describe("a keep", () => {
  it("records the person's decision on the newest turn, with its decided event, and starts no turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const outcome = await decide(
      setDecision("run_1:1", FileDecisionAction.APPROVE, seed!.aggregate),
    );

    expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
    const set = outcome.run.status?.fileChangeSets.find(
      (cs) => cs.id === "run_1:1",
    );
    expect(set?.status).toBe(FileChangeSetStatus.DECIDED);
    expect(
      set?.decisions.map((d) => [d.action, d.origin, d.reviewerId]),
    ).toEqual([
      [FileDecisionAction.APPROVE, FileDecisionOrigin.USER, "usr_person"],
    ]);
    expect(await log()).toContain("run_1:stigmer.file_review.decided");
    expect(created).toEqual([]);
  });

  it("the same decision again writes nothing and answers success", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      FileDecisionAction.APPROVE,
      seed!.aggregate,
    );
    await decide(asked);
    const before = await log();

    const again = await decide(asked);
    expect(again.recorded).toBe(false);
    expect(again.run.status?.fileChangeSets[0]?.decisions).toHaveLength(1);
    expect(await log()).toEqual(before);
  });

  it("a different decision on a target already decided writes nothing and starts no turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    await decide(
      setDecision("run_1:1", FileDecisionAction.APPROVE, seed!.aggregate),
    );
    const before = await log();

    const undo = await decide(
      setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
    );
    expect([undo.recorded, undo.reconcileRunId]).toEqual([false, ""]);
    expect(
      (await stored("run_1")).status?.fileChangeSets[0]?.decisions.map(
        (d) => d.action,
      ),
    ).toEqual([FileDecisionAction.APPROVE]);
    expect(await log()).toEqual(before);
    expect(created).toEqual([]);
  });

  it("refuses a FILE decision naming a file the change set does not hold, and writes nothing", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const error = await refusal(
      decide({
        ...setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
        scope: FileDecisionScope.FILE,
        fileChangeId: "run_1:1:no-such-file.ts",
      }),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      "file change run_1:1:no-such-file.ts not found in change set run_1:1",
    ]);
    expect((await stored("run_1")).status?.fileChangeSets ?? []).toEqual([]);
  });

  it("refuses a digest the person did not review, and a keep of a change that cannot be shown whole; an undo of that change passes", async () => {
    const seed = fileReviewSeed("run_1", "run_1:1");
    seed.change.diffComplete = false;
    seed.change.fileDigest = fileDigest(seed.change);
    await storeTurn("run_1", RunPhase.RUN_COMPLETED, [seed]);
    const file = (
      action: FileDecisionAction,
      digest: string,
    ): FileDecisionAsked => ({
      ...setDecision("run_1:1", action, digest),
      scope: FileDecisionScope.FILE,
      fileChangeId: seed.change.id,
    });

    expect(
      (await refusal(decide(file(FileDecisionAction.REJECT, "0".repeat(64)))))
        .code,
    ).toBe(Code.InvalidArgument);
    expect(
      (
        await refusal(
          decide(file(FileDecisionAction.APPROVE, seed.change.fileDigest)),
        )
      ).code,
    ).toBe(Code.FailedPrecondition);
    expect((await stored("run_1")).status?.fileChangeSets ?? []).toEqual([]);
    expect(
      (await decide(file(FileDecisionAction.REJECT, seed.change.fileDigest)))
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
        setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
      ),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.Internal,
      "failed to persist file decision",
    ]);
    expect((await stored("run_1")).status?.fileChangeSets ?? []).toEqual([]);
    expect(created).toEqual([]);
  });
});

describe("the window", () => {
  it("closes when a later message is sent: a decision on the earlier turn is refused and nothing is written", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    await seedTurn("run_2", RunPhase.RUN_PENDING);

    const error = await refusal(
      decide(
        setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
      ),
    );
    expect([error.code, error.rawMessage]).toEqual([
      Code.FailedPrecondition,
      CONVERSATION_MOVED_ON_MESSAGE,
    ]);
    expect((await stored("run_1")).status?.fileChangeSets ?? []).toEqual([]);
    expect(created).toEqual([]);
  });

  it("a person's own decision repeated after it closed still answers success", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      FileDecisionAction.APPROVE,
      seed!.aggregate,
    );
    await decide(asked);
    await seedTurn("run_2", RunPhase.RUN_PENDING);

    expect((await decide(asked)).recorded).toBe(false);
  });

  it("stays open through a reconcile turn, which sends no message", async () => {
    const [first, second] = await seedTurn("run_1", RunPhase.RUN_COMPLETED, 2);
    await decide(
      setDecision("run_1:1", FileDecisionAction.REJECT, first!.aggregate),
    );
    expect(created).toHaveLength(1);

    const keep = await decide(
      setDecision("run_1:2", FileDecisionAction.APPROVE, second!.aggregate),
    );
    expect(keep.recorded).toBe(true);
    expect(await log()).not.toContain("run_reconcile_1:user.message");
  });
});

describe("an undo", () => {
  it("on an ended turn starts a reconcile turn as the person, in the session and its organization, with no message", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const outcome = await decide(
      setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
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
    expect(outcome.run.status?.fileChangeSets[0]?.decisions[0]?.action).toBe(
      FileDecisionAction.REJECT,
    );
  });

  it("starts none while a reconcile turn is unfinished in the session: that turn restores it", async () => {
    const [first, second] = await seedTurn("run_1", RunPhase.RUN_COMPLETED, 2);
    await decide(
      setDecision("run_1:1", FileDecisionAction.REJECT, first!.aggregate),
    );
    const outcome = await decide(
      setDecision("run_1:2", FileDecisionAction.REJECT, second!.aggregate),
    );

    expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
    expect(created).toHaveLength(1);
  });

  it("repeated starts no second turn", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_COMPLETED);
    const asked = setDecision(
      "run_1:1",
      FileDecisionAction.REJECT,
      seed!.aggregate,
    );
    await decide(asked);
    expect((await decide(asked)).reconcileRunId).toBe("");
    expect(created).toHaveLength(1);
  });

  it("on a turn still working starts none: its next start restores the file", async () => {
    const [seed] = await seedTurn("run_1", RunPhase.RUN_IN_PROGRESS);
    const outcome = await decide(
      setDecision("run_1:1", FileDecisionAction.REJECT, seed!.aggregate),
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
        setDecision(`${id}:1`, FileDecisionAction.REJECT, seed!.aggregate),
      );

      expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
      const decisions =
        (await stored(id)).status?.fileChangeSets[0]?.decisions ?? [];
      expect(decisions.map((d) => d.action)).toEqual([
        FileDecisionAction.REJECT,
      ]);
    }
    expect(created).toHaveLength(2);
  });
});

describe("a run in no session", () => {
  it("has no window and no reconcile turn", async () => {
    const seed = fileReviewSeed("run_solo", "run_solo:1");
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_solo",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_solo", org: ORG },
        spec: { message: "hello" },
        status: { ...seed.status, phase: RunPhase.RUN_COMPLETED },
      }),
    );
    const outcome = await decide(
      setDecision("run_solo:1", FileDecisionAction.REJECT, seed.aggregate),
      null,
    );
    expect([outcome.recorded, outcome.reconcileRunId]).toEqual([true, ""]);
    expect(created).toEqual([]);
  });
});
