/**
 * Pins how the fire ledger reads back on the wire (list-fires.ts): every
 * origin and outcome label the store writes maps to its ScheduleFire enum
 * value, and a label the store never writes reads as UNSPECIFIED rather than
 * failing the page; a row still in flight takes its run's live phase, and
 * keeps its recorded outcome when the run is gone; a store that cannot list
 * the ledger fails the read as an internal error.
 *
 * The store is a real throwaway SQLite store; the step runs as the listFires
 * pipeline runs it.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  RoutineFireOrigin,
  RoutineFireOutcome,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import type { RoutineFireList } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import type { Store } from "../../../store/interface.js";
import { LIST_FIRES_RESULT_KEY, newListFiresFromLedgerStep } from "../list-fires.js";

const ROUTINE_ID = "sch_ledger";

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

/** The listFires request for this schedule's first page. */
function listRequest(size: number) {
  return new RequestContext(
    RoutineQueryController.method.listFires.input,
    create(RoutineQueryController.method.listFires.input, {
      routineId: ROUTINE_ID,
      pageSize: size,
    }),
    testCallerIdentity(),
  );
}

/** The ledger rows of one schedule, read back through the step. */
async function listed(
  rows: ReadonlyArray<{ origin: string; outcome: string; runId?: string; completedAt?: string }>,
  seed: (store: Store) => Promise<void> = () => Promise.resolve(),
): Promise<RoutineFireList> {
  temp = tempStore();
  const store = temp.store;
  await seed(store);
  await store.saveResource(
    ApiResourceKind.routine,
    ROUTINE_ID,
    RoutineSchema,
    create(RoutineSchema, { metadata: { id: ROUTINE_ID, org: "org_acme", name: "Ledger" } }),
  );
  for (const [i, row] of rows.entries()) {
    await store.upsertRoutineFire({
      routineId: ROUTINE_ID,
      fireId: `fire-${i}`,
      org: "org_acme",
      // One second apart, oldest first, so the page reads newest first.
      nominalFireTime: `2026-10-07T00:00:${String(i).padStart(2, "0")}Z`,
      origin: row.origin,
      outcome: row.outcome,
      reason: "",
      runId: row.runId ?? "",
      recordedAt: "",
      completedAt: row.completedAt ?? "2026-10-07T01:00:00Z",
    });
  }
  const ctx = listRequest(rows.length);
  await newListFiresFromLedgerStep(store).execute(ctx);
  return ctx.get(LIST_FIRES_RESULT_KEY) as RoutineFireList;
}

describe("the fire ledger's labels on the wire", () => {
  it("maps every outcome label the store writes, and an unknown one to UNSPECIFIED", async () => {
    const labels: ReadonlyArray<readonly [string, RoutineFireOutcome]> = [
      ["started", RoutineFireOutcome.STARTED],
      ["refused", RoutineFireOutcome.REFUSED],
      ["target_missing", RoutineFireOutcome.TARGET_MISSING],
      ["skipped", RoutineFireOutcome.SKIPPED],
      ["completed", RoutineFireOutcome.COMPLETED],
      ["failed", RoutineFireOutcome.FAILED],
      ["timed_out", RoutineFireOutcome.TIMED_OUT],
      ["exploded", RoutineFireOutcome.UNSPECIFIED],
    ];
    const list = await listed(labels.map(([outcome]) => ({ origin: "schedule", outcome })));
    expect(list.entries).toHaveLength(labels.length);
    expect(list.entries.map((fire) => fire.outcome)).toEqual(labels.map(([, outcome]) => outcome).reverse());
  });

  it("maps both origin labels, and an unknown one to UNSPECIFIED", async () => {
    const list = await listed([
      { origin: "schedule", outcome: "completed" },
      { origin: "manual", outcome: "completed" },
      { origin: "webhook", outcome: "completed" },
    ]);
    expect(list.entries.map((fire) => fire.origin)).toEqual([
      RoutineFireOrigin.UNSPECIFIED,
      RoutineFireOrigin.MANUAL,
      RoutineFireOrigin.SCHEDULE,
    ]);
  });
});

describe("a fire still in flight on the ledger", () => {
  it("takes its run's live phase, and keeps the recorded outcome when the run is gone or was never made", async () => {
    const list = await listed(
      [
        { origin: "schedule", outcome: "skipped", runId: "", completedAt: "" },
        { origin: "manual", outcome: "started", runId: "run_gone", completedAt: "" },
        { origin: "manual", outcome: "started", runId: "run_done", completedAt: "" },
      ],
      (store) =>
        store.saveResource(
          ApiResourceKind.run,
          "run_done",
          RunSchema,
          create(RunSchema, {
            kind: "Run",
            metadata: { id: "run_done", org: "org_acme" },
            status: { phase: RunPhase.RUN_COMPLETED },
          }),
        ),
    );
    expect(list.entries.map((fire) => [fire.runId, fire.outcome])).toEqual([
      ["run_done", RoutineFireOutcome.COMPLETED],
      ["run_gone", RoutineFireOutcome.STARTED],
      ["", RoutineFireOutcome.SKIPPED],
    ]);
  });
});

describe("a ledger the store cannot list", () => {
  it("fails the read as an internal error naming the ledger", async () => {
    const store = {
      listScheduleFires: () => Promise.reject(new Error("disk on fire")),
    } as unknown as Store;
    const failure = await Promise.resolve()
      .then(() => newListFiresFromLedgerStep(store).execute(listRequest(10)))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Internal);
    expect((failure as ConnectError).rawMessage).toBe("failed to list schedule fires");
  });
});
