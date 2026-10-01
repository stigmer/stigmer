/**
 * What a list read costs at production's shape, measured on both drivers.
 * Gated on `STORE_MEASURE=1` and SKIPPED otherwise (the
 * `AUTHORIZATION_MEASURE` idiom of authorization/__tests__/
 * list-read-scope.measure.test.ts): seeding tens of megabytes takes a
 * while, and the numbers are recorded beside the change that moves them,
 * not asserted — no budget is ruled for open source.
 *
 * The seed is the hosted edition's population as read on 2026-09-23:
 * 1,279 agent executions averaging about 37 KB each (the kind's rows are
 * fat: every message, tool call and todo of a run rides the row), 865
 * sessions of about half a kilobyte, twelve organizations with one third
 * of every kind in the busiest. The payload is uniform where production's
 * is skewed (its largest execution is 4 MB), so these numbers understate
 * the tail, never the median.
 *
 * Each shape is timed as the lane pays for it — the store read, the
 * decode, the lane's own predicate — as the median of five runs after one
 * warm-up. The "today" shapes read the whole kind the way every lane did
 * before the list index; the "indexed" shapes read the same answer through
 * `queryResources`. The status-write shape times the run's hottest write,
 * an `updateResource` that changes no list key, which the index must not
 * slow; it uses only the store API that predates the index, so the same
 * file measures the code before and after.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import { afterAll, describe, expect, it } from "vitest";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../boot/list-indexes.js";
import { agentExecutionListIndex } from "../../domain/agentexecution/list-index.js";
import { sessionListIndex } from "../../domain/session/list-index.js";
import type { Store } from "../interface.js";
import { PostgresStore } from "../postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
} from "../postgres/__tests__/support.js";
import type { TestDatabase } from "../postgres/__tests__/support.js";
import { tempStore } from "../sqlite/__tests__/support.js";

const MEASURE = process.env["STORE_MEASURE"] === "1";

const ORGS = 12;
const EXECUTIONS = 1_279;
const SESSIONS = 865;
const MESSAGES_PER_EXECUTION = 40;
const MESSAGE_CHARS = 900;
const BUSY_ORG = "org-00";
const RUNS = 5;

function orgOf(index: number): string {
  // One third of every kind in the busiest organization, the rest spread.
  return index % 3 === 0
    ? BUSY_ORG
    : `org-${String((index % (ORGS - 1)) + 1).padStart(2, "0")}`;
}

function sessionIdOf(index: number): string {
  return `ses_${String(index).padStart(26, "0")}`;
}

function createdAt(index: number): { seconds: bigint; nanos: number } {
  return { seconds: BigInt(1_790_000_000 + index), nanos: 0 };
}

async function seed(store: Store): Promise<void> {
  const content = "x".repeat(MESSAGE_CHARS);
  for (let i = 0; i < SESSIONS; i++) {
    const id = sessionIdOf(i);
    await store.saveResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
      create(SessionSchema, {
        metadata: { id, org: orgOf(i), name: `session ${i}` },
        spec: { subject: `subject ${i}` },
        status: {
          audit: { specAudit: { createdAt: createdAt(i) } },
        },
      }),
    );
  }
  for (let i = 0; i < EXECUTIONS; i++) {
    const id = `aex_${String(i).padStart(26, "0")}`;
    const session = i % SESSIONS;
    await store.saveResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: { id, org: orgOf(session) },
        spec: { sessionId: sessionIdOf(session), message: "run it" },
        status: {
          messages: Array.from({ length: MESSAGES_PER_EXECUTION }, (_, m) => ({
            type:
              m % 2 === 0 ? MessageType.MESSAGE_HUMAN : MessageType.MESSAGE_AI,
            content,
            timestamp: "2026-09-23T10:00:00Z",
          })),
          audit: { specAudit: { createdAt: createdAt(i) } },
        },
      }),
    );
  }
}

async function median(
  work: () => Promise<number>,
): Promise<{ ms: number; rows: number }> {
  await work();
  const samples: number[] = [];
  let rows = 0;
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    rows = await work();
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  return { ms: Math.round(samples[Math.floor(RUNS / 2)] ?? 0), rows };
}

function decodeExecutions(rows: ReadonlyArray<Uint8Array>): AgentExecution[] {
  return rows.map((row) => fromBinary(AgentExecutionSchema, row));
}

interface Shape {
  readonly name: string;
  run(store: Store): Promise<number>;
}

/** What each lane pays today: the whole kind, decoded, then its predicate. */
const TODAY: ReadonlyArray<Shape> = [
  {
    name: "agentExecution.list(org) — whole kind, org in memory",
    async run(store) {
      const rows = await store.listResources(ApiResourceKind.agent_execution);
      return decodeExecutions(rows).filter((e) => e.metadata?.org === BUSY_ORG)
        .length;
    },
  },
  {
    name: "agentExecution.listBySession — whole kind, session in memory",
    async run(store) {
      const rows = await store.listResources(ApiResourceKind.agent_execution);
      return decodeExecutions(rows).filter(
        (e) => e.spec?.sessionId === sessionIdOf(0),
      ).length;
    },
  },
  {
    name: "session.list — whole kind",
    async run(store) {
      const rows = await store.listResources(ApiResourceKind.session);
      return rows.map((row) => fromBinary(SessionSchema, row)).length;
    },
  },
];

