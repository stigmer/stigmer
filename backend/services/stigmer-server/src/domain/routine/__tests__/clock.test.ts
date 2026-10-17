/**
 * Pins the write path's clock steps (clock.ts) where the composed suite,
 * whose engine is a closed port, cannot reach them:
 *   - ArmRoutineArtifact mirrors the clock's fresh next_fire_at into the
 *     answered routine, materializing a status the routine did not carry,
 *     and clears it when the clock answers paused;
 *   - DeleteRoutineFires logs a fire ledger the store cannot remove and
 *     never fails the delete.
 *
 * The clock is a stub that answers a fixed stamp; the store is a double
 * whose one method rejects.
 */
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { describe, expect, it } from "vitest";

import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../../pipeline/steps/delete.js";
import type { Store } from "../../../store/interface.js";
import { newArmRoutineStep, newDeleteRoutineFiresStep } from "../clock.js";
import type { RoutineClock } from "../clock.js";
import { capturingLogger } from "./support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const NEXT_FIRE = new Date("2026-10-18T09:00:00Z");

function stampingClock(stamp: Date | undefined): RoutineClock {
  return {
    ensureAndRecord: () => Promise.resolve(stamp),
    teardown: () => Promise.resolve(),
  };
}

function writeContext(withStatus: boolean) {
  const routine = create(RoutineSchema, {
    metadata: { id: "rtn_armed", org: "org_acme" },
    spec: { cron: "0 9 * * *", timeZone: "UTC", enabled: true },
    status: withStatus ? { nextFireAt: { seconds: 1n } } : undefined,
  });
  return new RequestContext(RoutineSchema, routine, testCallerIdentity(), ApiResourceKind.routine);
}

describe("ArmRoutineArtifact", () => {
  it("mirrors the clock's next fire into a routine that carried no status", async () => {
    const ctx = writeContext(false);
    await newArmRoutineStep(() => stampingClock(NEXT_FIRE), silentLogger).execute(ctx);
    expect(ctx.newState.status).toBeDefined();
    expect(timestampDate(ctx.newState.status!.nextFireAt!)).toEqual(NEXT_FIRE);
  });

  it("clears next_fire_at when the clock answers that the routine is paused", async () => {
    const ctx = writeContext(true);
    await newArmRoutineStep(() => stampingClock(undefined), silentLogger).execute(ctx);
    expect(ctx.newState.status?.nextFireAt).toBeUndefined();
  });
});

describe("DeleteRoutineFires", () => {
  it("logs a fire ledger the store cannot remove and never fails the delete", async () => {
    const { logger, lines } = capturingLogger();
    const store = {
      deleteRoutineFiresByRoutine: () => Promise.reject(new Error("disk on fire")),
    } as unknown as Store;
    const ctx = new RequestContext(
      RoutineCommandController.method.delete.input,
      create(RoutineCommandController.method.delete.input, { value: "rtn_gone" }),
      testCallerIdentity(),
      ApiResourceKind.routine,
    );
    ctx.set(RESOURCE_ID_KEY, "rtn_gone");

    await newDeleteRoutineFiresStep(store, logger).execute(ctx);

    expect(lines).toEqual([
      expect.objectContaining({
        level: "warn",
        message: "Fire-ledger cleanup failed (non-fatal — orphaned rows answer no query; retention prunes them)",
        routine_id: "rtn_gone",
        error: "disk on fire",
      }),
    ]);
  });
});
