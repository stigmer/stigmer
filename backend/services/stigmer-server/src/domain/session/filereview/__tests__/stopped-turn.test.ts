/**
 * Pins the stopped-turn observer (../stopped-turn.ts) on a real store: a
 * turn that leaves waiting for an answer or a pause for a terminal phase
 * while the session's log holds an undo on its change sets starts its
 * reconcile turn, as the person the newest undo's decided event names in
 * decided_by; any other transition, a turn with no undo, a decider nobody
 * stands for, a log that cannot be read and a refused start start nothing
 * and throw nothing. An undo decided before the event named its decider
 * names nobody, and the observer acts as nobody: it never falls back to an
 * older undo's decider. The decider stands for the account its id names
 * under sign-in, and for the one operator on a laptop with no sign-in.
 */
import { clone, create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { decidedEvent } from "../../../run/filereview/decided.js";
import { SessionEventBroker } from "../../events/broker.js";
import { draftOf } from "../../events/codec.js";
import { createRunAppendingEvents } from "../../events/run-writes.js";
import type { ActionWord } from "../words.js";
import { newStoppedTurnObserver, newestUndoDecider, undoDeciderCaller } from "../stopped-turn.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const SESSION = "ses_1";
const ORG = "acme";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

/** A decision on change set `run_1:<n>` of the run, as the decision core and the rules record it. */
function decided(n: number, action: ActionWord, decidedBy: string, origin: "person" | "next_turn" = "person"): SessionEvent {
  return decidedEvent("run_1", {
    changeSetId: `run_1:${n}`,
    scope: "change_set",
    fileChangeId: "",
    action,
    expectedDigest: `digest-${n}`,
    origin,
    reason: "",
    decidedBy,
  });
}

/** The cancelled run, stored in the session, with `events` in the session's log. */
async function stoppedRun(events: ReadonlyArray<SessionEvent>, sessionId = SESSION): Promise<Run> {
  const row = create(RunSchema, {
    metadata: { id: "run_1", org: ORG },
    spec: { target: sessionId === "" ? { case: undefined } : { case: "sessionId", value: sessionId }, message: "edit" },
    status: { phase: RunPhase.RUN_CANCELLED },
  });
  await createRunAppendingEvents({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) }, row);
  if (events.length > 0) {
    await temp.store.sessionEvents.append(sessionId, ORG, events.map(draftOf), {
      kind: ApiResourceKind.run,
      id: "run_1",
      schema: RunSchema,
      admit: () => undefined,
    });
  }
  return row;
}

function harness(callerOf: (id: string) => Promise<CallerIdentity | undefined>, fail = false) {
  const creates: Array<{ run: Run; caller: CallerIdentity }> = [];
  const asked: string[] = [];
  const observer = newStoppedTurnObserver({
    logger: silentLogger,
    store: temp.store,
    callerOf: async (id) => {
      asked.push(id);
      return callerOf(id);
    },
    reconcileTurns: () => ({
      create: async (request, caller) => {
        if (fail) {
          throw new Error("refused");
        }
        creates.push({ run: request, caller });
        const row = clone(RunSchema, request);
        row.metadata!.id = "run_reconcile";
        return row;
      },
    }),
  });
  return { observer, creates, asked };
}

const asPerson = async (id: string) => testCallerIdentity({ identityId: id });

