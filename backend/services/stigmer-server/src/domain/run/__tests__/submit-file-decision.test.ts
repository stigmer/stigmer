/**
 * Pins the run's own file-decision method as an adapter onto the decision
 * core (../submit-file-decision.ts, domain/session/filereview/decide.ts):
 * it keeps its authorization (can_edit on the run it names), APPROVE is a
 * keep and REJECT an undo, an undo on an ended turn starts the reconcile
 * turn as the core does, and the answer is the run as committed. The
 * core's own rules are pinned in decide.test.ts.
 */
import { clone, create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeSetStatus,
  FileDecisionAction,
  FileDecisionScope,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { SubmitFileDecisionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { createRunAppendingEvents } from "../../session/events/run-writes.js";
import { StreamBroker } from "../stream-broker.js";
import { submitFileDecision } from "../submit-file-decision.js";
import type { SubmitFileDecisionDeps } from "../submit-file-decision.js";

import { fileReviewSeed } from "./file-review-seed.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let temp: TempStore;
let checks: AuthzCheck[];
let reconcileCreates: number;

beforeEach(() => {
  temp = tempStore();
  checks = [];
  reconcileCreates = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

const recordingAuthorizer: Authorizer = {
  authorize: async (_caller, check) => {
    checks.push(check);
    return { kind: "allow" };
  },
};

function deps(): SubmitFileDecisionDeps {
  return {
    store: temp.store,
    logger: silentLogger,
    authorizer: recordingAuthorizer,
    broker: new StreamBroker(silentLogger),
    sessionEventBroker: new SessionEventBroker(silentLogger),
    reconcileTurns: () => ({
      create: async (run) => {
        reconcileCreates += 1;
        const row = clone(RunSchema, run);
        row.metadata!.id = "run_reconcile";
        return row;
      },
    }),
  };
}

/** One ended turn in a session, with one captured change set. */
async function seedEndedTurn() {
  const seed = fileReviewSeed("run_1", "run_1:1");
  await createRunAppendingEvents(
    {
      store: temp.store,
      sessionEventBroker: new SessionEventBroker(silentLogger),
    },
    create(RunSchema, {
      metadata: { id: "run_1", org: "org_acme" },
      spec: {
        target: { case: "sessionId", value: "ses_1" },
        message: "edit a.ts",
      },
      status: { ...seed.status, phase: RunPhase.RUN_COMPLETED },
    }),
  );
  return seed;
}

function submit(action: FileDecisionAction, expectedDigest: string) {
  return submitFileDecision(
    deps(),
    create(SubmitFileDecisionInputSchema, {
      runId: "run_1",
      changeSetId: "run_1:1",
      scope: FileDecisionScope.CHANGE_SET,
      action,
      expectedDigest,
    }),
    testCallerIdentity(),
  );
}

describe("submitFileDecision, the adapter", () => {
  it("asks can_edit on the run, and APPROVE keeps: the answer is the run as committed", async () => {
    const seed = await seedEndedTurn();
    const run = await submit(FileDecisionAction.APPROVE, seed.aggregate);

    expect(
      checks.map((c) => [c.permission, c.resourceKind, c.resourceId]),
    ).toEqual([[IamPermission.can_edit, ApiResourceKind.run, "run_1"]]);
    const set = run.status?.fileChangeSets.find((cs) => cs.id === "run_1:1");
    expect(set?.status).toBe(FileChangeSetStatus.DECIDED);
    expect(set?.decisions.map((d) => d.action)).toEqual([
      FileDecisionAction.APPROVE,
    ]);
    expect(reconcileCreates).toBe(0);
  });

  it("REJECT undoes, and on an ended turn starts the reconcile turn", async () => {
    const seed = await seedEndedTurn();
    const run = await submit(FileDecisionAction.REJECT, seed.aggregate);

    expect(
      run.status?.fileChangeSets[0]?.decisions.map((d) => d.action),
    ).toEqual([FileDecisionAction.REJECT]);
    expect(reconcileCreates).toBe(1);
  });
});
