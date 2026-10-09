/**
 * Pins the grading activities over a real store opened with the server's
 * list indexes, and a recorder standing in for the score's create chain:
 *   - grading a completed run records its run-health score from the checks;
 *   - a run that already carries a run-health score from this version of
 *     the checks is left alone, and one from another version is graded
 *     again;
 *   - a run deleted before it was graded has nothing to score;
 *   - a retry that loses the race (ALREADY_EXISTS) counts as graded, a run
 *     deleted mid-record (NOT_FOUND) as gone, and any other failure is
 *     thrown so Temporal retries it;
 *   - recording a run as not graded carries the reason and no value.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  RunPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { RUN_HEALTH_EVALUATOR_VERSION } from "../../../domain/score/checks/checks.js";
import type { ScoreRecorder } from "../../../domain/score/ports.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { createGradingActivities } from "../activities.js";
import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_GONE,
  GRADE_RUN_HEALTH_ACTIVITY_NAME,
  RECORD_NOT_GRADED_ACTIVITY_NAME,
} from "../names.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

function recorder(
  fail?: Error,
): ScoreRecorder & { readonly recorded: Score[] } {
  const recorded: Score[] = [];
  return {
    recorded,
    record: (score) => {
      if (fail !== undefined) {
        return Promise.reject(fail);
      }
      recorded.push(score);
      return Promise.resolve(score);
    },
  };
}

function activitiesWith(rec: ScoreRecorder) {
  return createGradingActivities({
    store: temp.store,
    logger: silentLogger,
    recorder: () => rec,
  });
}

/** A completed run stuck on the same echo three times. */
async function seedStuckRun(id = "run_1"): Promise<void> {
  const echo = {
    name: "echo",
    args: { text: "same" },
    result: "same",
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
  };
  await temp.store.saveResource(
    ApiResourceKind.run,
    id,
    RunSchema,
    create(RunSchema, {
      metadata: { id, name: id, slug: id, org: "org_1" },
      spec: { target: { case: "sessionId", value: "ses_1" } },
      status: {
        phase: RunPhase.RUN_COMPLETED,
        messages: [{ toolCalls: [echo, echo, echo] }],
      },
    }),
  );
}

async function seedRunHealth(
  runId: string,
  evaluatorVersion: string,
): Promise<void> {
  const id = `scr_${evaluatorVersion.slice(0, 8)}`;
  await temp.store.saveResource(
    ApiResourceKind.score,
    id,
    ScoreSchema,
    create(ScoreSchema, {
      metadata: { id, name: id, slug: id, org: "org_1" },
      spec: {
        runId,
        sessionId: "ses_1",
        metric: "run-health",
        source: ScoreSource.check,
        evaluatorVersion,
        value: { case: "passed", value: true },
      },
    }),
  );
}

describe("grade-run-health", () => {
  it("records the run-health score of a completed run", async () => {
    await seedStuckRun();
    const rec = recorder();
    const outcome =
      await activitiesWith(rec)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1");
    expect(outcome).toBe(GRADE_RECORDED);
    expect(rec.recorded).toHaveLength(1);
    const score = rec.recorded[0];
    expect(score?.metadata?.org).toBe("org_1");
    expect(score?.spec?.runId).toBe("run_1");
    expect(score?.spec?.metric).toBe("run-health");
    expect(score?.spec?.source).toBe(ScoreSource.check);
    expect(score?.spec?.evaluatorVersion).toBe(RUN_HEALTH_EVALUATOR_VERSION);
    expect(score?.spec?.value).toEqual({ case: "passed", value: false });
    expect(
      score?.spec?.criteria.find((c) => c.name === "no-repeated-calls")?.result,
    ).toBe(CriterionResult.failed);
  });

  it("leaves a run graded by this version of the checks alone", async () => {
    await seedStuckRun();
    await seedRunHealth("run_1", RUN_HEALTH_EVALUATOR_VERSION);
    const rec = recorder();
    expect(
      await activitiesWith(rec)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).toBe(GRADE_ALREADY_GRADED);
    expect(rec.recorded).toEqual([]);
  });

  it("grades again a run graded by another version of the checks", async () => {
    await seedStuckRun();
    await seedRunHealth("run_1", "an-older-version");
    const rec = recorder();
    expect(
      await activitiesWith(rec)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).toBe(GRADE_RECORDED);
  });

  it("has nothing to score for a deleted run", async () => {
    const rec = recorder();
    const activities = activitiesWith(rec);
    expect(await activities[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_gone")).toBe(
      GRADE_RUN_GONE,
    );
    expect(
      await activities[RECORD_NOT_GRADED_ACTIVITY_NAME]("run_gone", "x"),
    ).toBe(GRADE_RUN_GONE);
    expect(rec.recorded).toEqual([]);
  });

  it("reads the create chain's answers: lost race is graded, a vanished run is gone, anything else retries", async () => {
    await seedStuckRun();
    const lost = recorder(new ConnectError("exists", Code.AlreadyExists));
    expect(
      await activitiesWith(lost)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).toBe(GRADE_ALREADY_GRADED);
    const vanished = recorder(new ConnectError("gone", Code.NotFound));
    expect(
      await activitiesWith(vanished)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).toBe(GRADE_RUN_GONE);
    const broken = recorder(new ConnectError("store down", Code.Internal));
    await expect(
      activitiesWith(broken)[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).rejects.toThrow("store down");
  });
});

describe("record-not-graded", () => {
  it("records the run as not graded, with the reason and no value", async () => {
    await seedStuckRun();
    const rec = recorder();
    expect(
      await activitiesWith(rec)[RECORD_NOT_GRADED_ACTIVITY_NAME](
        "run_1",
        "grading failed",
      ),
    ).toBe(GRADE_RECORDED);
    const score = rec.recorded[0];
    expect(score?.spec?.value.case).toBeUndefined();
    expect(score?.status?.notGradedReason).toBe("grading failed");
    expect(score?.spec?.evaluatorVersion).toBe(RUN_HEALTH_EVALUATOR_VERSION);
  });

  it("leaves a run graded meanwhile alone, and has nothing to record for a deleted run", async () => {
    await seedStuckRun();
    await seedRunHealth("run_1", RUN_HEALTH_EVALUATOR_VERSION);
    const rec = recorder();
    expect(
      await activitiesWith(rec)[RECORD_NOT_GRADED_ACTIVITY_NAME](
        "run_1",
        "grading failed",
      ),
    ).toBe(GRADE_ALREADY_GRADED);
    expect(
      await activitiesWith(rec)[RECORD_NOT_GRADED_ACTIVITY_NAME](
        "run_gone",
        "grading failed",
      ),
    ).toBe(GRADE_RUN_GONE);
    expect(rec.recorded).toEqual([]);
  });
});

describe("a store fault", () => {
  it("is thrown, so Temporal retries the activity", async () => {
    const failing = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("disk unavailable"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const activities = createGradingActivities({
      store: failing,
      logger: silentLogger,
      recorder: () => recorder(),
    });
    await expect(
      activities[GRADE_RUN_HEALTH_ACTIVITY_NAME]("run_1"),
    ).rejects.toThrow("disk unavailable");
  });
});
