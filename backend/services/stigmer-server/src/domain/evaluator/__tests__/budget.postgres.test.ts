/**
 * Pins an evaluator's monthly grading budget (../budget.ts) on both store
 * drivers: SQLite always, Postgres under TEST_DATABASE_URL.
 *
 * The load-bearing pins:
 *   - a reservation sets one cap aside, and is refused, counted as not
 *     graded with the limit's reason, once this month's spend, the spend
 *     set aside and one more cap would pass the limit; a limit of exactly
 *     forty caps admits the fortieth;
 *   - twenty concurrent reservations against a limit of five caps set
 *     aside exactly five and never pass it: the store's atomic
 *     read-modify-write loses no increment;
 *   - a disabled or deleted evaluator reserves nothing and writes nothing;
 *   - a settle gives the cap back, adds what the judge spent and counts the
 *     grade; a grade reserved in one month and settled in the next lands in
 *     the new month and never takes reserved below zero;
 *   - the first write of a new month rolls the period over.
 */
import { create } from "@bufbuild/protobuf";
import { afterAll, describe, expect, it } from "vitest";

import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import type { Store } from "../../../store/interface.js";
import { PostgresStore } from "../../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../../store/postgres/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { periodOf, reserve, settle } from "../budget.js";

const CAP = 0.25;
const LIMIT_REASON = "spending limit reached";
const OCTOBER = new Date("2026-10-31T23:59:00Z");
const NOVEMBER = new Date("2026-11-01T00:01:00Z");

interface OpenedStore {
  readonly store: Store;
  close(): Promise<void>;
}

interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<OpenedStore>;
}

let postgresDatabase: TestDatabase | undefined;

const fixtures: DriverFixture[] = [
  {
    name: "sqlite",
    skip: false,
    async open() {
      const temp = tempStore();
      return { store: temp.store, close: () => temp.cleanup() };
    },
  },
  {
    name: "postgres",
    skip: testDatabaseAdminUrl() === undefined,
    async open() {
      postgresDatabase ??= await createTestDatabase();
      const store = await PostgresStore.open(postgresDatabase.databaseUrl, undefined, {
        listIndexes: LIST_INDEXES,
      });
      await store.deleteResourcesByKind(ApiResourceKind.evaluator);
      return { store, close: () => store.close() };
    },
  },
];

afterAll(async () => {
  await postgresDatabase?.drop();
});

let seq = 0;

async function seedEvaluator(
  store: Store,
  monthlyLimitUsd: number,
  enabled = true,
): Promise<string> {
  seq++;
  const id = `evl_budget${seq.toString().padStart(16, "0")}`;
  await store.saveResource(
    ApiResourceKind.evaluator,
    id,
    EvaluatorSchema,
    create(EvaluatorSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Evaluator",
      metadata: { id, name: id, org: "org_budget" },
      spec: { agentId: `agt_${seq}`, enabled, sampleRate: 1, monthlyLimitUsd },
    }),
  );
  return id;
}

async function read(store: Store, id: string): Promise<Evaluator> {
  return store.getResource(ApiResourceKind.evaluator, id, EvaluatorSchema);
}

describe.each(fixtures)("the grading budget ($name)", (fixture) => {
  it.skipIf(fixture.skip)("reserves a cap per grade and refuses the one that would pass the limit", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 0.6);
      expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON)).toBe("reserved");
      expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON)).toBe("reserved");
      expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON)).toBe("limit-reached");
      const status = (await read(store, id)).status;
      expect(status?.period).toBe("2026-10");
      expect(status?.reservedUsd).toBe(0.5);
      expect(status?.notGraded).toBe(1);
      expect(status?.lastNotGradedReason).toBe(LIMIT_REASON);
    } finally {
      await close();
    }
  });

  it.skipIf(fixture.skip)("admits the grade that reaches the limit exactly", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 10);
      for (let i = 0; i < 40; i++) {
        expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON), `grade ${i + 1}`).toBe("reserved");
      }
      expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON)).toBe("limit-reached");
    } finally {
      await close();
    }
  });

  it.skipIf(fixture.skip)("never passes the limit under twenty concurrent reservations", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 5 * CAP);
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, () => reserve(store, id, OCTOBER, CAP, LIMIT_REASON)),
      );
      expect(outcomes.filter((outcome) => outcome === "reserved")).toHaveLength(5);
      const status = (await read(store, id)).status;
      expect(status?.reservedUsd).toBe(5 * CAP);
      expect(status?.notGraded).toBe(15);
    } finally {
      await close();
    }
  });

  it.skipIf(fixture.skip)("reserves nothing for a disabled or deleted evaluator", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 10, false);
      expect(await reserve(store, id, OCTOBER, CAP, LIMIT_REASON)).toBe("off");
      expect((await read(store, id)).status?.period ?? "").toBe("");
      expect(await reserve(store, "evl_nobody", OCTOBER, CAP, LIMIT_REASON)).toBe("off");
    } finally {
      await close();
    }
  });

  it.skipIf(fixture.skip)("settles the cap and the spend, and counts the grade", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 10);
      await reserve(store, id, OCTOBER, CAP, LIMIT_REASON);
      await reserve(store, id, OCTOBER, CAP, LIMIT_REASON);
      await settle(store, id, OCTOBER, CAP, 0.031, { kind: "graded" });
      await settle(store, id, OCTOBER, CAP, 0, { kind: "not-graded", reason: "out of credit" });
      const status = (await read(store, id)).status;
      expect(status?.reservedUsd).toBe(0);
      expect(status?.spentUsd).toBe(0.031);
      expect(status?.graded).toBe(1);
      expect(status?.notGraded).toBe(1);
      expect(status?.lastNotGradedReason).toBe("out of credit");
      await settle(store, "evl_nobody", OCTOBER, CAP, 0.1, { kind: "graded" });
    } finally {
      await close();
    }
  });

  it.skipIf(fixture.skip)("lands a grade reserved in one month and settled in the next in the new month", async () => {
    const { store, close } = await fixture.open();
    try {
      const id = await seedEvaluator(store, 10);
      await reserve(store, id, OCTOBER, CAP, LIMIT_REASON);
      await settle(store, id, NOVEMBER, CAP, 0.04, { kind: "graded" });
      const status = (await read(store, id)).status;
      expect(status?.period).toBe("2026-11");
      expect(status?.reservedUsd, "the old month's cap is not taken back twice").toBe(0);
      expect(status?.spentUsd).toBe(0.04);
      expect(status?.graded).toBe(1);
      expect(periodOf(NOVEMBER)).toBe("2026-11");
    } finally {
      await close();
    }
  });
});
