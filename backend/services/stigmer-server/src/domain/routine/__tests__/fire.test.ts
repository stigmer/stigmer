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
 * And the fire's edges no composed call reaches: a fire naming no routine
 * is INVALID_ARGUMENT; a process with no run starter refuses with
 * FAILED_PRECONDITION and the byte-pinned copy; the bookkeeping after a
 * started run is best-effort: a last_fire_at stamp the store cannot write
 * is logged, one for a routine deleted mid-fire is skipped silently, and
 * a post-fire re-read that fails answers with the loaded routine.
 *
 * The store is a real throwaway SQLite store, with one method faulted
 * where a case says so; the run starter is a stub that records the
 * routine and the fire it was asked to run.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
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
import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { RoutineFireRequest } from "../../../temporal/routine/run-starter.js";
import {
  FIRE_NO_RUNNER_MESSAGE,
  FIRE_RESULT_KEY,
  newExtractFireRoutineIdStep,
  newFireDirectRunStep,
} from "../fire.js";
import type { RoutineRunner } from "../fire.js";
import { capturingLogger, storeWith } from "./support.js";

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

describe("ExtractFireRoutineId", () => {
  it("refuses a fire that names no routine with INVALID_ARGUMENT", async () => {
    const ctx = new RequestContext(
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, { id: "" }),
      testCallerIdentity(),
    );
    const error = await errorOf(async () => {
      await newExtractFireRoutineIdStep().execute(ctx);
    });
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("resource id is required");
    expect(ctx.get(RESOURCE_ID_KEY)).toBeUndefined();
  });
});

describe("FireDirectRun — the edges around the run", () => {
  const STARTED: RoutineRunner = {
    startRun: () => Promise.resolve({ kind: "started", runId: RUN_ID, alreadyExisted: false }),
  };

  function fireRoutine(): Routine {
    return create(RoutineSchema, {
      metadata: { id: ROUTINE_ID, org: "org_acme", name: "Fire" },
      spec: { enabled: true },
    });
  }

  function fireContext(routine: Routine) {
    const ctx = new RequestContext(
      RoutineCommandController.method.fire.input,
      create(RoutineCommandController.method.fire.input, { id: ROUTINE_ID }),
      testCallerIdentity(),
    );
    ctx.set(EXISTING_RESOURCE_KEY, routine);
    return ctx;
  }

  it("refuses with FAILED_PRECONDITION and the byte-pinned copy when no run starter is wired", async () => {
    temp = tempStore();
    const ctx = fireContext(fireRoutine());
    const error = await errorOf(async () => {
      await newFireDirectRunStep({ store: temp!.store, logger: silentLogger, runner: () => undefined }).execute(ctx);
    });
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(FIRE_NO_RUNNER_MESSAGE);
    expect(ctx.get(FIRE_RESULT_KEY)).toBeUndefined();
    expect(await temp.store.listRoutineFires(ROUTINE_ID, undefined, 10)).toEqual([]);
  });

  it("logs a last_fire_at stamp the store cannot write and still answers the fire", async () => {
    temp = tempStore();
    const routine = fireRoutine();
    await temp.store.saveResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema, routine);
    const store = storeWith(temp.store, "updateResource", () => Promise.reject(new Error("disk on fire")));
    const { logger, lines } = capturingLogger();
    const ctx = fireContext(routine);

    await newFireDirectRunStep({ store, logger, runner: () => STARTED }).execute(ctx);

    const result = ctx.get(FIRE_RESULT_KEY) as RoutineFireResult;
    expect(result.outcome).toBe(RoutineFireOutcome.STARTED);
    expect(result.routine?.status?.lastFireAt).toBeUndefined();
    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Fire's last_fire_at not stamped (best-effort — the run is unaffected)",
        routine_id: ROUTINE_ID,
        error: "disk on fire",
      }),
    ]);
  });

  it("skips the stamp silently for a routine deleted mid-fire, and answers with the routine it loaded", async () => {
    temp = tempStore();
    const routine = fireRoutine();
    const store: Store = storeWith(
      storeWith(temp.store, "updateResource", () => Promise.reject(new ResourceNotFoundError(`routine ${ROUTINE_ID}`))),
      "getResource",
      () => Promise.reject(new ResourceNotFoundError(`routine ${ROUTINE_ID}`)),
    );
    const { logger, lines } = capturingLogger();
    const ctx = fireContext(routine);

    await newFireDirectRunStep({ store, logger, runner: () => STARTED }).execute(ctx);

    const result = ctx.get(FIRE_RESULT_KEY) as RoutineFireResult;
    expect(result.outcome).toBe(RoutineFireOutcome.STARTED);
    expect(result.runId).toBe(RUN_ID);
    expect(result.routine).toBe(routine);
    expect(lines).toEqual([]);
  });

  it("answers with the routine it loaded when the post-fire re-read fails", async () => {
    temp = tempStore();
    const routine = fireRoutine();
    await temp.store.saveResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema, routine);
    const store = storeWith(temp.store, "getResource", () => Promise.reject(new Error("disk on fire")));
    const ctx = fireContext(routine);

    await newFireDirectRunStep({ store, logger: silentLogger, runner: () => STARTED }).execute(ctx);

    const result = ctx.get(FIRE_RESULT_KEY) as RoutineFireResult;
    expect(result.routine).toBe(routine);
    // The stamp itself was written: the row the re-read missed carries it.
    const stored = await temp.store.getResource(ApiResourceKind.routine, ROUTINE_ID, RoutineSchema);
    expect(stored.status?.lastFireAt).toBeDefined();
  });
});
