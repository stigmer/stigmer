/**
 * Pins the manual fire's success arm, the one the composed suite cannot
 * reach: its server has no engine behind it, so every run start there is
 * refused before a run exists. Here the run starter answers "started", and
 * the FireDirectRun step must answer STARTED naming the run, stamp
 * last_fire_at on the schedule, and leave a manual ledger row carrying the
 * run's id, so listRuns can later read the run's live phase.
 *
 * The store is a real throwaway SQLite store; the run starter is a stub
 * that records the schedule it was asked to fire.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleFireOutcome,
  ScheduleTriggerResultSchema,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import type { ScheduleTriggerResult } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newFireDirectRunStep, TRIGGER_RESULT_KEY } from "../trigger.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const SCHEDULE_ID = "sch_fire";
const RUN_ID = "aex_fired";

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

describe("FireDirectRun — a run the starter started", () => {
  it("answers STARTED naming the run, stamps last_fire_at and records the manual fire with the run's id", async () => {
    temp = tempStore();
    const store = temp.store;
    const schedule = create(ScheduleSchema, {
      metadata: { id: SCHEDULE_ID, org: "org_acme", name: "Fire" },
      spec: { enabled: true },
    });
    await store.saveResource(
      ApiResourceKind.schedule,
      SCHEDULE_ID,
      ScheduleSchema,
      schedule,
    );

    const fired: Schedule[] = [];
    const step = newFireDirectRunStep<
      typeof ScheduleCommandController.method.trigger.input
    >({
      store,
      logger: silentLogger,
      runner: () => ({
        startRun: (target) => {
          fired.push(target);
          return Promise.resolve({
            kind: "started",
            executionId: RUN_ID,
            alreadyExisted: false,
          });
        },
      }),
    });
    const ctx = new RequestContext(
      ScheduleCommandController.method.trigger.input,
      create(ScheduleCommandController.method.trigger.input, {
        value: SCHEDULE_ID,
      }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, schedule);

    await step.execute(ctx);

    expect(fired.map((target) => target.metadata?.id)).toEqual([SCHEDULE_ID]);
    const result = ctx.get(TRIGGER_RESULT_KEY) as ScheduleTriggerResult;
    expect(result.$typeName).toBe(ScheduleTriggerResultSchema.typeName);
    expect(result.outcome).toBe(ScheduleFireOutcome.STARTED);
    expect(result.runId).toBe(RUN_ID);
    expect(result.refusalReason).toBe("");
    // The answer is the post-fire row, its fire instant stamped.
    expect(result.schedule?.status?.lastFireAt).toBeDefined();

    const { runs, total } = await store.listScheduleFires(SCHEDULE_ID, 0, 10);
    expect(total).toBe(1);
    expect(runs[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      org: "org_acme",
      origin: "manual",
      outcome: "started",
      executionId: RUN_ID,
      completedAt: "",
    });
  });
});
