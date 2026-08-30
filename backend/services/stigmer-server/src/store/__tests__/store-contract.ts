/**
 * The driver-agnostic Store contract suite — every behavior a driver must
 * satisfy identically, extracted from the Phase-1 sqlite driver tests when
 * the Postgres driver arrived (T01 gate decision D-4). Each driver invokes
 * describeStoreContract with its own fixture; the assertions here may only
 * speak the Store interface (plus the two named escape hatches below for
 * arms the interface deliberately cannot express).
 *
 * Covered contracts and their provenance: resource CRUD round-trips,
 * updateResource atomic RMW incl. the DD-010 no-lost-update guarantee
 * (per-resource atomicity — the parallel-updates assertion is
 * deliberately order-agnostic: sqlite serializes globally, Postgres
 * per-row), the preserved findAllByField quirk (sqlite sub-project
 * DD-001), audit ordering + the #341 single-holder tag move,
 * first-writer-wins events (oss#308), the terminal-immutable schedule-run
 * ledger (DD-017 D-7), the engine-neutral search read semantics (DD-009:
 * token match / single-term prefix / AND; wire-ready 0–1 scores;
 * list-mode newest-first at exactly 1.0 — search-mode ranking ORDER is
 * deliberately NOT asserted here, it is driver-relative), the two-phase
 * signal-dedupe hold (oss#442), OAuth grants, once-only pending-state
 * redemption with its 10-minute TTL, and the closed-store failure mode.
 *
 * Driver-physical behavior (column layouts, FTS5/tsvector internals,
 * migration chains) stays in each driver's own tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import {
  AuditNotFoundError,
  IN_FLIGHT_CLAIM_TTL_MS,
  ResourceNotFoundError,
} from "../interface.js";
import type {
  OAuthGrant,
  PendingOAuthState,
  SearchIndexEntry,
  Store,
  WorkflowExecutionEventRecord,
} from "../interface.js";
import { makeOrganization } from "./support.js";

/** One fresh, isolated store per test, plus the driver escape hatches. */
export interface StoreContractFixture {
  store: Store;
  /**
   * Ages a signal-dedupe row directly (crash-recovery arm: a hold whose
   * delivery died must self-heal at the next claim). The interface has no
   * clock injection by design — expiry manipulation is a driver-side test
   * concern.
   */
  forceDedupeExpiry(id: string, expiresAtIso: string): Promise<void>;
  /**
   * Counts pending_oauth_state rows directly (the expired-state arm must
   * prove the row is DELETED, not merely unredeemable).
   */
  countPendingOAuthStates(): Promise<number>;
  cleanup(): Promise<void>;
}

const KIND = ApiResourceKind.organization;

function event(
  sequenceNumber: number,
  eventType = "task_started",
  taskName = "step-a",
): WorkflowExecutionEventRecord {
  return {
    executionId: "wfe_1",
    sequenceNumber,
    eventType,
    taskName,
    data: new Uint8Array([sequenceNumber]),
    createdAt: "",
  };
}

