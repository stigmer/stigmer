/**
 * Pins the manual fire's arms the composed suite cannot reach: its server
 * has no engine behind it, so every run start there fails before a run
 * exists. Here the run starter answers "started", and the FireDirectRun
 * step must answer STARTED naming the run, stamp last_fire_at on the
 * schedule, and leave a manual ledger row carrying the run's id, so
 * listFires can later read the run's live phase; and it answers "refused",
 * and the step must answer REFUSED with the gate's copy verbatim and no run,
 * and record the refused fire.
 *
 * The store is a real throwaway SQLite store; the run starter is a stub
 * that records the schedule it was asked to fire.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireOutcome,
  RoutineFireResultSchema,
} from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFireResult } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { RoutineCommandController } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newFireDirectRunStep, TRIGGER_RESULT_KEY } from "../fire.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ROUTINE_ID = "sch_fire";
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
    const routine = create(RoutineSchema, {
      metadata: { id: ROUTINE_ID, org: "org_acme", name: "Fire" },
      spec: { enabled: true },
    });
    await store.saveResource(
      ApiResourceKind.routine,
      ROUTINE_ID,
      RoutineSchema,
      routine,
    );

    const fired: Routine[] = [];
    const step = newFireDirectRunStep<
      typeof RoutineCommandController.method.fire.input
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
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, {
        value: ROUTINE_ID,
      }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, routine);

    await step.execute(ctx);

    expect(fired.map((target) => target.metadata?.id)).toEqual([ROUTINE_ID]);
    const result = ctx.get(TRIGGER_RESULT_KEY) as RoutineFireResult;
    expect(result.$typeName).toBe(RoutineFireResultSchema.typeName);
    expect(result.outcome).toBe(RoutineFireOutcome.STARTED);
    expect(result.runId).toBe(RUN_ID);
    expect(result.refusalReason).toBe("");
    // The answer is the post-fire row, its fire instant stamped.
    expect(result.routine?.status?.lastFireAt).toBeDefined();

    const runs = await store.listRoutineFires(ROUTINE_ID, undefined, 10);
    const total = runs.length;
    expect(total).toBe(1);
    expect(runs[0]).toMatchObject({
      scheduleId: ROUTINE_ID,
      org: "org_acme",
      origin: "manual",
      outcome: "started",
      executionId: RUN_ID,
      completedAt: "",
    });
  });
});

describe("FireDirectRun — a run a launch gate refused", () => {
  it("answers REFUSED with the gate's copy and no run, and records the refused fire", async () => {
    temp = tempStore();
    const store = temp.store;
    const routine = create(RoutineSchema, {
      metadata: { id: ROUTINE_ID, org: "org_acme", name: "Fire" },
      spec: { enabled: true },
    });
    await store.saveResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema, routine);

    const step = newFireDirectRunStep<typeof RoutineCommandController.method.fire.input>({
      store,
      logger: silentLogger,
      runner: () => ({
        startRun: () => Promise.resolve({ kind: "refused", reason: "over budget for the month" }),
      }),
    });
    const ctx = new RequestContext(
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, { value: ROUTINE_ID }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, routine);

    await step.execute(ctx);

    const result = ctx.get(TRIGGER_RESULT_KEY) as RoutineFireResult;
    expect(result.outcome).toBe(RoutineFireOutcome.REFUSED);
    expect(result.refusalReason).toBe("over budget for the month");
    expect(result.runId).toBe("");
    const fires = await store.listRoutineFires(ROUTINE_ID, undefined, 10);
    const total = fires.length;
    expect(total).toBe(1);
    expect(fires[0]).toMatchObject({ origin: "manual", outcome: "refused", executionId: "" });
  });
});