describe("the stopped-turn observer", () => {
  it("starts the reconcile turn of a waiting or paused turn that ends with an undo, as the newest undo's decider in the log", async () => {
    const stopped = await stoppedRun([
      decided(1, "undo", "usr_a"),
      decided(2, "keep", "usr_b"),
      decided(3, "undo", "usr_c"),
      decided(4, "keep", "", "next_turn"),
    ]);
    for (const oldPhase of [RunPhase.RUN_WAITING_FOR_APPROVAL, RunPhase.RUN_PAUSED]) {
      const { observer, creates } = harness(asPerson);
      await observer({ run: stopped, oldPhase, newPhase: RunPhase.RUN_CANCELLED });
      expect(creates.map((c) => [c.caller.identityId, c.run.spec?.reconcileFileReview, c.run.spec?.target.value])).toEqual([
        ["usr_c", true, SESSION],
      ]);
    }
  });

  it("reads the decider from the log, never from the run", async () => {
    const stopped = await stoppedRun([decided(1, "undo", "usr_from_log")]);
    expect(await newestUndoDecider(temp.store, stopped)).toBe("usr_from_log");
  });

  it("starts nothing for another transition, or a turn with no undo", async () => {
    const { observer, creates } = harness(asPerson);
    const undone = await stoppedRun([decided(1, "undo", "usr_a")]);
    await observer({ run: undone, oldPhase: RunPhase.RUN_IN_PROGRESS, newPhase: RunPhase.RUN_CANCELLED });
    await observer({ run: undone, oldPhase: RunPhase.RUN_WAITING_FOR_APPROVAL, newPhase: RunPhase.RUN_IN_PROGRESS });
    expect(creates).toEqual([]);

    await temp.cleanup();
    temp = tempStore();
    const kept = await stoppedRun([decided(1, "keep", "usr_a")]);
    const second = harness(asPerson);
    await second.observer({ run: kept, oldPhase: RunPhase.RUN_WAITING_FOR_APPROVAL, newPhase: RunPhase.RUN_FAILED });
    expect(second.creates).toEqual([]);
    expect(await newestUndoDecider(temp.store, kept)).toBeUndefined();
  });

  it("a newest undo that names no decider acts as nobody, never as an older undo's decider", async () => {
    const stopped = await stoppedRun([decided(1, "undo", "usr_a"), decided(2, "undo", "")]);
    expect(await newestUndoDecider(temp.store, stopped)).toBe("");
    const { observer, creates, asked } = harness(asPerson);
    await observer({ run: stopped, oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED });
    expect(creates).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("acts as nobody on a laptop either, where every decider stands for the operator", async () => {
    const stopped = await stoppedRun([decided(1, "undo", "")]);
    const operator = testCallerIdentity({ identityId: "usr_operator" });
    const { observer, creates } = harness(undoDeciderCaller(undefined, () => operator));
    await observer({ run: stopped, oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED });
    expect(creates).toEqual([]);
  });

  it("starts nothing when the decider names nobody, and never throws when the start is refused", async () => {
    const stopped = await stoppedRun([decided(1, "undo", "usr_gone")]);
    const nobody = harness(async () => undefined);
    await nobody.observer({ run: stopped, oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED });
    expect(nobody.creates).toEqual([]);
    const refused = harness(asPerson, true);
    await expect(
      refused.observer({ run: stopped, oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED }),
    ).resolves.toBeUndefined();
  });

  it("starts nothing and throws nothing when the log cannot be read", async () => {
    const stopped = await stoppedRun([decided(1, "undo", "usr_a")]);
    vi.spyOn(temp.store.sessionEvents, "list").mockRejectedValueOnce(new Error("disk I/O error"));
    const { observer, creates } = harness(asPerson);
    await expect(
      observer({ run: stopped, oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED }),
    ).resolves.toBeUndefined();
    expect(creates).toEqual([]);
  });

  it("finds a run in no session holding no undo", async () => {
    const solo = create(RunSchema, { metadata: { id: "run_solo", org: ORG }, status: { phase: RunPhase.RUN_CANCELLED } });
    expect(await newestUndoDecider(temp.store, solo)).toBeUndefined();
  });

  it("pages back through the run's decisions to the newest undo", async () => {
    const events: SessionEvent[] = [decided(0, "undo", "usr_paged")];
    for (let n = 1; n <= 520; n++) {
      events.push(decided(n, "keep", "", "next_turn"));
    }
    events.push(
      create(SessionEventSchema, {
        runId: "run_1",
        event: { case: "agentMessage", value: { id: "run_1.root.m0", content: [{ type: "text", text: "done" }] } },
      }),
    );
    const stopped = await stoppedRun(events);
    expect(await newestUndoDecider(temp.store, stopped)).toBe("usr_paged");
  });
});

describe("who an undo's decider stands for", () => {
  const operator = testCallerIdentity({ identityId: "usr_operator" });

  it("is the one operator when there is no sign-in", async () => {
    expect(await undoDeciderCaller(undefined, () => operator)("anyone")).toBe(operator);
  });

  it("is the account the decider's id names under sign-in, and nobody when it names none", async () => {
    const accounts = {
      findById: async (id: string) =>
        id === "acc_alice" ? create(IdentityAccountSchema, { metadata: { id: "acc_alice" } }) : undefined,
      findDirectByIdpId: async () => undefined,
    };
    const callerOf = undoDeciderCaller(accounts, () => operator);
    expect((await callerOf("acc_alice"))?.identityId).toBe("acc_alice");
    expect((await callerOf("acc_alice"))?.callerClass).toBe("user");
    expect(await callerOf("acc_gone")).toBeUndefined();
    expect(await callerOf("")).toBeUndefined();
  });
});