export function describeStoreContract(
  makeFixture: () => Promise<StoreContractFixture>,
): void {
  let fx: StoreContractFixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  describe("resource CRUD", () => {
    it("round-trips a resource through save and get", async () => {
      const org = makeOrganization({ id: "acme" });
      await fx.store.saveResource(KIND, "acme", OrganizationSchema, org);

      const loaded = await fx.store.getResource(
        KIND,
        "acme",
        OrganizationSchema,
      );
      expect(loaded.metadata?.name).toBe("Acme");
    });

    it("saveResource upserts on kind+id", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization(),
      );
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ description: "second write" }),
      );
      const loaded = await fx.store.getResource(
        KIND,
        "acme",
        OrganizationSchema,
      );
      expect(loaded.spec?.description).toBe("second write");
      expect(await fx.store.listResources(KIND)).toHaveLength(1);
    });

    it("getResource throws ResourceNotFoundError with the kind/id detail", async () => {
      await expect(
        fx.store.getResource(KIND, "ghost", OrganizationSchema),
      ).rejects.toThrow(ResourceNotFoundError);
      await expect(
        fx.store.getResource(KIND, "ghost", OrganizationSchema),
      ).rejects.toThrow("resource not found: organization/ghost");
    });

    it("deleteResource is a silent no-op for a missing resource", async () => {
      await expect(
        fx.store.deleteResource(KIND, "ghost"),
      ).resolves.toBeUndefined();
    });

    it("listResources returns an empty array (never undefined) for an empty kind", async () => {
      expect(await fx.store.listResources(KIND)).toEqual([]);
    });

    it("deleteResourcesByKind and ByIdPrefix return the deleted counts", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ id: "acme" }),
      );
      await fx.store.saveResource(
        KIND,
        "beta",
        OrganizationSchema,
        makeOrganization({ id: "beta" }),
      );
      await fx.store.saveResource(
        KIND,
        "acme-2",
        OrganizationSchema,
        makeOrganization({ id: "acme-2" }),
      );

      expect(await fx.store.deleteResourcesByIdPrefix(KIND, "acme")).toBe(2);
      expect(await fx.store.deleteResourcesByKind(KIND)).toBe(1);
    });

    it("deleteResourcesByIdPrefix treats LIKE metacharacters in the prefix literally", async () => {
      await fx.store.saveResource(
        KIND,
        "a_c",
        OrganizationSchema,
        makeOrganization({ id: "a_c" }),
      );
      await fx.store.saveResource(
        KIND,
        "abc",
        OrganizationSchema,
        makeOrganization({ id: "abc" }),
      );

      // "a_c" must match only the literal id — an unescaped LIKE '_' would
      // also delete "abc".
      expect(await fx.store.deleteResourcesByIdPrefix(KIND, "a_c")).toBe(1);
      expect(await fx.store.listResources(KIND)).toHaveLength(1);
    });
  });

  describe("updateResource (atomic RMW)", () => {
    it("applies the mutation and returns the persisted message", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization(),
      );

      const updated = await fx.store.updateResource(
        KIND,
        "acme",
        OrganizationSchema,
        (org) => {
          org.spec!.description = "mutated";
        },
      );
      expect(updated.spec?.description).toBe("mutated");

      const reloaded = await fx.store.getResource(
        KIND,
        "acme",
        OrganizationSchema,
      );
      expect(reloaded.spec?.description).toBe("mutated");
    });

    it("a throwing modify skips the write and propagates (transaction rolled back)", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ description: "original" }),
      );

      await expect(
        fx.store.updateResource(KIND, "acme", OrganizationSchema, () => {
          throw new Error("modify failed");
        }),
      ).rejects.toThrow("modify failed");

      const reloaded = await fx.store.getResource(
        KIND,
        "acme",
        OrganizationSchema,
      );
      expect(reloaded.spec?.description).toBe("original");
      // The rolled-back transaction must not leave the connection wedged.
      await expect(
        fx.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
          org.spec!.description = "after rollback";
        }),
      ).resolves.toBeDefined();
    });

    it("throws ResourceNotFoundError for a missing resource", async () => {
      await expect(
        fx.store.updateResource(KIND, "ghost", OrganizationSchema, () => {}),
      ).rejects.toThrow(ResourceNotFoundError);
    });

    it("parallel updates to ONE resource both land — no lost update (DD-010 per-resource atomicity)", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ description: "" }),
      );
      await Promise.all([
        fx.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
          org.spec!.description += "|first";
        }),
        fx.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
          org.spec!.description += "|second";
        }),
      ]);
      const reloaded = await fx.store.getResource(
        KIND,
        "acme",
        OrganizationSchema,
      );
      // Order is driver-relative (sqlite serializes globally, Postgres
      // per-row); the CONTRACT is that neither write is lost.
      expect(["|first|second", "|second|first"]).toContain(
        reloaded.spec?.description,
      );
    });

    it("parallel updates to DIFFERENT resources both land", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ id: "acme" }),
      );
      await fx.store.saveResource(
        KIND,
        "beta",
        OrganizationSchema,
        makeOrganization({ id: "beta" }),
      );

      await Promise.all([
        fx.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
          org.spec!.description = "acme-updated";
        }),
        fx.store.updateResource(KIND, "beta", OrganizationSchema, (org) => {
          org.spec!.description = "beta-updated";
        }),
      ]);

      const acme = await fx.store.getResource(KIND, "acme", OrganizationSchema);
      const beta = await fx.store.getResource(KIND, "beta", OrganizationSchema);
      expect(acme.spec?.description).toBe("acme-updated");
      expect(beta.spec?.description).toBe("beta-updated");
    });
  });

  describe("field and label queries", () => {
    it("findByField matches camelCase paths with snake_case fallback (Go's two-probe lookup)", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ id: "acme" }),
      );
      await fx.store.saveResource(
        KIND,
        "beta",
        OrganizationSchema,
        makeOrganization({ id: "beta", name: "Beta", description: "target" }),
      );

      const bySpec = await fx.store.findByField(
        KIND,
        "spec.description",
        "target",
        OrganizationSchema,
      );
      expect(bySpec.metadata?.id).toBe("beta");

      // "apiVersion" resolves via camelCase→snake_case ("api_version").
      const byTop = await fx.store.findByField(
        KIND,
        "apiVersion",
        "tenancy.stigmer.ai/v1",
        OrganizationSchema,
      );
      expect(byTop.metadata).toBeDefined();
    });

    it("findByField throws ResourceNotFoundError naming the predicate", async () => {
      await expect(
        fx.store.findByField(
          KIND,
          "spec.description",
          "none",
          OrganizationSchema,
        ),
      ).rejects.toThrow(
        "resource not found: organization where spec.description=none",
      );
    });

    it("findAllByField preserves the Go quirk: ALL rows of the kind, unfiltered (DD-001)", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ id: "acme" }),
      );
      await fx.store.saveResource(
        KIND,
        "beta",
        OrganizationSchema,
        makeOrganization({ id: "beta", description: "only-this-one" }),
      );

      const rows = await fx.store.findAllByField(
        KIND,
        "spec.description",
        "only-this-one",
      );
      // Two rows despite the predicate matching one — the caller filters,
      // exactly as every Go call site did.
      expect(rows).toHaveLength(2);
    });

    it("findAllByLabel matches metadata.labels entries", async () => {
      await fx.store.saveResource(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({
          id: "acme",
          labels: { "stigmer.ai/system": "true" },
        }),
      );
      await fx.store.saveResource(
        KIND,
        "beta",
        OrganizationSchema,
        makeOrganization({
          id: "beta",
          labels: { "stigmer.ai/system": "false" },
        }),
      );

      const matches = await fx.store.findAllByLabel(
        KIND,
        "stigmer.ai/system",
        "true",
        OrganizationSchema,
      );
      expect(matches).toHaveLength(1);
    });
  });

  describe("audit operations", () => {
    it("archives snapshots and lists them newest first with authoritative tags", async () => {
      const org = makeOrganization();
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-1",
        "",
      );
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-2",
        "latest",
      );

      const records = await fx.store.listAuditRecords(KIND, "acme");
      expect(records.map((record) => record.versionHash)).toEqual([
        "hash-2",
        "hash-1",
      ]);
      expect(records[0]!.tag).toBe("latest");

      expect(await fx.store.countAuditEntries(KIND, "acme")).toBe(2);
      // Same-timestamp inserts: the recency tiebreak keeps "latest" stable.
      expect(await fx.store.getLatestAuditHash(KIND, "acme")).toBe("hash-2");
    });

    it("getAuditByHash / getAuditByTag round-trip the snapshot", async () => {
      const org = makeOrganization({ description: "snapshotted" });
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-1",
        "stable",
      );

      const byHash = await fx.store.getAuditByHash(
        KIND,
        "acme",
        "hash-1",
        OrganizationSchema,
      );
      expect(byHash.spec?.description).toBe("snapshotted");

      const byTag = await fx.store.getAuditByTag(
        KIND,
        "acme",
        "stable",
        OrganizationSchema,
      );
      expect(byTag.spec?.description).toBe("snapshotted");
    });

    it("audit lookups throw AuditNotFoundError when absent", async () => {
      await expect(
        fx.store.getAuditRecordByHash(KIND, "acme", "nope"),
      ).rejects.toThrow(AuditNotFoundError);
      await expect(
        fx.store.getAuditRecordByTag(KIND, "acme", "nope"),
      ).rejects.toThrow(AuditNotFoundError);
      await expect(fx.store.getLatestAuditHash(KIND, "acme")).rejects.toThrow(
        AuditNotFoundError,
      );
      expect(await fx.store.countAuditEntries(KIND, "acme")).toBe(0);
      expect(await fx.store.listAuditRecords(KIND, "acme")).toEqual([]);
    });

    it("setAuditTag moves the tag atomically — single holder (#341)", async () => {
      const org = makeOrganization();
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-1",
        "stable",
      );
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-2",
        "",
      );

      await fx.store.setAuditTag(KIND, "acme", "hash-2", "stable");

      const records = await fx.store.listAuditRecords(KIND, "acme");
      const byHash = new Map(
        records.map((record) => [record.versionHash, record.tag]),
      );
      expect(byHash.get("hash-2")).toBe("stable");
      expect(byHash.get("hash-1"), "the prior holder is cleared").toBe("");
    });

    it("setAuditTag with a missing target rolls back — the prior holder keeps the tag", async () => {
      const org = makeOrganization();
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-1",
        "stable",
      );

      await expect(
        fx.store.setAuditTag(KIND, "acme", "missing-hash", "stable"),
      ).rejects.toThrow(AuditNotFoundError);

      const record = await fx.store.getAuditRecordByTag(KIND, "acme", "stable");
      expect(record.versionHash, "a missing target never orphans the tag").toBe(
        "hash-1",
      );
    });

    it("duplicate rows for one hash are legal — newest wins (stigmer-cloud#191)", async () => {
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ description: "older" }),
        "hash-x",
        "",
      );
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        makeOrganization({ description: "newer" }),
        "hash-x",
        "",
      );

      const record = await fx.store.getAuditByHash(
        KIND,
        "acme",
        "hash-x",
        OrganizationSchema,
      );
      expect(record.spec?.description).toBe("newer");
    });

    it("deleteAuditByResourceId removes the resource's records and reports the count", async () => {
      const org = makeOrganization();
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-1",
        "",
      );
      await fx.store.saveAudit(
        KIND,
        "acme",
        OrganizationSchema,
        org,
        "hash-2",
        "",
      );
      expect(await fx.store.deleteAuditByResourceId(KIND, "acme")).toBe(2);
      expect(await fx.store.countAuditEntries(KIND, "acme")).toBe(0);
    });
  });

  describe("workflow execution events", () => {
    it("append is insert-or-skip, first-writer-wins (oss#308 contract)", async () => {
      expect(
        await fx.store.appendWorkflowExecutionEvents("wfe_1", [
          event(1),
          event(2),
        ]),
      ).toBe(2);
      // A retried batch re-sends the same sequence numbers: idempotent
      // no-op for the duplicates, the new event still lands.
      expect(
        await fx.store.appendWorkflowExecutionEvents("wfe_1", [
          event(1),
          event(3),
        ]),
      ).toBe(1);
      expect(await fx.store.getMaxEventSequence("wfe_1")).toBe(3);
    });

    it("paginates by cursor with type and task filters", async () => {
      await fx.store.appendWorkflowExecutionEvents("wfe_1", [
        event(1, "task_started", "step-a"),
        event(2, "task_completed", "step-a"),
        event(3, "task_started", "step-b"),
      ]);

      const afterFirst = await fx.store.getWorkflowExecutionEvents(
        "wfe_1",
        1,
        "",
        "",
        0,
      );
      expect(afterFirst.map((row) => row.sequenceNumber)).toEqual([2, 3]);

      const started = await fx.store.getWorkflowExecutionEvents(
        "wfe_1",
        0,
        "task_started",
        "",
        0,
      );
      expect(started.map((row) => row.sequenceNumber)).toEqual([1, 3]);

      const stepA = await fx.store.getWorkflowExecutionEvents(
        "wfe_1",
        0,
        "",
        "step-a",
        0,
      );
      expect(stepA.map((row) => row.sequenceNumber)).toEqual([1, 2]);

      const limited = await fx.store.getWorkflowExecutionEvents(
        "wfe_1",
        0,
        "",
        "",
        2,
      );
      expect(limited).toHaveLength(2);
    });

    it("round-trips event payload bytes and stamps createdAt", async () => {
      await fx.store.appendWorkflowExecutionEvents("wfe_1", [event(7)]);
      const rows = await fx.store.getWorkflowExecutionEvents(
        "wfe_1",
        0,
        "",
        "",
        0,
      );
      expect(rows).toHaveLength(1);
      expect(Array.from(rows[0]!.data)).toEqual([7]);
      expect(rows[0]!.createdAt).not.toBe("");
    });

    it("empty batches and unknown executions are calm no-ops", async () => {
      expect(await fx.store.appendWorkflowExecutionEvents("wfe_1", [])).toBe(0);
      expect(await fx.store.getMaxEventSequence("ghost")).toBe(0);
      expect(
        await fx.store.getWorkflowExecutionEvents("ghost", 0, "", "", 0),
      ).toEqual([]);
    });
  });

  describe("schedule run ledger", () => {
    const baseRun = {
      scheduleId: "sch_1",
      org: "acme",
      nominalFireTime: "2026-08-20T00:00:00Z",
      origin: "cron",
      outcome: "started",
      reason: "",
      executionId: "",
      recordedAt: "2026-08-20T00:00:01Z",
      completedAt: "",
    };

    it("upsert converges retried writes onto the fire-identity row", async () => {
      await fx.store.upsertScheduleRun(baseRun);
      await fx.store.upsertScheduleRun({
        ...baseRun,
        outcome: "completed",
        completedAt: "2026-08-20T00:00:05Z",
      });

      const { runs, total } = await fx.store.listScheduleRuns("sch_1", 0, 0);
      expect(total).toBe(1);
      expect(runs[0]!.outcome).toBe("completed");
    });

    it("terminal rows are never downgraded by a replayed 'started' write", async () => {
      await fx.store.upsertScheduleRun({
        ...baseRun,
        outcome: "completed",
        completedAt: "2026-08-20T00:00:05Z",
      });
      await fx.store.upsertScheduleRun(baseRun); // the replay

      const { runs } = await fx.store.listScheduleRuns("sch_1", 0, 0);
      expect(runs[0]!.outcome, "the verdict survives the replay").toBe(
        "completed",
      );
      expect(runs[0]!.completedAt).toBe("2026-08-20T00:00:05Z");
    });

    it("markLatestScheduleRunTerminal stamps the newest non-terminal row of that origin only", async () => {
      await fx.store.upsertScheduleRun(baseRun);
      // A newer MANUAL fire must not steal the cron run's verdict — the
      // origin filter is load-bearing (see the interface doc).
      await fx.store.upsertScheduleRun({
        ...baseRun,
        nominalFireTime: "2026-08-20T00:05:00Z",
        origin: "manual",
      });

      await fx.store.markLatestScheduleRunTerminal(
        "sch_1",
        "cron",
        "failed",
        "boom",
        "2026-08-20T00:01:00Z",
      );

      const { runs } = await fx.store.listScheduleRuns("sch_1", 0, 0);
      const cron = runs.find((run) => run.origin === "cron")!;
      const manual = runs.find((run) => run.origin === "manual")!;
      expect(cron.outcome).toBe("failed");
      expect(cron.reason).toBe("boom");
      expect(manual.outcome, "the manual row is untouched").toBe("started");
    });

    it("marking with no non-terminal row is a silent no-op", async () => {
      await expect(
        fx.store.markLatestScheduleRunTerminal(
          "sch_ghost",
          "cron",
          "failed",
          "",
          "t",
        ),
      ).resolves.toBeUndefined();
    });

    it("lists newest first with pagination totals; prune and delete report counts", async () => {
      for (const minute of ["00", "01", "02"]) {
        await fx.store.upsertScheduleRun({
          ...baseRun,
          nominalFireTime: `2026-08-20T00:${minute}:00Z`,
          recordedAt: `2026-08-20T00:${minute}:01Z`,
        });
      }

      const page = await fx.store.listScheduleRuns("sch_1", 0, 2);
      expect(page.total).toBe(3);
      expect(page.runs.map((run) => run.nominalFireTime)).toEqual([
        "2026-08-20T00:02:00Z",
        "2026-08-20T00:01:00Z",
      ]);

      expect(await fx.store.pruneScheduleRuns("2026-08-20T00:01:00Z")).toBe(1);
      expect(await fx.store.deleteScheduleRunsBySchedule("sch_1")).toBe(2);
    });
  });

  describe("search index (DD-009 engine-neutral read semantics)", () => {
    function entry(overrides: Partial<SearchIndexEntry>): SearchIndexEntry {
      return {
        name: "unnamed",
        description: "",
        tags: "",
        org: "acme",
        visibility: "visibility_private",
        createdAt: 1_700_000_000,
        ...overrides,
      };
    }

    it("search mode returns matching hits with wire-ready scores (0–1, higher = better)", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-1",
        entry({ name: "kubernetes helper", createdAt: 1_700_000_001 }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-2",
        entry({ name: "unrelated thing", createdAt: 1_700_000_002 }),
      );

      const result = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });

      expect(result.totalCount).toBe(1);
      expect(result.countsByKind).toEqual({ agent: 1 });
      expect(result.hits).toHaveLength(1);
      expect(result.hits[0]?.resourceId).toBe("agt-1");
      expect(result.hits[0]?.score).toBeGreaterThan(0);
      expect(result.hits[0]?.score).toBeLessThanOrEqual(1);
    });

    it("a single term is a prefix match; multiple terms compose with AND", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-1",
        entry({ name: "kubernetes deployment helper" }),
      );

      const prefix = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kuber"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(prefix.totalCount).toBe(1);

      const bothMatch = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes", "deployment"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(bothMatch.totalCount).toBe(1);

      const oneMisses = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes", "absent"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(oneMisses.totalCount).toBe(0);
      expect(oneMisses.hits).toEqual([]);
    });

    it("hostile query-operator content matches as literal text, never as engine syntax", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-1",
        entry({ name: "plain agent" }),
      );

      // Engine operator vocabulary as a term must not blow up the query or
      // match everything — both engines quote terms into literal tokens.
      // "NEAR" (an FTS5 operator, not an English stopword) keeps this arm
      // engine-safe: Postgres's 'english' config DROPS stopwords like
      // "not"/"and" from queries where FTS5 keeps them — a declared
      // tokenization divergence (DD-009), so no stopword may carry a
      // cross-driver membership assertion.
      const result = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["NEAR", "plain"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      // "NEAR" is a literal token absent from the document → AND misses.
      expect(result.totalCount).toBe(0);
    });

    it("authorizedIdsByKind narrows per kind; an empty set matches nothing; absent kinds stay unrestricted (20260830.01)", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-mine",
        entry({ name: "scoped alpha" }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-foreign",
        entry({ name: "scoped beta" }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.workflow,
        "wfl-any",
        entry({ name: "scoped gamma" }),
      );

      // agent narrowed to one id; workflow ABSENT from the map = unrestricted.
      const narrowed = await fx.store.querySearchIndex({
        kinds: ["agent", "workflow"],
        terms: ["scoped"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        authorizedIdsByKind: new Map([["agent", new Set(["agt-mine"])]]),
        limit: 20,
        offset: 0,
      });
      expect(narrowed.countsByKind).toEqual({ agent: 1, workflow: 1 });
      expect(
        narrowed.hits.map((hit) => hit.resourceId).sort(),
      ).toEqual(["agt-mine", "wfl-any"]);

      // An EMPTY set for a kind matches nothing for that kind.
      const emptyKind = await fx.store.querySearchIndex({
        kinds: ["agent", "workflow"],
        terms: ["scoped"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        authorizedIdsByKind: new Map([
          ["agent", new Set<string>()],
          ["workflow", new Set(["wfl-any"])],
        ]),
        limit: 20,
        offset: 0,
      });
      expect(emptyKind.countsByKind).toEqual({ workflow: 1 });

      // ALL kinds empty = nothing, and the driver must not emit IN ().
      const allEmpty = await fx.store.querySearchIndex({
        kinds: ["agent", "workflow"],
        terms: ["scoped"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        authorizedIdsByKind: new Map([
          ["agent", new Set<string>()],
          ["workflow", new Set<string>()],
        ]),
        limit: 20,
        offset: 0,
      });
      expect(allEmpty.totalCount).toBe(0);
      expect(allEmpty.hits).toEqual([]);

      // Undefined = the unscoped read, byte-identical.
      const unscoped = await fx.store.querySearchIndex({
        kinds: ["agent", "workflow"],
        terms: ["scoped"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(unscoped.totalCount).toBe(3);
    });

    it("org scoping: strict filter, cross-org public widening, and the public subtraction", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-mine",
        entry({ name: "searchable alpha", org: "acme" }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-public",
        entry({
          name: "searchable beta",
          org: "globex",
          visibility: "visibility_public",
        }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-foreign",
        entry({ name: "searchable gamma", org: "globex" }),
      );

      const strict = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["searchable"],
        orgFilter: "acme",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(strict.hits.map((hit) => hit.resourceId)).toEqual(["agt-mine"]);

      const widened = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["searchable"],
        orgFilter: "acme",
        crossOrgPublic: true,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(new Set(widened.hits.map((hit) => hit.resourceId))).toEqual(
        new Set(["agt-mine", "agt-public"]),
      );

      const noPublic = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["searchable"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: true,
        limit: 20,
        offset: 0,
      });
      expect(new Set(noPublic.hits.map((hit) => hit.resourceId))).toEqual(
        new Set(["agt-mine", "agt-foreign"]),
      );
    });

    it("list mode (terms undefined) orders newest first with score exactly 1.0", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-old",
        entry({ name: "older", createdAt: 1_700_000_001 }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-new",
        entry({ name: "newer", createdAt: 1_700_000_002 }),
      );

      const result = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: undefined,
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });

      expect(result.hits.map((hit) => hit.resourceId)).toEqual([
        "agt-new",
        "agt-old",
      ]);
      for (const hit of result.hits) {
        expect(hit.score).toBe(1.0);
      }
    });

    it("upsert replaces the indexed document; deleteSearchIndex and clearSearchIndex remove", async () => {
      await fx.store.upsertSearchIndex(
        KIND,
        "acme",
        entry({ name: "original name" }),
      );
      await fx.store.upsertSearchIndex(
        KIND,
        "acme",
        entry({ name: "renamed thing" }),
      );

      const stale = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: ["original"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(stale.totalCount, "the old document is fully replaced").toBe(0);

      const fresh = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: ["renamed"],
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(fresh.totalCount).toBe(1);

      await fx.store.deleteSearchIndex(KIND, "acme");
      const afterDelete = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: undefined,
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(afterDelete.totalCount).toBe(0);

      await fx.store.upsertSearchIndex(
        KIND,
        "acme",
        entry({ name: "back again" }),
      );
      await fx.store.clearSearchIndex();
      const afterClear = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: undefined,
        orgFilter: "",
        crossOrgPublic: false,
        excludePublic: false,
        limit: 20,
        offset: 0,
      });
      expect(afterClear.totalCount).toBe(0);
    });
  });

  describe("bootstrap state", () => {
    it("get returns '' (not an error) for a missing key; set upserts; getAll/delete/clear", async () => {
      expect(await fx.store.bootstrapState.get("missing")).toBe("");

      await fx.store.bootstrapState.set("seedpack_version", "1.0.0");
      await fx.store.bootstrapState.set("seedpack_version", "1.1.0");
      await fx.store.bootstrapState.set("bootstrap_status", "completed");

      expect(await fx.store.bootstrapState.get("seedpack_version")).toBe(
        "1.1.0",
      );
      expect(await fx.store.bootstrapState.getAll()).toEqual(
        new Map([
          ["seedpack_version", "1.1.0"],
          ["bootstrap_status", "completed"],
        ]),
      );

      await fx.store.bootstrapState.delete("bootstrap_status");
      await fx.store.bootstrapState.delete("bootstrap_status"); // absent → no error
      expect(await fx.store.bootstrapState.get("bootstrap_status")).toBe("");

      await fx.store.bootstrapState.clear();
      expect(await fx.store.bootstrapState.getAll()).toEqual(new Map());
    });
  });

  describe("signal dedupe (two-phase hold)", () => {
    it("claims a fresh key, reports the holder on a duplicate claim", async () => {
      const first = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(first.status).toBe("SUCCESS");
      expect(first.record).toBeUndefined();

      const second = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_2",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(second.status).toBe("DUPLICATE");
      // The caller branches on the HOLDER's state: CLAIMED = in-flight
      // conflict, DELIVERED = true duplicate.
      expect(second.record?.status).toBe("CLAIMED");
      expect(second.record?.executionId).toBe("wfe_1");
    });

    it("keys are org-scoped: the same idempotency key in another org claims freely", async () => {
      await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      const other = await fx.store.signalDedupe.claim(
        "globex",
        "key-1",
        "wfe_9",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(other.status).toBe("SUCCESS");
    });

    it("markDelivered flips the status and extends the hold to the 24h window", async () => {
      await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      await fx.store.signalDedupe.markDelivered("acme", "key-1");

      const dup = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_2",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(dup.status).toBe("DUPLICATE");
      expect(dup.record?.status).toBe("DELIVERED");
      expect(dup.record?.deliveredAt).not.toBe("");
      // Delivery EARNS the long window: expiry moved past the in-flight TTL.
      const expiry = Date.parse(dup.record!.expiresAt);
      expect(expiry).toBeGreaterThan(Date.now() + IN_FLIGHT_CLAIM_TTL_MS);
    });

    it("markDelivered on a missing or already-delivered key is a tolerant no-op", async () => {
      await expect(
        fx.store.signalDedupe.markDelivered("acme", "ghost"),
      ).resolves.toBeUndefined();
      await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      await fx.store.signalDedupe.markDelivered("acme", "key-1");
      await expect(
        fx.store.signalDedupe.markDelivered("acme", "key-1"),
      ).resolves.toBeUndefined();
    });

    it("release frees a CLAIMED key immediately but never a DELIVERED one", async () => {
      await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      await fx.store.signalDedupe.release("acme", "key-1");
      const reclaimed = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_2",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(reclaimed.status, "a released key is claimable at once").toBe(
        "SUCCESS",
      );

      await fx.store.signalDedupe.markDelivered("acme", "key-1");
      await fx.store.signalDedupe.release("acme", "key-1"); // guarded no-op
      const stillBlocked = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_3",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(
        stillBlocked.status,
        "a delivered key survives a misplaced release",
      ).toBe("DUPLICATE");
    });

    it("an expired hold self-heals: the next claim cleans it up and wins", async () => {
      // Crash recovery path: a claim whose delivery died holds only the
      // short TTL. Simulate the lapse by aging the row directly.
      await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_1",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      await fx.forceDedupeExpiry(
        "acme:key-1",
        new Date(Date.now() - 1000).toISOString(),
      );

      const reclaimed = await fx.store.signalDedupe.claim(
        "acme",
        "key-1",
        "wfe_2",
        "resume",
        IN_FLIGHT_CLAIM_TTL_MS,
      );
      expect(reclaimed.status).toBe("SUCCESS");
    });
  });

  describe("oauth grants", () => {
    const grant: OAuthGrant = {
      identityAccountId: "ida_1",
      resourceId: "mcp_1",
      resourceKind: "mcp_server",
      orgId: "acme",
      accessTokenExpiresAt: 1755648000,
      clientId: "client-1",
      authMethod: "mcp_oauth",
      tokenEndpoint: "https://example.test/token",
      accessTokenEnvVar: "TOKEN",
      refreshTokenEnvVar: "REFRESH",
      environmentId: "env_1",
      createdAt: 0,
      updatedAt: 0,
    };

    it("upsert stamps createdAt on first insert and refreshes updatedAt on replace", async () => {
      await fx.store.oauthGrants.upsert(grant);
      const first = await fx.store.oauthGrants.find("ida_1", "mcp_1", "acme");
      expect(first).toBeDefined();
      expect(first!.createdAt).toBeGreaterThan(0);

      await fx.store.oauthGrants.upsert({ ...grant, clientId: "client-2" });
      const second = await fx.store.oauthGrants.find("ida_1", "mcp_1", "acme");
      expect(second!.clientId).toBe("client-2");
      expect(second!.createdAt, "createdAt survives the upsert").toBe(
        first!.createdAt,
      );
    });

    it("find returns undefined (not an error) when absent; delete removes by composite key", async () => {
      expect(
        await fx.store.oauthGrants.find("ida_x", "mcp_x", "acme"),
      ).toBeUndefined();

      await fx.store.oauthGrants.upsert(grant);
      await fx.store.oauthGrants.delete("ida_1", "mcp_1", "acme");
      expect(
        await fx.store.oauthGrants.find("ida_1", "mcp_1", "acme"),
      ).toBeUndefined();
    });

    it("deleteByResourceId sweeps every identity's grants for the resource and no others", async () => {
      // Two identities granted the same resource (re-install by a second
      // caller leaves one row per identity — the sweep must take both),
      // plus one grant on a different resource that must survive.
      await fx.store.oauthGrants.upsert(grant);
      await fx.store.oauthGrants.upsert({
        ...grant,
        identityAccountId: "ida_2",
      });
      await fx.store.oauthGrants.upsert({ ...grant, resourceId: "mcp_other" });

      const swept = await fx.store.oauthGrants.deleteByResourceId(
        "mcp_1",
        "acme",
      );
      expect(swept, "both identities' grants counted").toBe(2);
      expect(
        await fx.store.oauthGrants.find("ida_1", "mcp_1", "acme"),
      ).toBeUndefined();
      expect(
        await fx.store.oauthGrants.find("ida_2", "mcp_1", "acme"),
      ).toBeUndefined();
      expect(
        await fx.store.oauthGrants.find("ida_1", "mcp_other", "acme"),
        "other resources' grants survive",
      ).toBeDefined();

      const rerun = await fx.store.oauthGrants.deleteByResourceId(
        "mcp_1",
        "acme",
      );
      expect(rerun, "idempotent re-sweep answers zero, not an error").toBe(0);
    });
  });

  describe("pending oauth state", () => {
    const state: PendingOAuthState = {
      state: "state-1",
      codeVerifier: "enc:v1:sealed-verifier",
      clientId: "client-1",
      clientSecret: "",
      tokenEndpoint: "https://example.test/token",
      mcpServerId: "mcp_1",
      identityAccountId: "ida_1",
      targetEnvVar: "TOKEN",
      authMethod: "mcp_oauth",
      tokenAuthMethod: "",
      redirectUri: "http://127.0.0.1/cb",
      org: "acme",
      createdAt: 0,
    };

    it("getAndDelete redeems a state exactly once", async () => {
      await fx.store.pendingOAuthStates.save(state);

      const redeemed =
        await fx.store.pendingOAuthStates.getAndDelete("state-1");
      expect(redeemed?.codeVerifier).toBe("enc:v1:sealed-verifier");
      expect(redeemed?.org).toBe("acme");

      const second = await fx.store.pendingOAuthStates.getAndDelete("state-1");
      expect(second, "a state can never be redeemed twice").toBeUndefined();
    });

    it("an expired state is deleted on redemption and returns undefined", async () => {
      await fx.store.pendingOAuthStates.save({
        ...state,
        // Aged past the 10-minute TTL.
        createdAt: Math.floor(Date.now() / 1000) - 11 * 60,
      });

      expect(
        await fx.store.pendingOAuthStates.getAndDelete("state-1"),
      ).toBeUndefined();
      expect(
        await fx.countPendingOAuthStates(),
        "the expired row is gone",
      ).toBe(0);
    });

    it("unknown states return undefined; cleanupExpired reports the count removed", async () => {
      expect(
        await fx.store.pendingOAuthStates.getAndDelete("ghost"),
      ).toBeUndefined();

      await fx.store.pendingOAuthStates.save(state); // fresh
      await fx.store.pendingOAuthStates.save({
        ...state,
        state: "state-old",
        createdAt: Math.floor(Date.now() / 1000) - 11 * 60,
      });

      expect(await fx.store.pendingOAuthStates.cleanupExpired()).toBe(1);
      expect(
        await fx.store.pendingOAuthStates.getAndDelete("state-1"),
      ).toBeDefined();
    });
  });

  describe("lifecycle", () => {
    it("every method fails with 'store is closed' after close; close is idempotent", async () => {
      await fx.store.close();
      await fx.store.close(); // second close is a no-op, as in Go

      await expect(fx.store.listResources(KIND)).rejects.toThrow(
        "store is closed",
      );
      await expect(fx.store.bootstrapState.get("k")).rejects.toThrow(
        "store is closed",
      );
      await expect(fx.store.signalDedupe.release("o", "k")).rejects.toThrow(
        "store is closed",
      );
    });
  });
}
