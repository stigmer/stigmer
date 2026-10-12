/**
 * Pins the stopped-turn observer (../stopped-turn.ts): a turn that leaves
 * waiting for an answer or a pause for a terminal phase while its change
 * sets carry an undo starts its reconcile turn, as the person who decided
 * the newest undo; any other transition, a turn with no undo, a decider
 * nobody stands for, and a refused start start nothing and throw nothing.
 * The decider stands for the account its id names under sign-in, and for
 * the one operator on a laptop with no sign-in.
 */
import { clone, create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileDecisionAction,
  FileReviewEventType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";

import { newStoppedTurnObserver, newestUndoDecider, undoDeciderCaller } from "../stopped-turn.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

function decided(action: FileDecisionAction, reviewerId: string) {
  return {
    eventType: FileReviewEventType.FILE_DECIDED,
    payload: { case: "fileDecided" as const, value: { action, reviewerId } },
  };
}

function run(events: ReturnType<typeof decided>[]): Run {
  return create(RunSchema, {
    metadata: { id: "run_1", org: "acme" },
    spec: { target: { case: "sessionId", value: "ses_1" } },
    status: { phase: RunPhase.RUN_CANCELLED, fileReviewEventStream: { events } },
  });
}

function harness(callerOf: (id: string) => Promise<CallerIdentity | undefined>, fail = false) {
  const creates: Array<{ run: Run; caller: CallerIdentity }> = [];
  const observer = newStoppedTurnObserver({
    logger: silentLogger,
    callerOf,
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
  return { observer, creates };
}

const asPerson = async (id: string) => testCallerIdentity({ identityId: id });

describe("the stopped-turn observer", () => {
  it("starts the reconcile turn of a waiting or paused turn that ends with an undo, as the newest undo's decider", async () => {
    for (const oldPhase of [RunPhase.RUN_WAITING_FOR_APPROVAL, RunPhase.RUN_PAUSED]) {
      const { observer, creates } = harness(asPerson);
      await observer({
        run: run([decided(FileDecisionAction.REJECT, "usr_a"), decided(FileDecisionAction.APPROVE, "usr_b"), decided(FileDecisionAction.REJECT, "usr_c")]),
        oldPhase,
        newPhase: RunPhase.RUN_CANCELLED,
      });
      expect(creates.map((c) => [c.caller.identityId, c.run.spec?.reconcileFileReview, c.run.spec?.target.value])).toEqual([
        ["usr_c", true, "ses_1"],
      ]);
    }
  });

  it("starts nothing for another transition, or a turn with no undo", async () => {
    const { observer, creates } = harness(asPerson);
    const undone = run([decided(FileDecisionAction.REJECT, "usr_a")]);
    await observer({ run: undone, oldPhase: RunPhase.RUN_IN_PROGRESS, newPhase: RunPhase.RUN_CANCELLED });
    await observer({ run: undone, oldPhase: RunPhase.RUN_WAITING_FOR_APPROVAL, newPhase: RunPhase.RUN_IN_PROGRESS });
    await observer({ run: run([decided(FileDecisionAction.APPROVE, "usr_a")]), oldPhase: RunPhase.RUN_WAITING_FOR_APPROVAL, newPhase: RunPhase.RUN_FAILED });
    expect(creates).toEqual([]);
    expect(newestUndoDecider(run([]))).toBeUndefined();
  });

  it("starts nothing when the decider names nobody, and never throws when the start is refused", async () => {
    const nobody = harness(async () => undefined);
    await nobody.observer({ run: run([decided(FileDecisionAction.REJECT, "usr_gone")]), oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED });
    expect(nobody.creates).toEqual([]);
    const refused = harness(asPerson, true);
    await expect(
      refused.observer({ run: run([decided(FileDecisionAction.REJECT, "usr_a")]), oldPhase: RunPhase.RUN_PAUSED, newPhase: RunPhase.RUN_CANCELLED }),
    ).resolves.toBeUndefined();
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
  });
});
