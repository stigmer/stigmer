/**
 * Pins the fire call's arms the composed suite cannot reach: its server
 * has no engine behind it, so every run start there fails before a run
 * exists. Here the run starter answers "started", and the FireDirectRun
 * step must hand it a manual fire carrying the call's text under a fresh
 * fire id, answer STARTED naming the run and the fire, stamp last_fire_at
 * on the routine, and leave a manual ledger row carrying the run's id, so
 * listFires can later read the run's live phase, and who fired it; and it
 * answers "refused", and the step must answer REFUSED with the gate's copy
 * verbatim and no run, and record the refused fire.
 *
 * The store is a real throwaway SQLite store; the run starter is a stub
 * that records the routine and the fire it was asked to run.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireOutcome,
  RoutineFireResultSchema,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFireResult } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { RoutineFireRequest } from "../../../temporal/routine/run-starter.js";
import { FIRE_RESULT_KEY, newFireDirectRunStep } from "../fire.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const ROUTINE_ID = "rtn_fire";
const RUN_ID = "run_fired";

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

describe("FireDirectRun — a run the starter started", () => {
  it("hands the starter a fresh manual fire with the call's text, answers STARTED naming the run and the fire, and records who fired it", async () => {
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

    const fired: Array<{ routine: Routine; fire: RoutineFireRequest }> = [];
    const step = newFireDirectRunStep({
      store,
      logger: silentLogger,
      runner: () => ({
        startRun: (target, fire) => {
          fired.push({ routine: target, fire });
          return Promise.resolve({
            kind: "started",
            runId: RUN_ID,
            alreadyExisted: false,
          });
        },
      }),
    });
    const ctx = new RequestContext(
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, {
        id: ROUTINE_ID,
        text: "Sentry alert SEN-4521 fired",
      }),
      testCallerIdentity({ identityId: "ida_alerts", displayName: "Alerts bot", mintedBy: "ida_key" }),
    );
    ctx.set(EXISTING_RESOURCE_KEY, routine);

    await step.execute(ctx);

    expect(fired.map(({ routine: target }) => target.metadata?.id)).toEqual([ROUTINE_ID]);
    const fire = fired[0]!.fire;
    expect(fire.origin).toBe("manual");
    expect(fire.text).toBe("Sentry alert SEN-4521 fired");
    expect(fire.fireId).toMatch(/^rtn-fire-\d{8}t\d{6}z-[0-9a-z]{6}$/);
    const result = ctx.get(FIRE_RESULT_KEY) as RoutineFireResult;
    expect(result.$typeName).toBe(RoutineFireResultSchema.typeName);
    expect(result.outcome).toBe(RoutineFireOutcome.STARTED);
    expect(result.runId).toBe(RUN_ID);
    expect(result.fireId).toBe(fire.fireId);
    expect(result.refusalReason).toBe("");
    // The answer is the post-fire row, its fire instant stamped.
    expect(result.routine?.status?.lastFireAt).toBeDefined();

    const runs = await store.listRoutineFires(ROUTINE_ID, undefined, 10);
    const total = runs.length;
    expect(total).toBe(1);
    expect(runs[0]).toMatchObject({
      routineId: ROUTINE_ID,
      fireId: fire.fireId,
      org: "org_acme",
      origin: "manual",
      outcome: "started",
      runId: RUN_ID,
      completedAt: "",
    });
    expect(runs[0]?.firedBy).toMatchObject({ id: "ida_alerts", displayName: "Alerts bot", mintedBy: "ida_key" });
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

    const step = newFireDirectRunStep({
      store,
      logger: silentLogger,
      runner: () => ({
        startRun: () => Promise.resolve({ kind: "refused", reason: "over budget for the month" }),
      }),
    });
    const ctx = new RequestContext(
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, { id: ROUTINE_ID }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, routine);

    await step.execute(ctx);

    const result = ctx.get(FIRE_RESULT_KEY) as RoutineFireResult;
    expect(result.outcome).toBe(RoutineFireOutcome.REFUSED);
    expect(result.refusalReason).toBe("over budget for the month");
    expect(result.runId).toBe("");
    const fires = await store.listRoutineFires(ROUTINE_ID, undefined, 10);
    const total = fires.length;
    expect(total).toBe(1);
    expect(fires[0]).toMatchObject({ origin: "manual", outcome: "refused", runId: "", fireId: result.fireId });
  });
});
