/**
 * Pins an agent's quality reads (../quality.ts) on both store drivers:
 * SQLite always, Postgres under TEST_DATABASE_URL. The lanes read the
 * score list index's agent and plugin eval keys with a creation-time
 * window, so each driver's indexed read is what decides the rows.
 *
 * The load-bearing pins:
 *   - the report reads one organization's scores of one agent from the
 *     window's first UTC day: another organization's, another agent's, an
 *     eval try's and an older score are not counted;
 *   - a read longer than one batch follows the index's cursor without
 *     losing or repeating a row (one batch and 50 more);
 *   - the flagged list pages the same rows, failed grades only, and asks
 *     the session scope about each page's sessions; page_size 0 is one
 *     full page with a token, never the whole list.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { afterAll, describe, expect, it } from "vitest";

import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type {
  AgentQualityReport,
  ScoreList,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ListReadScope } from "../../../extensions/list-read-scope.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { LIST_PAGE_MAX_SIZE } from "../../../pipeline/steps/list-page.js";
import type { Store } from "../../../store/interface.js";
import { PostgresStore } from "../../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../../store/postgres/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { PLUGIN_EVAL_LABEL } from "../../plugin-eval/constants.js";
import {
  FLAGGED_SCORES_KEY,
  QUALITY_REPORT_BATCH,
  QUALITY_REPORT_KEY,
  newListFlaggedScoresStep,
  newTallyAgentQualityStep,
  type QualityLaneDeps,
} from "../quality.js";

const NOW = new Date("2026-10-12T15:00:00Z");
const DAY = 86_400_000;
const PERSON: CallerIdentity = {
  identityId: "acc_person",
  callerClass: "user",
  issuer: "test",
  rawToken: "",
};

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
      const store = await PostgresStore.open(
        postgresDatabase.databaseUrl,
        undefined,
        { listIndexes: LIST_INDEXES },
      );
      await store.deleteResourcesByKind(ApiResourceKind.score);
      await store.deleteResourcesByKind(ApiResourceKind.session);
      return { store, close: () => store.close() };
    },
  },
];

afterAll(async () => {
  await postgresDatabase?.drop();
});

let seq = 0;

interface Seed {
  readonly org?: string;
  readonly agentId?: string;
  readonly evalTry?: boolean;
  readonly passed?: boolean;
  readonly daysAgo?: number;
  readonly sessionId?: string;
}

async function seedScore(store: Store, seed: Seed): Promise<string> {
  seq++;
  const id = `scr_quality${seq.toString().padStart(12, "0")}`;
  await store.saveResource(
    ApiResourceKind.score,
    id,
    ScoreSchema,
    create(ScoreSchema, {
      metadata: {
        id,
        name: id,
        slug: id,
        org: seed.org ?? "org_a",
        labels: seed.evalTry === true ? { [PLUGIN_EVAL_LABEL]: "pev_x" } : {},
      },
      spec: {
        runId: `run_quality${seq}`,
        sessionId: seed.sessionId ?? "ses_mine",
        metric: "run-health",
        source: ScoreSource.check,
        evaluatorVersion: "checks-v1",
        value: { case: "passed", value: seed.passed ?? true },
      },
      status: {
        state: ScoreState.graded,
        agentId: seed.agentId ?? "agt_one",
        agentVersionHash: "hash-1",
        audit: {
          specAudit: {
            createdAt: timestampFromMs(
              NOW.getTime() - (seed.daysAgo ?? 0) * DAY - seq,
            ),
          },
        },
      },
    }),
  );
  return id;
}

function deps(
  store: Store,
  scope: ListReadScope | undefined = undefined,
): QualityLaneDeps {
  return { store, logger: silentLogger, listReadScope: scope, now: () => NOW };
}

async function reportOf(
  store: Store,
  days: number,
): Promise<AgentQualityReport> {
  const input = ScoreQueryController.method.getAgentQualityReport.input;
  const ctx = new RequestContext(
    input,
    create(input, { org: "org_a", agentId: "agt_one", days }),
    PERSON,
    ApiResourceKind.score,
  );
  await newTallyAgentQualityStep(deps(store)).execute(ctx);
  return ctx.get(QUALITY_REPORT_KEY) as AgentQualityReport;
}

async function flaggedOf(
  store: Store,
  scope: ListReadScope | undefined,
  pageSize: number,
  pageToken = "",
): Promise<ScoreList> {
  const input = ScoreQueryController.method.listFlaggedByAgent.input;
  const ctx = new RequestContext(
    input,
    create(input, {
      org: "org_a",
      agentId: "agt_one",
      days: 7,
      pageSize,
      pageToken,
    }),
    PERSON,
    ApiResourceKind.score,
  );
  await newListFlaggedScoresStep(deps(store, scope)).execute(ctx);
  return ctx.get(FLAGGED_SCORES_KEY) as ScoreList;
}

describe.each(fixtures)("an agent's quality on $name", (fixture) => {
  it.skipIf(fixture.skip)(
    "counts one organization's live scores of one agent in the window",
    async () => {
      const opened = await fixture.open();
      try {
        const { store } = opened;
        await seedScore(store, {});
        await seedScore(store, { passed: false, daysAgo: 6 });
        await seedScore(store, { org: "org_b" });
        await seedScore(store, { agentId: "agt_two" });
        await seedScore(store, { evalTry: true, passed: false });
        await seedScore(store, { daysAgo: 7 });
        const report = await reportOf(store, 7);
        expect(report.total?.runs).toBe(2);
        expect(
          report.total?.metrics.map((m) => [m.metric, m.passed, m.failed]),
        ).toEqual([["run-health", 1, 1]]);
        expect(report.days.map((d) => d.date)).toEqual([
          "2026-10-06",
          "2026-10-12",
        ]);
      } finally {
        await opened.close();
      }
    },
  );

  it.skipIf(fixture.skip)(
    "follows the cursor across batches without losing or repeating a row",
    async () => {
      const opened = await fixture.open();
      try {
        const { store } = opened;
        const SEEDED = QUALITY_REPORT_BATCH + 50;
        // Seeded in parallel batches: one row at a time takes minutes on a
        // loaded Postgres.
        for (let i = 0; i < SEEDED; i += 50) {
          await Promise.all(
            Array.from({ length: Math.min(50, SEEDED - i) }, () =>
              seedScore(store, {}),
            ),
          );
        }
        const report = await reportOf(store, 1);
        expect(report.total?.runs).toBe(SEEDED);
        expect(report.total?.metrics[0]?.passed).toBe(SEEDED);
      } finally {
        await opened.close();
      }
    },
    120_000,
  );

  it.skipIf(fixture.skip)(
    "pages the failed grades, narrowed by the sessions' scope",
    async () => {
      const opened = await fixture.open();
      try {
        const { store } = opened;
        for (const id of ["ses_mine", "ses_theirs"]) {
          await store.saveResource(
            ApiResourceKind.session,
            id,
            SessionSchema,
            create(SessionSchema, { metadata: { id, org: "org_a" } }),
          );
        }
        const mine = [
          await seedScore(store, { passed: false }),
          await seedScore(store, { passed: false, daysAgo: 1 }),
        ];
        await seedScore(store, { passed: false, sessionId: "ses_theirs" });
        await seedScore(store, { passed: true });
        await seedScore(store, { passed: false, evalTry: true });
        const scope: ListReadScope = {
          authorizedResourceIds: () => Promise.resolve(new Set()),
          restrictListEntries: (_caller, _kind, entries) =>
            Promise.resolve(
              new Set(
                entries.map((e) => e.id).filter((id) => id === "ses_mine"),
              ),
            ),
        };

        const all = await flaggedOf(store, undefined, 0);
        expect(all.items).toHaveLength(3);
        const first = await flaggedOf(store, scope, 1);
        expect(first.items.map((s) => s.metadata?.id)).toEqual([mine[0]]);
        const second = await flaggedOf(store, scope, 1, first.nextPageToken);
        expect(second.items.map((s) => s.metadata?.id)).toEqual([mine[1]]);
        expect(second.nextPageToken).toBe("");
      } finally {
        await opened.close();
      }
    },
  );
  it.skipIf(fixture.skip)(
    "answers page_size 0 with one full page and a token, never the whole list",
    async () => {
      const opened = await fixture.open();
      try {
        const { store } = opened;
        for (let i = 0; i < 105; i += 35) {
          await Promise.all(
            Array.from({ length: 35 }, () =>
              seedScore(store, { passed: false }),
            ),
          );
        }
        const first = await flaggedOf(store, undefined, 0);
        expect(first.items).toHaveLength(LIST_PAGE_MAX_SIZE);
        expect(first.nextPageToken).not.toBe("");
        const rest = await flaggedOf(store, undefined, 0, first.nextPageToken);
        expect(rest.items).toHaveLength(5);
        expect(rest.nextPageToken).toBe("");
      } finally {
        await opened.close();
      }
    },
    60_000,
  );
});
