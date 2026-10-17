/**
 * Pins the hourly limit on hand fires (fire-rate.ts) over a real throwaway
 * SQLite ledger: a routine below its limit fires, one at its limit is
 * refused with RESOURCE_EXHAUSTED and the sentence naming the limit; only
 * the routine's own hand fires of the last hour count, never its
 * schedule's fires, an older hour's or another routine's; and a limit
 * below 1 reads nothing and refuses nothing.
 *
 * The composed wiring (the server's setting reaching the fire chain, and
 * the order that lets authorization and the disabled refusal come first)
 * is fire-rate.composed.test.ts's.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";

import { errorOf, testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { fireRateExceededMessage, newValidateFireRateStep } from "../fire-rate.js";

const ROUTINE_ID = "rtn_rate";
const NOW = new Date("2026-10-17T12:00:00Z");

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

/** A fire of the rate's routine, recorded at `recordedAt`. */
async function recordFire(
  store: Store,
  fireId: string,
  recordedAt: string,
  overrides: { routineId?: string; origin?: string } = {},
): Promise<void> {
  await store.upsertRoutineFire({
    routineId: overrides.routineId ?? ROUTINE_ID,
    fireId,
    org: "org_acme",
    nominalFireTime: recordedAt,
    origin: overrides.origin ?? "manual",
    outcome: "started",
    reason: "",
    runId: "",
    recordedAt,
    completedAt: "",
  });
}

/** Runs the step for one fire of the rate's routine. */
async function fireOnce(store: Store, firesPerHour: number): Promise<void> {
  const ctx = new RequestContext(
    RoutineCommandController.method.fire.input,
    create(RoutineCommandController.method.fire.input, { id: ROUTINE_ID }),
    testCallerIdentity(),
  );
  ctx.set(
    EXISTING_RESOURCE_KEY,
    create(RoutineSchema, { metadata: { id: ROUTINE_ID, org: "org_acme" }, spec: { enabled: true } }),
  );
  await newValidateFireRateStep({ store, firesPerHour, now: () => NOW }).execute(ctx);
}

describe("ValidateFireRate", () => {
  it("lets a routine fire below its limit and refuses it at the limit, naming the limit", async () => {
    temp = tempStore();
    await recordFire(temp.store, "f1", "2026-10-17T11:10:00Z");
    await fireOnce(temp.store, 2);

    await recordFire(temp.store, "f2", "2026-10-17T11:50:00Z");
    const refusal = await errorOf(() => fireOnce(temp!.store, 2));
    expect(refusal.code).toBe(Code.ResourceExhausted);
    expect(refusal.rawMessage).toBe(fireRateExceededMessage(2));
    expect(refusal.rawMessage).toBe(
      "This routine was started by hand 2 times in the last hour, the most it allows; it can be started again later in the hour.",
    );
  });

  it("counts only the routine's own hand fires of the last hour", async () => {
    temp = tempStore();
    // The hour starts at 11:00:00, inclusive.
    await recordFire(temp.store, "old", "2026-10-17T10:59:59Z");
    await recordFire(temp.store, "edge", "2026-10-17T11:00:00Z");
    await recordFire(temp.store, "tick-1", "2026-10-17T11:20:00Z", { origin: "schedule" });
    await recordFire(temp.store, "tick-2", "2026-10-17T11:40:00Z", { origin: "schedule" });
    await recordFire(temp.store, "other", "2026-10-17T11:30:00Z", { routineId: "rtn_other" });

    await fireOnce(temp.store, 2);
    await recordFire(temp.store, "f2", "2026-10-17T11:55:00Z");
    expect((await errorOf(() => fireOnce(temp!.store, 2))).code).toBe(Code.ResourceExhausted);
  });

  it("reads nothing and refuses nothing with a limit below 1", async () => {
    temp = tempStore();
    const store = temp.store;
    let reads = 0;
    const counting: Pick<Store, "countRoutineFiresSince"> = {
      countRoutineFiresSince: (...args) => {
        reads += 1;
        return store.countRoutineFiresSince(...args);
      },
    };
    await recordFire(store, "f1", "2026-10-17T11:30:00Z");
    for (const limit of [0, -1]) {
      const ctx = new RequestContext(
        RoutineCommandController.method.fire.input,
        create(RoutineCommandController.method.fire.input, { id: ROUTINE_ID }),
        testCallerIdentity(),
      );
      ctx.set(EXISTING_RESOURCE_KEY, create(RoutineSchema, { metadata: { id: ROUTINE_ID } }));
      await newValidateFireRateStep({ store: counting, firesPerHour: limit, now: () => NOW }).execute(ctx);
    }
    expect(reads).toBe(0);
  });
});
