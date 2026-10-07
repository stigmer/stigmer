/**
 * Pins the cheap read's look-back on both store drivers
 * (session-activity.ts, recentActivity), because it rests on the list
 * index's inclusive `createdAtOrAfter` bound and on its instants sorting
 * in time order as bytes (store/list-index.ts):
 *
 *   - a run stamped at the same instant as one already read, saved after
 *     that read, is caught on the next;
 *   - a run stamped exactly at the bound, its previous read less
 *     RECENT_LOOKBACK_MS, is caught;
 *   - a run stamped inside the look-back but before the newest run
 *     already read is caught.
 *
 * Postgres runs only with `TEST_DATABASE_URL` (authorization/__tests__/drivers.ts).
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  driverFixtures,
  dropPostgresFixture,
  type OpenedStore,
} from "../../authorization/__tests__/drivers.js";
import { createLogger } from "../../boot/logger.js";
import type { SessionActivityReader } from "../provisioner.js";
import {
  RECENT_LOOKBACK_MS,
  newStoreSessionActivityReader,
} from "../session-activity.js";

const T0 = Date.parse("2026-10-03T12:00:00Z");
const PASS_MS = 30_000;

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

afterAll(dropPostgresFixture);

describe.each(driverFixtures([ApiResourceKind.run]))(
  "the cheap read's look-back on $name",
  (fixture) => {
    describe.skipIf(fixture.skip)("recentActivity", () => {
      let opened: OpenedStore;
      let t: number;
      let reader: SessionActivityReader;

      beforeEach(async () => {
        opened = await fixture.open();
        t = T0;
        reader = newStoreSessionActivityReader(
          opened.store,
          silentLogger,
          () => t,
        );
      });

      afterEach(async () => {
        await opened.close();
      });

      async function save(
        id: string,
        phase: RunPhase,
        createdAt: number,
        completedAt?: number,
      ): Promise<void> {
        await opened.store.saveResource(
          ApiResourceKind.run,
          id,
          RunSchema,
          create(RunSchema, {
            apiVersion: "agentic.stigmer.ai/v1",
            kind: "Run",
            metadata: { id, name: id, org: "org-a" },
            spec: {
              target: { case: "sessionId", value: "ses_a" },
              message: "hi",
            },
            status: {
              phase,
              completedAt:
                completedAt === undefined
                  ? ""
                  : new Date(completedAt).toISOString(),
              audit: {
                specAudit: {
                  createdAt: timestampFromDate(new Date(createdAt)),
                },
              },
            },
          }),
        );
      }

      it("catches a run stamped at the same instant as one already read", async () => {
        await save("aex_1", RunPhase.RUN_COMPLETED, T0 - 1_000, T0);
        await reader.recentActivity("ses_a");
        t += PASS_MS;
        await save("aex_2", RunPhase.RUN_IN_PROGRESS, T0 - 1_000);
        expect(await reader.recentActivity("ses_a")).toEqual({
          busy: true,
          lastActiveAt: new Date(T0),
        });
      });

      it("catches a run stamped exactly at the bound", async () => {
        await save("aex_1", RunPhase.RUN_COMPLETED, T0 - 1_000, T0);
        await reader.recentActivity("ses_a");
        const bound = t - RECENT_LOOKBACK_MS;
        t += PASS_MS;
        await save("aex_2", RunPhase.RUN_IN_PROGRESS, bound);
        expect((await reader.recentActivity("ses_a")).busy).toBe(true);
      });

      it("catches a run stamped inside the look-back before the newest run already read", async () => {
        await save("aex_1", RunPhase.RUN_COMPLETED, T0, T0 + 1_000);
        await reader.recentActivity("ses_a");
        t += PASS_MS;
        await save("aex_0", RunPhase.RUN_IN_PROGRESS, T0 - 60_000);
        expect(await reader.recentActivity("ses_a")).toEqual({
          busy: true,
          lastActiveAt: new Date(T0 + 1_000),
        });
      });
    });
  },
);