/** The same answers read through the list index. */
const INDEXED: ReadonlyArray<Shape> = [
  {
    name: "agentExecution.list(org) — the organization's rows, every one",
    async run(store) {
      const rows = await store.queryResources(agentExecutionListIndex, {
        org: BUSY_ORG,
      });
      return decodeExecutions(rows.map((row) => row.data)).length;
    },
  },
  {
    name: "agentExecution.list(org) — one page of 50",
    async run(store) {
      const rows = await store.queryResources(agentExecutionListIndex, {
        org: BUSY_ORG,
        limit: 50,
      });
      return decodeExecutions(rows.map((row) => row.data)).length;
    },
  },
  {
    name: "agentExecution.listBySession — the session key",
    async run(store) {
      const rows = await store.queryResources(agentExecutionListIndex, {
        anyKey: [{ name: "session", value: sessionIdOf(0) }],
      });
      return decodeExecutions(rows.map((row) => row.data)).length;
    },
  },
  {
    name: "session.list(org) — one page of 50",
    async run(store) {
      const rows = await store.queryResources(sessionListIndex, {
        org: BUSY_ORG,
        limit: 50,
      });
      return rows.map((row) => fromBinary(SessionSchema, row.data)).length;
    },
  },
];

const STATUS_WRITES = 200;

/** The run's hottest write: a status persist that changes no list key. */
async function timeStatusWrites(store: Store): Promise<number> {
  const id = `aex_${String(1).padStart(26, "0")}`;
  const started = performance.now();
  for (let i = 0; i < STATUS_WRITES; i++) {
    await store.updateResource(
      ApiResourceKind.agent_execution,
      id,
      AgentExecutionSchema,
      (execution) => {
        execution.status!.error = `write ${i}`;
      },
    );
  }
  return (performance.now() - started) / STATUS_WRITES;
}

let postgresDatabase: TestDatabase | undefined;

const DRIVERS: ReadonlyArray<{
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<{ store: Store; close(): Promise<void> }>;
}> = [
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
      postgresDatabase = await createTestDatabase();
      const store = await PostgresStore.open(
        postgresDatabase.databaseUrl,
        undefined,
        {
          listIndexes: LIST_INDEXES,
        },
      );
      return { store, close: () => store.close() };
    },
  },
];

afterAll(async () => {
  await postgresDatabase?.drop();
});

describe.skipIf(!MEASURE)("list reads at production's shape", () => {
  describe.each(DRIVERS)("$name", (driver) => {
    it.skipIf(driver.skip)(
      "times every shape",
      async () => {
        const opened = await driver.open();
        try {
          await seed(opened.store);
          for (const [label, shapes] of [
            ["today", TODAY],
            ["indexed", INDEXED],
          ] as const) {
            for (const shape of shapes) {
              const { ms, rows } = await median(() => shape.run(opened.store));
              console.log(
                `[measure] ${driver.name} ${label} ${shape.name}: ${ms} ms (${rows} rows kept)`,
              );
              expect(rows).toBeGreaterThan(0);
            }
          }
          const perWrite = await timeStatusWrites(opened.store);
          console.log(
            `[measure] ${driver.name} status write (updateResource, no key change): ${perWrite.toFixed(2)} ms per write over ${STATUS_WRITES}`,
          );
        } finally {
          await opened.close();
        }
      },
      600_000,
    );
  });
});
