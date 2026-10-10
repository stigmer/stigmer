/**
 * The driver-agnostic Store contract suite — every behavior a driver must
 * satisfy identically, extracted from the sqlite driver tests when the
 * Postgres driver arrived. Each driver invokes
 * describeStoreContract with its own fixture; the assertions here may only
 * speak the Store interface (plus the two named escape hatches below for
 * arms the interface deliberately cannot express).
 *
 * Covered contracts and their provenance: resource CRUD round-trips,
 * updateResource atomic RMW incl. the no-lost-update guarantee
 * (per-resource atomicity — the parallel-updates assertion is
 * deliberately order-agnostic: sqlite serializes globally, Postgres
 * per-row), findAllByField's filter (the rows whose field equals the
 * value, as stored bytes), audit ordering + the #341 single-holder tag move,
 * the terminal-immutable schedule-run ledger, the engine-neutral search
 * read semantics (token match / single-term prefix / AND; wire-ready 0–1
 * scores; list-mode newest-first at exactly 1.0 — search-mode ranking
 * ORDER is deliberately NOT asserted here, it is driver-relative), the
 * resource-name table (one winner of
 * concurrent claims, lazy expiry, renames that move, take back, revert and
 * overlap to one current name, a name equal to its id reserved for good,
 * a release that frees only its own names), OAuth grants, once-only pending-state
 * redemption with its 10-minute TTL, the organization deletion table (one
 * winner of concurrent marks, transitions that apply only from the phase
 * they name), removal of one organization's side-store records, the
 * closed-store failure mode, and
 * the list index (../list-index.ts): one organization's or one parent's
 * rows newest first, a cursor walk with no gap and no duplicate, rows
 * left out by the keys they hold, keys
 * that follow an update and vanish with a delete, and exactness whoever
 * wrote the row — a row written the way a binary that does not know the
 * index writes it is read from its bytes and repaired, the reconciliation
 * at open leaves nothing unproven, a row written under another revision
 * of a declaration is re-derived, and an undecodable one is skipped.
 *
 * Driver-physical behavior (column layouts, FTS5/tsvector internals,
 * migration chains, the repair's lock ordering) stays in each driver's own
 * tests.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { AuditNotFoundError, ResourceNotFoundError } from "../interface.js";
import type {
  PendingOAuthState,
  SearchIndexEntry,
  Store,
  StoreOpenOptions,
} from "../interface.js";
import { declareListIndex, field, label } from "../list-index.js";
import type { ListIndexRow } from "../list-index.js";
import { makeOrganization } from "./support.js";

/** The kit's own declaration, so the arms do not depend on the server's list. */
export const CONTRACT_SESSION_INDEX = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 1,
  keys: {
    agent: field("status.agent_id"),
    channel: label("stigmer.ai/channel-id"),
  },
});

/** What every contract store opens with. */
export const CONTRACT_STORE_OPTIONS: StoreOpenOptions = {
  listIndexes: [CONTRACT_SESSION_INDEX],
};

/** One fresh, isolated store per test, plus the driver escape hatches. */
export interface StoreContractFixture {
  store: Store;
  /**
   * Writes a resource exactly as a binary that does not know the list
   * index writes it — the row and `updated_at`, nothing else — the way
   * the old pod writes while a roll overlaps it with the new one.
   */
  writeAsOlderBinary(
    kind: ApiResourceKind,
    id: string,
    data: Uint8Array,
  ): Promise<void>;
  /**
   * Counts a kind's rows whose list facts are not proven current under
   * `revision`, as the driver judges it; without a revision (an undeclared
   * kind carries none), its unstamped rows.
   */
  countUnproven(kind: ApiResourceKind, revision?: number): Promise<number>;
  /**
   * Opens a second store over the same database (running its
   * reconciliation at open); the fixture closes it at cleanup.
   */
  openAnother(options: StoreOpenOptions): Promise<Store>;
  /**
   * Counts pending_oauth_state rows directly (the expired-state arm must
   * prove the row is DELETED, not merely unredeemable).
   */
  countPendingOAuthStates(): Promise<number>;
  cleanup(): Promise<void>;
}

const KIND = ApiResourceKind.organization;

/**
 * Every driver passes its fixture factory; the factory opens its store
 * with `CONTRACT_STORE_OPTIONS`.
 */
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

    it("parallel updates to ONE resource both land — no lost update (per-resource atomicity)", async () => {
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

    it("findAllByField returns exactly the rows whose field equals the value, as their stored bytes", async () => {
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
        OrganizationSchema,
      );
      expect(
        rows.map((row) => fromBinary(OrganizationSchema, row).metadata?.id),
      ).toEqual(["beta"]);
      expect(
        await fx.store.findAllByField(
          KIND,
          "spec.description",
          "nobody-carries-this",
          OrganizationSchema,
        ),
        "a value no row carries matches nothing",
      ).toEqual([]);
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

  // The maintenance surface — ports the
  // Java contract shapes (PostgresAgentRepositoryContractTest): keyset
  // paging from "", stale-expectation loses, deleted-row loses.
  describe("maintenance surface: raw ordered scan + bytes-level CAS", () => {
    it('findResourcesRawOrderedAfter pages the whole kind in id order from ""', async () => {
      for (const id of ["raw-b", "raw-a", "raw-c"]) {
        await fx.store.saveResource(
          KIND,
          id,
          OrganizationSchema,
          makeOrganization({ id }),
        );
      }

      const firstPage = await fx.store.findResourcesRawOrderedAfter(
        KIND,
        "",
        2,
      );
      expect(firstPage.map((row) => row.id)).toEqual(["raw-a", "raw-b"]);
      // The bytes are the EXACT stored marshaling — they parse back to the
      // row (the CAS guards on these same bytes).
      const parsed = fromBinary(OrganizationSchema, firstPage[0]!.data);
      expect(parsed.metadata?.id).toBe("raw-a");

      const lastId = firstPage[firstPage.length - 1]!.id;
      const secondPage = await fx.store.findResourcesRawOrderedAfter(
        KIND,
        lastId,
        2,
      );
      expect(secondPage.map((row) => row.id)).toEqual(["raw-c"]);

      await expect(
        fx.store.findResourcesRawOrderedAfter(KIND, "", 0),
      ).rejects.toThrow("limit must be positive");
    });

    it("replaceResourceDataIfUnchanged applies against the read bytes and loses to any interleaved write", async () => {
      await fx.store.saveResource(
        KIND,
        "cas",
        OrganizationSchema,
        makeOrganization({ id: "cas" }),
      );
      const read = (
        await fx.store.findResourcesRawOrderedAfter(KIND, "", 1)
      )[0]!;
      const transformed = makeOrganization({
        id: "cas",
        description: "transformed",
      });

      expect(
        await fx.store.replaceResourceDataIfUnchanged(
          KIND,
          "cas",
          read.data,
          toBinary(OrganizationSchema, transformed),
        ),
      ).toBe(true);
      const loaded = await fx.store.getResource(
        KIND,
        "cas",
        OrganizationSchema,
      );
      expect(loaded.spec?.description).toBe("transformed");

      // The same expectation is now stale — the document changed under it,
      // so a second swap against the old bytes must lose, row untouched.
      const clobber = makeOrganization({
        id: "cas",
        description: "would-clobber",
      });
      expect(
        await fx.store.replaceResourceDataIfUnchanged(
          KIND,
          "cas",
          read.data,
          toBinary(OrganizationSchema, clobber),
        ),
      ).toBe(false);
      const untouched = await fx.store.getResource(
        KIND,
        "cas",
        OrganizationSchema,
      );
      expect(untouched.spec?.description).toBe("transformed");

      // A deleted row is a lost swap, never an upsert.
      await fx.store.deleteResource(KIND, "cas");
      expect(
        await fx.store.replaceResourceDataIfUnchanged(
          KIND,
          "cas",
          read.data,
          toBinary(OrganizationSchema, clobber),
        ),
      ).toBe(false);
      expect(await fx.store.listResources(KIND)).toHaveLength(0);
    });

    it("concurrent request-path writers win: a save between read and swap defeats the CAS", async () => {
      await fx.store.saveResource(
        KIND,
        "race",
        OrganizationSchema,
        makeOrganization({ id: "race" }),
      );
      const read = (
        await fx.store.findResourcesRawOrderedAfter(KIND, "", 1)
      )[0]!;

      // The interleaved writer (a normal request-path upsert).
      await fx.store.saveResource(
        KIND,
        "race",
        OrganizationSchema,
        makeOrganization({ id: "race", description: "writer wins" }),
      );

      expect(
        await fx.store.replaceResourceDataIfUnchanged(
          KIND,
          "race",
          read.data,
          toBinary(
            OrganizationSchema,
            makeOrganization({ id: "race", description: "sweep loses" }),
          ),
        ),
      ).toBe(false);
      const kept = await fx.store.getResource(KIND, "race", OrganizationSchema);
      expect(kept.spec?.description).toBe("writer wins");
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

    it("duplicate rows for one hash are legal — newest wins", async () => {
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
      await fx.store.upsertScheduleFire(baseRun);
      await fx.store.upsertScheduleFire({
        ...baseRun,
        outcome: "completed",
        completedAt: "2026-08-20T00:00:05Z",
      });

      const { fires: runs, total } = await fx.store.listScheduleFires("sch_1", 0, 0);
      expect(total).toBe(1);
      expect(runs[0]!.outcome).toBe("completed");
    });

    it("terminal rows are never downgraded by a replayed 'started' write", async () => {
      await fx.store.upsertScheduleFire({
        ...baseRun,
        outcome: "completed",
        completedAt: "2026-08-20T00:00:05Z",
      });
      await fx.store.upsertScheduleFire(baseRun); // the replay

      const { fires: runs } = await fx.store.listScheduleFires("sch_1", 0, 0);
      expect(runs[0]!.outcome, "the verdict survives the replay").toBe(
        "completed",
      );
      expect(runs[0]!.completedAt).toBe("2026-08-20T00:00:05Z");
    });

    it("markLatestScheduleFireTerminal stamps the newest non-terminal row of that origin only", async () => {
      await fx.store.upsertScheduleFire(baseRun);
      // A newer MANUAL fire must not steal the cron run's verdict — the
      // origin filter is load-bearing (see the interface doc).
      await fx.store.upsertScheduleFire({
        ...baseRun,
        nominalFireTime: "2026-08-20T00:05:00Z",
        origin: "manual",
      });

      await fx.store.markLatestScheduleFireTerminal(
        "sch_1",
        "cron",
        "failed",
        "boom",
        "2026-08-20T00:01:00Z",
      );

      const { fires: runs } = await fx.store.listScheduleFires("sch_1", 0, 0);
      const cron = runs.find((run) => run.origin === "cron")!;
      const manual = runs.find((run) => run.origin === "manual")!;
      expect(cron.outcome).toBe("failed");
      expect(cron.reason).toBe("boom");
      expect(manual.outcome, "the manual row is untouched").toBe("started");
    });

    it("marking with no non-terminal row is a silent no-op", async () => {
      await expect(
        fx.store.markLatestScheduleFireTerminal(
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
        await fx.store.upsertScheduleFire({
          ...baseRun,
          nominalFireTime: `2026-08-20T00:${minute}:00Z`,
          recordedAt: `2026-08-20T00:${minute}:01Z`,
        });
      }

      const page = await fx.store.listScheduleFires("sch_1", 0, 2);
      expect(page.total).toBe(3);
      expect(page.fires.map((run) => run.nominalFireTime)).toEqual([
        "2026-08-20T00:02:00Z",
        "2026-08-20T00:01:00Z",
      ]);

      expect(await fx.store.pruneScheduleFires("2026-08-20T00:01:00Z")).toBe(1);
      expect(await fx.store.deleteScheduleFiresBySchedule("sch_1")).toBe(2);
    });
  });

  describe("search index (engine-neutral read semantics)", () => {
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
        limit: 20,
        offset: 0,
      });
      expect(prefix.totalCount).toBe(1);

      const bothMatch = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes", "deployment"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      expect(bothMatch.totalCount).toBe(1);

      const oneMisses = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes", "absent"],
        orgFilter: "",
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
      // tokenization divergence, so no stopword may carry a
      // cross-driver membership assertion.
      const result = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["NEAR", "plain"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      // "NEAR" is a literal token absent from the document → AND misses.
      expect(result.totalCount).toBe(0);
    });

    it("authorizedIdsByKind narrows per kind; an empty set matches nothing; absent kinds stay unrestricted", async () => {
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
        ApiResourceKind.skill,
        "skl-any",
        entry({ name: "scoped gamma" }),
      );

      // agent narrowed to one id; skill ABSENT from the map = unrestricted.
      const narrowed = await fx.store.querySearchIndex({
        kinds: ["agent", "skill"],
        terms: ["scoped"],
        orgFilter: "",
        authorizedIdsByKind: new Map([["agent", new Set(["agt-mine"])]]),
        limit: 20,
        offset: 0,
      });
      expect(narrowed.countsByKind).toEqual({ agent: 1, skill: 1 });
      expect(narrowed.hits.map((hit) => hit.resourceId).sort()).toEqual([
        "agt-mine",
        "skl-any",
      ]);

      // An EMPTY set for a kind matches nothing for that kind.
      const emptyKind = await fx.store.querySearchIndex({
        kinds: ["agent", "skill"],
        terms: ["scoped"],
        orgFilter: "",
        authorizedIdsByKind: new Map([
          ["agent", new Set<string>()],
          ["skill", new Set(["skl-any"])],
        ]),
        limit: 20,
        offset: 0,
      });
      expect(emptyKind.countsByKind).toEqual({ skill: 1 });

      // ALL kinds empty = nothing, and the driver must not emit IN ().
      const allEmpty = await fx.store.querySearchIndex({
        kinds: ["agent", "skill"],
        terms: ["scoped"],
        orgFilter: "",
        authorizedIdsByKind: new Map([
          ["agent", new Set<string>()],
          ["skill", new Set<string>()],
        ]),
        limit: 20,
        offset: 0,
      });
      expect(allEmpty.totalCount).toBe(0);
      expect(allEmpty.hits).toEqual([]);

      // Undefined = the unscoped read, byte-identical.
      const unscoped = await fx.store.querySearchIndex({
        kinds: ["agent", "skill"],
        terms: ["scoped"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      expect(unscoped.totalCount).toBe(3);
    });

    it("org scoping is strict: the visibility column never widens or narrows the org filter", async () => {
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-mine",
        entry({ name: "searchable alpha", org: "acme" }),
      );
      await fx.store.upsertSearchIndex(
        ApiResourceKind.agent,
        "agt-shared",
        entry({
          name: "searchable beta",
          org: "globex",
          visibility: "visibility_child_orgs",
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
        limit: 20,
        offset: 0,
      });
      expect(strict.hits.map((hit) => hit.resourceId)).toEqual(["agt-mine"]);

      const unscoped = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["searchable"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      expect(new Set(unscoped.hits.map((hit) => hit.resourceId))).toEqual(
        new Set(["agt-mine", "agt-shared", "agt-foreign"]),
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
        limit: 20,
        offset: 0,
      });
      expect(stale.totalCount, "the old document is fully replaced").toBe(0);

      const fresh = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: ["renamed"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      expect(fresh.totalCount).toBe(1);

      await fx.store.deleteSearchIndex(KIND, "acme");
      const afterDelete = await fx.store.querySearchIndex({
        kinds: ["organization"],
        terms: undefined,
        orgFilter: "",
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

  describe("resource names", () => {
    const ORG = { kind: "organization", org: "" } as const;
    const key = (name: string) => ({ ...ORG, name });
    const T0 = "2026-01-01T00:00:00.000Z";
    const T1 = "2026-01-02T00:00:00.000Z";
    const T2 = "2026-01-03T00:00:00.000Z";
    const T3 = "2026-01-04T00:00:00.000Z";
    const names = () => fx.store.resourceNames;

    it("claims a free name once; a second claim loses to the entry that holds it", async () => {
      expect(await names().resolve(key("acme"), T0)).toBeUndefined();

      const first = await names().claim(key("acme"), "org_a", T0);
      expect(first.claimed).toBe(true);
      expect(first.entry).toEqual({
        ...key("acme"),
        id: "org_a",
        state: "current",
        claimedAt: T0,
        expiresAt: "",
      });

      const second = await names().claim(key("acme"), "org_b", T1);
      expect(second.claimed).toBe(false);
      expect(second.entry).toEqual(first.entry);
      expect(await names().resolve(key("acme"), T1)).toEqual(first.entry);
    });

    it("of concurrent claims of one name, exactly one wins", async () => {
      const claims = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          names().claim(key("contended"), `org_${i}`, T0),
        ),
      );
      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      const winner = claims.find((claim) => claim.claimed)!;
      for (const loser of claims.filter((claim) => !claim.claimed)) {
        expect(loser.entry).toEqual(winner.entry);
      }
    });

    it("a name is unique within its kind and scope only", async () => {
      expect((await names().claim(key("acme"), "org_a", T0)).claimed).toBe(true);
      expect(
        (await names().claim({ kind: "organization", org: "org_a", name: "acme" }, "x_1", T0)).claimed,
      ).toBe(true);
      expect(
        (await names().claim({ kind: "agent", org: "", name: "acme" }, "agt_1", T0)).claimed,
      ).toBe(true);
    });

    it("a rename makes the new name current and leaves the old one resolving until it expires, then free", async () => {
      await names().claim(key("acme"), "org_a", T0);
      const moved = await names().rename({
        ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T2, now: T1,
      });
      expect(moved.claimed).toBe(true);
      expect(moved.entry).toMatchObject({ name: "acme-corp", id: "org_a", state: "current", expiresAt: "" });

      expect(await names().resolve(key("acme"), T1)).toMatchObject({
        id: "org_a", state: "previous", expiresAt: T2,
      });
      const held = await names().claim(key("acme"), "org_b", T1);
      expect(held.claimed, "nobody else takes a previous name before it expires").toBe(false);
      expect(held.entry.id).toBe("org_a");

      expect(await names().resolve(key("acme"), T2), "expired at its time").toBeUndefined();
      const taken = await names().claim(key("acme"), "org_b", T3);
      expect(taken.claimed, "an expired name is taken by the next claim").toBe(true);
      expect(await names().resolve(key("acme"), T3)).toMatchObject({ id: "org_b", state: "current" });
      expect(await names().resolve(key("acme-corp"), T3)).toMatchObject({ id: "org_a" });
    });

    it("a rename onto another's name loses and changes nothing; onto its own previous name takes it back", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await names().claim(key("globex"), "org_b", T0);
      const lost = await names().rename({
        ...ORG, id: "org_a", from: "acme", to: "globex", fromExpiresAt: T3, now: T1,
      });
      expect(lost.claimed).toBe(false);
      expect(lost.entry).toMatchObject({ name: "globex", id: "org_b" });
      expect(await names().resolve(key("acme"), T1)).toMatchObject({ id: "org_a", state: "current" });

      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 });
      const back = await names().rename({
        ...ORG, id: "org_a", from: "acme-corp", to: "acme", fromExpiresAt: T3, now: T2,
      });
      expect(back.claimed).toBe(true);
      expect(await names().resolve(key("acme"), T2)).toMatchObject({ id: "org_a", state: "current", expiresAt: "" });
      expect(await names().resolve(key("acme-corp"), T2)).toMatchObject({ id: "org_a", state: "previous" });
    });

    it("an old name with no expiry is held for good", async () => {
      await names().claim(key("older"), "older", T0);
      await names().rename({ ...ORG, id: "older", from: "older", to: "newer", fromExpiresAt: "", now: T1 });
      expect(await names().resolve(key("older"), "2999-01-01T00:00:00.000Z")).toMatchObject({
        id: "older", state: "previous", expiresAt: "",
      });
      expect((await names().claim(key("older"), "org_b", "2999-01-01T00:00:00.000Z")).claimed).toBe(false);
    });

    it("a name equal to its id is held for good, whatever expiry the rename gives", async () => {
      await names().claim(key("legacy"), "legacy", T0);
      await names().rename({ ...ORG, id: "legacy", from: "legacy", to: "renamed", fromExpiresAt: T2, now: T1 });
      expect(await names().resolve(key("legacy"), "2999-01-01T00:00:00.000Z")).toMatchObject({
        id: "legacy", state: "previous", expiresAt: "",
      });

      // Renamed again, the name it moved to expires as any other.
      await names().rename({ ...ORG, id: "legacy", from: "renamed", to: "again", fromExpiresAt: T2, now: T1 });
      expect(await names().resolve(key("renamed"), T1)).toMatchObject({ state: "previous", expiresAt: T2 });
      expect(await names().resolve(key("legacy"), "2999-01-01T00:00:00.000Z")).toMatchObject({ expiresAt: "" });
    });

    it("two renames from one name leave exactly one current name, the later one's", async () => {
      await names().claim(key("acme"), "org_a", T0);
      // Both renames read `acme` as the current name; the second runs after
      // the first has moved it.
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-b", fromExpiresAt: T2, now: T1 });
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-c", fromExpiresAt: T2, now: T1 });

      const states = await Promise.all(
        ["acme", "acme-b", "acme-c"].map(async (name) => (await names().resolve(key(name), T1))?.state),
      );
      expect(states).toEqual(["previous", "previous", "current"]);
      expect(await names().resolve(key("acme-b"), T2), "the overtaken name expires").toBeUndefined();
    });

    it("overlapping renames of one resource leave exactly one current name", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await Promise.all(
        ["acme-b", "acme-c", "acme-d", "acme-e"].map((to) =>
          names().rename({ ...ORG, id: "org_a", from: "acme", to, fromExpiresAt: T2, now: T1 }),
        ),
      );
      const states = await Promise.all(
        ["acme", "acme-b", "acme-c", "acme-d", "acme-e"].map(async (name) => (await names().resolve(key(name), T1))?.state),
      );
      expect(states.filter((state) => state === "current")).toHaveLength(1);
    });

    it("a rename onto its own current name is refused", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await expect(
        names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme", fromExpiresAt: T2, now: T1 }),
      ).rejects.toThrow(/both its old and new name/);
      expect(await names().resolve(key("acme"), T1)).toMatchObject({ state: "current" });
    });

    it("revertRename puts the names back, and is idempotent", async () => {
      await names().claim(key("acme"), "org_a", T0);
      const move = { ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 };
      await names().rename(move);
      await names().revertRename(move);
      await names().revertRename(move);
      expect(await names().resolve(key("acme"), T2)).toMatchObject({ id: "org_a", state: "current", expiresAt: "" });
      expect(await names().resolve(key("acme-corp"), T2)).toBeUndefined();
    });

    it("a move back after an overlapping rename leaves the later rename's name the one current name", async () => {
      await names().claim(key("acme"), "org_a", T0);
      const first = { ...ORG, id: "org_a", from: "acme", to: "acme-y", fromExpiresAt: T2, now: T1 };
      await names().rename(first);
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-z", fromExpiresAt: T2, now: T1 });
      // The first rename's row write fails: its names move back.
      await names().revertRename(first);

      expect(await names().resolve(key("acme-y"), T1)).toBeUndefined();
      expect(await names().current("organization", "", "org_a")).toMatchObject({ name: "acme-z" });
      expect(await names().resolve(key("acme"), T1)).toMatchObject({ state: "previous" });
    });

    it("revertRename restores a name the rename took back, as it stood, instead of letting it go", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 });
      const back = { ...ORG, id: "org_a", from: "acme-corp", to: "acme", fromExpiresAt: T3, now: T2 };
      const moved = await names().rename(back);
      expect(moved.claimed).toBe(true);
      const takenBack = moved.claimed ? moved.takenBack : undefined;
      expect(takenBack).toMatchObject({ name: "acme", id: "org_a", state: "previous", expiresAt: T3 });

      await names().revertRename(back, takenBack);
      await names().revertRename(back, takenBack);
      expect(await names().resolve(key("acme-corp"), T2)).toMatchObject({ state: "current", expiresAt: "" });
      expect(await names().resolve(key("acme"), T2)).toMatchObject({ id: "org_a", state: "previous", expiresAt: T3 });
    });

    it("a move back never lets go of a name equal to its id", async () => {
      await names().claim(key("older"), "older", T0);
      await names().rename({ ...ORG, id: "older", from: "older", to: "newer", fromExpiresAt: T2, now: T1 });
      const back = { ...ORG, id: "older", from: "newer", to: "older", fromExpiresAt: T2, now: T1 };
      const moved = await names().rename(back);
      await names().revertRename(back, moved.claimed ? moved.takenBack : undefined);

      expect(await names().resolve(key("older"), "2999-01-01T00:00:00.000Z")).toMatchObject({
        id: "older", state: "previous", expiresAt: "",
      });
      expect((await names().claim(key("older"), "org_b", "2999-01-01T00:00:00.000Z")).claimed).toBe(false);
    });

    it("a rename onto a name taken fresh carries nothing taken back", async () => {
      await names().claim(key("acme"), "org_a", T0);
      const moved = await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 });
      expect(moved.claimed && moved.takenBack).toBeUndefined();
    });

    it("current answers the one current name a resource holds, and nothing once it holds none", async () => {
      expect(await names().current("organization", "", "org_a")).toBeUndefined();
      await names().claim(key("acme"), "org_a", T0);
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 });
      expect(await names().current("organization", "", "org_a")).toMatchObject({ name: "acme-corp", state: "current" });
      await names().release("organization", "", "org_a");
      expect(await names().current("organization", "", "org_a")).toBeUndefined();
    });

    it("release keeps a name equal to the id reserved for good, and lets go of every other", async () => {
      await names().claim(key("older"), "older", T0);
      await names().rename({ ...ORG, id: "older", from: "older", to: "newer", fromExpiresAt: T2, now: T1 });
      await names().release("organization", "", "older");
      await names().release("organization", "", "older");
      expect(await names().resolve(key("newer"), T1)).toBeUndefined();
      expect(await names().resolve(key("older"), "2999-01-01T00:00:00.000Z")).toMatchObject({
        id: "older", state: "previous", expiresAt: "",
      });
      expect((await names().claim(key("older"), "org_b", "2999-01-01T00:00:00.000Z")).claimed).toBe(false);
    });

    it("release lets go of every name one resource holds, and only its", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T3, now: T1 });
      await names().claim(key("globex"), "org_b", T0);
      await names().release("organization", "", "org_a");
      await names().release("organization", "", "org_a");
      expect(await names().resolve(key("acme"), T1)).toBeUndefined();
      expect(await names().resolve(key("acme-corp"), T1)).toBeUndefined();
      expect(await names().resolve(key("globex"), T1)).toMatchObject({ id: "org_b" });
      expect((await names().claim(key("acme"), "org_c", T1)).claimed).toBe(true);
    });

    it("releaseName lets go of one name while its resource holds it, and leaves its other names", async () => {
      const address = (name: string) => ({ kind: "oauth_app_address", org: "org_a", name });
      await names().claim(address("https://a.test/mcp"), "oap_1", T0);
      await names().claim(address("github.com"), "oap_1", T0);
      await names().releaseName(address("https://a.test/mcp"), "oap_2");
      expect(await names().resolve(address("https://a.test/mcp"), T1), "another resource cannot release it").toMatchObject({ id: "oap_1" });
      await names().releaseName(address("https://a.test/mcp"), "oap_1");
      await names().releaseName(address("https://a.test/mcp"), "oap_1");
      expect(await names().resolve(address("https://a.test/mcp"), T1)).toBeUndefined();
      expect(await names().resolve(address("github.com"), T1)).toMatchObject({ id: "oap_1" });
    });

    // The two cases below make the engine refuse a write by binding NULL to
    // a NOT NULL column (the types forbid it, so the value is cast): the one
    // refusal both engines raise on demand. Each proves the write's earlier
    // statements are rolled back with it.

    it("a claim the engine refuses fails, claims nothing, and keeps the expired name it would have cleared", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await names().rename({ ...ORG, id: "org_a", from: "acme", to: "acme-corp", fromExpiresAt: T2, now: T1 });

      // At T3 the claim first clears acme's expired previous name, then its
      // insert is refused.
      await expect(names().claim(key("acme"), null as unknown as string, T3)).rejects.toThrow();

      expect(await names().resolve(key("acme"), T3)).toBeUndefined();
      expect(
        await names().resolve(key("acme"), T1),
        "the clearing rolled back with the refused insert",
      ).toMatchObject({ id: "org_a", state: "previous", expiresAt: T2 });
      expect((await names().claim(key("acme"), "org_b", T3)).claimed).toBe(true);
    });

    it("a rename whose second write the engine refuses moves nothing", async () => {
      await names().claim(key("acme"), "org_a", T0);
      await expect(
        names().rename({
          ...ORG, id: "org_a", from: "acme", to: "acme-corp",
          fromExpiresAt: null as unknown as string, now: T1,
        }),
      ).rejects.toThrow();

      expect(await names().resolve(key("acme-corp"), T1), "the new name stays free").toBeUndefined();
      expect(await names().resolve(key("acme"), T1)).toMatchObject({
        id: "org_a", state: "current", expiresAt: "",
      });
    });
  });

  describe("pending oauth state", () => {
    const state: PendingOAuthState = {
      state: "state-1",
      codeVerifier: "enc:v1:sealed-verifier",
      clientId: "client-1",
      clientSecret: "",
      tokenEndpoint: "https://example.test/token",
      identityAccountId: "ida_1",
      authMethod: "mcp_oauth",
      tokenAuthMethod: "",
      redirectUri: "http://127.0.0.1/cb",
      org: "acme",
      vaultId: "",
      address: "https://mcp.example.test/mcp",
      loginApp: "",
      resource: "",
      clientRegistration: "",
      connectLink: "",
      providerName: "",
      userinfoUrl: "",
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

    it("keeps the vault a sign-in saves into, and \"\" for the signer's My vault", async () => {
      await fx.store.pendingOAuthStates.save({ ...state, vaultId: "vlt_shared" });
      await fx.store.pendingOAuthStates.save({ ...state, state: "state-2" });

      expect(
        (await fx.store.pendingOAuthStates.getAndDelete("state-1"))?.vaultId,
      ).toBe("vlt_shared");
      expect(
        (await fx.store.pendingOAuthStates.getAndDelete("state-2"))?.vaultId,
      ).toBe("");
    });

    it("keeps every field a sign-in records, byte for byte", async () => {
      const recorded: PendingOAuthState = {
        ...state,
        identityAccountId: "",
        address: "https://mcp.example.test/mcp",
        loginApp: "org:oap_1",
        resource: "https://mcp.example.test/mcp",
        clientRegistration: "https://login.example.test",
        connectLink: "link-hash",
        providerName: "Example",
        userinfoUrl: "https://login.example.test/userinfo",
        createdAt: Math.floor(Date.now() / 1000),
      };
      await fx.store.pendingOAuthStates.save(recorded);

      expect(await fx.store.pendingOAuthStates.getAndDelete("state-1")).toEqual(recorded);
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

    it("removes the states a Connect link began, and no other", async () => {
      await fx.store.pendingOAuthStates.save({ ...state, state: "link-1", connectLink: "hash-a" });
      await fx.store.pendingOAuthStates.save({ ...state, state: "link-2", connectLink: "hash-a" });
      await fx.store.pendingOAuthStates.save({ ...state, state: "other-link", connectLink: "hash-b" });
      await fx.store.pendingOAuthStates.save({ ...state, state: "person", connectLink: "" });
      expect(await fx.store.pendingOAuthStates.deleteByConnectLink("hash-a")).toBe(2);
      expect(await fx.store.pendingOAuthStates.getAndDelete("other-link")).toBeDefined();
      expect(await fx.store.pendingOAuthStates.getAndDelete("person")).toBeDefined();
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

  describe("oauth client registrations", () => {
    const NOW = "2026-10-09T10:00:00.000Z";

    it("keeps one client per login server and redirect, the first saved winning", async () => {
      const registrations = fx.store.oauthClientRegistrations;
      expect(await registrations.find("https://login.test", "https://app.test/cb")).toBeUndefined();
      expect(await registrations.save("https://login.test", "https://app.test/cb", "client-1", NOW)).toBe("client-1");
      expect(
        await registrations.save("https://login.test", "https://app.test/cb", "client-2", NOW),
        "a racing registration reads the kept client",
      ).toBe("client-1");
      expect(await registrations.save("https://login.test", "http://127.0.0.1:17237/cb", "client-3", NOW)).toBe("client-3");
      expect(await registrations.find("https://login.test", "https://app.test/cb")).toBe("client-1");
    });

    it("forgets a client only while it is still the one kept", async () => {
      const registrations = fx.store.oauthClientRegistrations;
      await registrations.save("https://login.test", "https://app.test/cb", "client-1", NOW);
      await registrations.forget("https://login.test", "https://app.test/cb", "client-stale");
      expect(await registrations.find("https://login.test", "https://app.test/cb")).toBe("client-1");
      await registrations.forget("https://login.test", "https://app.test/cb", "client-1");
      await registrations.forget("https://login.test", "https://app.test/cb", "client-1");
      expect(await registrations.find("https://login.test", "https://app.test/cb")).toBeUndefined();
    });

    it("answers the login servers it keeps a client id with", async () => {
      const registrations = fx.store.oauthClientRegistrations;
      await registrations.save("https://login.test", "https://app.test/cb", "client-kept", NOW);
      await registrations.save("https://login.test", "http://127.0.0.1:17237/cb", "client-kept", NOW);
      await registrations.save("https://other.test", "https://app.test/cb", "client-kept", NOW);
      expect([...(await registrations.loginServersHolding("client-kept"))].sort()).toEqual(["https://login.test", "https://other.test"]);
      expect(await registrations.loginServersHolding("client-never")).toEqual([]);
    });
  });

  describe("connect links", () => {
    const NOW = 1_800_000_000;
    const link = {
      tokenHash: "hash-1",
      org: "org_a",
      vaultId: "vlt_1",
      address: "https://mcp.example.test/mcp",
      returnUrl: "https://app.example.test/back",
      createdBy: "ida_1",
      createdByClass: "machine",
      createdByBoundOrg: "org_a",
      createdAt: NOW,
      expiresAt: NOW + 1800,
      usedAt: 0,
    };

    it("finds a link only while it is unused and unexpired", async () => {
      const links = fx.store.connectLinks;
      await links.create(link);
      expect(await links.findUsable("hash-1", NOW)).toEqual(link);
      expect(await links.findUsable("hash-1", NOW + 1800), "expired at its expiry").toBeUndefined();
      expect(await links.findUsable("ghost", NOW)).toBeUndefined();
    });

    it("spends a link once, and restores it for a failed sign-in", async () => {
      const links = fx.store.connectLinks;
      await links.create(link);
      expect(await links.spend("hash-1", NOW + 5)).toBe(true);
      expect(await links.spend("hash-1", NOW + 6), "a link is spent once").toBe(false);
      expect(await links.findUsable("hash-1", NOW + 6)).toBeUndefined();
      await links.restore("hash-1", NOW + 99);
      expect(await links.findUsable("hash-1", NOW + 6), "restore needs the spend's own time").toBeUndefined();
      await links.restore("hash-1", NOW + 5);
      expect(await links.findUsable("hash-1", NOW + 6)).toMatchObject({ usedAt: 0 });
      expect(await links.spend("hash-1", NOW + 1800), "an expired link cannot be spent").toBe(false);
    });

    it("removes expired links, a vault's links and an organization's links", async () => {
      const links = fx.store.connectLinks;
      await links.create(link);
      await links.create({ ...link, tokenHash: "hash-2", vaultId: "vlt_2", expiresAt: NOW + 10 });
      await links.create({ ...link, tokenHash: "hash-3", org: "org_b", vaultId: "vlt_3" });
      expect(await links.deleteExpired(NOW + 10)).toBe(1);
      expect(await links.deleteByVault("vlt_1")).toBe(1);
      expect(await links.deleteByOrg("org_a")).toBe(0);
      expect(await links.deleteByOrg("org_b")).toBe(1);
    });
  });

  describe("connect attempts", () => {
    const NOW = 1_800_000_000;
    const attempt = {
      id: "connect-plg_1-a",
      org: "org_a",
      createdBy: "ida_1",
      person: "ida_1",
      pluginId: "plg_1",
      server: "tickets",
      createdAt: NOW,
      expiresAt: NOW + 600,
    };

    it("finds an attempt only while it is unexpired, and never after it ends", async () => {
      const attempts = fx.store.connectAttempts;
      await attempts.create(attempt);
      expect(await attempts.findLive(attempt.id, NOW)).toEqual(attempt);
      expect(await attempts.findLive(attempt.id, NOW + 600), "expired at its expiry").toBeUndefined();
      expect(await attempts.findLive("ghost", NOW)).toBeUndefined();
      await attempts.delete(attempt.id);
      expect(await attempts.findLive(attempt.id, NOW)).toBeUndefined();
      await expect(attempts.delete(attempt.id), "ending twice is a no-op").resolves.toBeUndefined();
    });

    it("keeps the plugin, the server and a caller who is no person as written", async () => {
      const attempts = fx.store.connectAttempts;
      const machine = {
        ...attempt,
        id: "connect-plg_1-b",
        person: "",
        pluginId: "plg_2",
        server: "docs-search",
      };
      await attempts.create(machine);
      expect(await attempts.findLive(machine.id, NOW)).toEqual(machine);
    });

    it("removes expired attempts and an organization's attempts", async () => {
      const attempts = fx.store.connectAttempts;
      await attempts.create(attempt);
      await attempts.create({ ...attempt, id: "connect-plg_1-c", expiresAt: NOW + 10 });
      await attempts.create({ ...attempt, id: "connect-plg_1-d", org: "org_b" });
      expect(await attempts.deleteExpired(NOW + 10)).toBe(1);
      expect(await attempts.deleteByOrg("org_a")).toBe(1);
      expect(await attempts.deleteByOrg("org_a")).toBe(0);
      expect(await attempts.findLive("connect-plg_1-d", NOW)).toBeDefined();
    });
  });

  describe("organization deletions", () => {
    const T0 = "2026-10-05T10:00:00.000Z";
    const T1 = "2026-10-05T10:01:00.000Z";

    it("mark has one winner; a marked organization is deleting until it is released", async () => {
      const deletions = fx.store.organizationDeletions;
      expect(await deletions.isDeleting("org_a")).toBe(false);
      const marks = await Promise.all([
        deletions.mark("org_a", T0),
        deletions.mark("org_a", T0),
      ]);
      expect(marks.filter(Boolean)).toHaveLength(1);
      expect(await deletions.isDeleting("org_a")).toBe(true);
      expect(await deletions.isDeleting("org_b")).toBe(false);
      expect(await deletions.get("org_a")).toEqual({
        org: "org_a",
        phase: "pending",
        markedAt: T0,
        acceptedAt: "",
        heartbeatAt: "",
        stage: "",
        lastError: "",
      });
    });

    it("accept moves pending to accepted once; unmark removes only a pending row", async () => {
      const deletions = fx.store.organizationDeletions;
      await deletions.mark("org_a", T0);
      await deletions.mark("org_b", T0);
      expect(await deletions.accept("org_a", T1)).toBe(true);
      expect(await deletions.accept("org_a", T1), "already accepted").toBe(
        false,
      );
      expect(await deletions.accept("org_c", T1), "never marked").toBe(false);
      expect(await deletions.unmark("org_a"), "accepted is the purge's").toBe(
        false,
      );
      expect(await deletions.isDeleting("org_a")).toBe(true);
      expect(await deletions.unmark("org_b")).toBe(true);
      expect(await deletions.isDeleting("org_b")).toBe(false);
      expect(await deletions.accept("org_b", T1), "unmarked").toBe(false);
      expect((await deletions.get("org_a"))?.acceptedAt).toBe(T1);
    });

    it("heartbeat and recordError touch accepted rows only; release removes any row", async () => {
      const deletions = fx.store.organizationDeletions;
      await deletions.mark("org_a", T0);
      await deletions.mark("org_b", T0);
      await deletions.accept("org_a", T0);
      await deletions.recordError("org_a", "content", "failed to purge", T1);
      expect(await deletions.get("org_a")).toMatchObject({
        heartbeatAt: T1,
        stage: "content",
        lastError: "failed to purge",
      });
      await deletions.heartbeat("org_a", "final", T1);
      expect(await deletions.get("org_a")).toMatchObject({
        stage: "final",
        lastError: "",
      });
      await deletions.heartbeat("org_b", "final", T1);
      expect((await deletions.get("org_b"))?.heartbeatAt, "pending").toBe("");
      expect((await deletions.list()).map((row) => row.org)).toEqual([
        "org_a",
        "org_b",
      ]);
      await deletions.release("org_a");
      await deletions.release("org_b");
      await deletions.release("org_b");
      expect(await deletions.list()).toEqual([]);
    });
  });

  describe("removal by organization (a purge's side-store writes)", () => {
    it("the search index and the fire ledger remove one organization's rows only", async () => {
      for (const org of ["org_a", "org_b"]) {
        await fx.store.upsertSearchIndex(ApiResourceKind.agent, `agt_${org}`, {
          name: "kubernetes helper",
          description: "",
          tags: "",
          org,
          visibility: "visibility_private",
          createdAt: 1_700_000_000,
        });
        await fx.store.upsertScheduleFire({
          scheduleId: `sch_${org}`,
          org,
          nominalFireTime: "2026-08-20T00:00:00Z",
          origin: "cron",
          outcome: "started",
          reason: "",
          executionId: "",
          recordedAt: "2026-08-20T00:00:01Z",
          completedAt: "",
        });
      }
      expect(await fx.store.deleteSearchIndexByOrg("org_a")).toBe(1);
      expect(await fx.store.deleteSearchIndexByOrg("")).toBe(0);
      expect(await fx.store.deleteScheduleFiresByOrg("org_a")).toBe(1);
      expect((await fx.store.listScheduleFires("sch_org_a", 0, 0)).total).toBe(0);
      expect((await fx.store.listScheduleFires("sch_org_b", 0, 0)).total).toBe(1);
      const left = await fx.store.querySearchIndex({
        kinds: ["agent"],
        terms: ["kubernetes"],
        orgFilter: "",
        limit: 20,
        offset: 0,
      });
      expect(left.totalCount).toBe(1);
      expect(JSON.stringify(left)).toContain("agt_org_b");
    });

    it("pending OAuth states remove one organization's records only", async () => {
      for (const org of ["org_a", "org_b"]) {
        await fx.store.pendingOAuthStates.save({
          state: `state-${org}`,
          codeVerifier: "enc:v1:sealed",
          clientId: "client-1",
          clientSecret: "",
          tokenEndpoint: "https://example.test/token",
          identityAccountId: "ida_1",
          authMethod: "mcp_oauth",
          tokenAuthMethod: "",
          redirectUri: "http://127.0.0.1/cb",
          org,
          vaultId: "",
          address: "",
          loginApp: "",
          resource: "",
          clientRegistration: "",
          connectLink: "",
          providerName: "",
          userinfoUrl: "",
          createdAt: 0,
        });
      }
      expect(await fx.store.pendingOAuthStates.deleteByOrg("org_a")).toBe(1);
      expect(await fx.store.pendingOAuthStates.deleteByOrg("org_a")).toBe(0);
      expect(
        await fx.store.pendingOAuthStates.getAndDelete("state-org_b"),
      ).toBeDefined();
    });
  });

  describe("list index", () => {
    const SESSION = ApiResourceKind.session;

    function session(
      id: string,
      org: string,
      createdSeconds: number | undefined,
      extras: { agentId?: string; channel?: string } = {},
    ): Session {
      return create(SessionSchema, {
        metadata: {
          id,
          org,
          labels:
            extras.channel === undefined
              ? {}
              : { "stigmer.ai/channel-id": extras.channel },
        },
        status: {
          agentId: extras.agentId ?? "",
          ...(createdSeconds === undefined
            ? {}
            : {
                audit: {
                  specAudit: {
                    createdAt: { seconds: BigInt(createdSeconds), nanos: 0 },
                  },
                },
              }),
        },
      });
    }

    async function save(s: Session): Promise<void> {
      await fx.store.saveResource(SESSION, s.metadata!.id, SessionSchema, s);
    }

    function ids(rows: ReadonlyArray<ListIndexRow>): string[] {
      return rows.map((r) => r.id);
    }

    it("reads one organization's rows newest first, ids breaking ties, unstamped last", async () => {
      await save(session("ses_a", "acme", 100));
      await save(session("ses_b", "acme", 300));
      await save(session("ses_c", "acme", 300));
      await save(session("ses_d", "acme", undefined));
      await save(session("ses_e", "other", 500));

      const rows = await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
        org: "acme",
      });
      expect(ids(rows)).toEqual(["ses_c", "ses_b", "ses_a", "ses_d"]);
      expect(
        fromBinary(SessionSchema, rows[0]!.data).metadata?.id,
        "the row's bytes ride the result",
      ).toBe("ses_c");
      expect(
        ids(await fx.store.queryResources(CONTRACT_SESSION_INDEX, {})),
        "no organization reads every organization",
      ).toEqual(["ses_e", "ses_c", "ses_b", "ses_a", "ses_d"]);
    });

    it("walks every row by cursor with no gap and no duplicate", async () => {
      for (let i = 0; i < 7; i++) {
        await save(session(`ses_${i}`, "acme", i % 3 === 0 ? 10 : 100 + i));
      }
      const all = ids(
        await fx.store.queryResources(CONTRACT_SESSION_INDEX, { org: "acme" }),
      );

      const walked: string[] = [];
      let after: ListIndexRow["cursor"] | undefined;
      for (;;) {
        const page = await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
          org: "acme",
          limit: 3,
          ...(after === undefined ? {} : { after }),
        });
        walked.push(...ids(page));
        if (page.length < 3) {
          break;
        }
        after = page[page.length - 1]!.cursor;
      }
      expect(walked).toEqual(all);
      expect(new Set(walked).size).toBe(7);
    });

    it("reads a parent's rows through a key, or through any of several", async () => {
      await save(session("ses_1", "acme", 1, { agentId: "agt_1" }));
      await save(session("ses_2", "acme", 2, { channel: "ach_1" }));
      await save(session("ses_3", "acme", 3, { agentId: "agt_2" }));

      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            anyKey: [{ name: "agent", value: "agt_1" }],
          }),
        ),
      ).toEqual(["ses_1"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            anyKey: [
              { name: "agent", value: "agt_1" },
              { name: "channel", value: "ach_1" },
            ],
          }),
        ),
      ).toEqual(["ses_2", "ses_1"]);
      expect(
        await fx.store.queryResources(CONTRACT_SESSION_INDEX, { anyKey: [] }),
        "an empty key list matches nothing",
      ).toEqual([]);
    });

    it("leaves out rows holding a value for any key it is told to, the unproven included", async () => {
      await save(session("ses_1", "acme", 1, { agentId: "agt_1" }));
      await save(session("ses_2", "acme", 2, { channel: "ach_1" }));
      await save(
        session("ses_3", "acme", 3, { agentId: "agt_1", channel: "ach_2" }),
      );
      await save(session("ses_4", "acme", 4));
      await save(session("ses_5", "other", 5, { channel: "ach_3" }));

      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "acme",
            withoutKeys: ["channel"],
          }),
        ),
      ).toEqual(["ses_4", "ses_1"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            anyKey: [{ name: "agent", value: "agt_1" }],
            withoutKeys: ["channel"],
          }),
        ),
        "a key read leaves them out too",
      ).toEqual(["ses_1"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            withoutKeys: ["channel", "agent"],
          }),
        ),
        "any listed key excludes",
      ).toEqual(["ses_4"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "acme",
            withoutKeys: [],
          }),
        ),
        "an empty list excludes nothing",
      ).toEqual(["ses_4", "ses_3", "ses_2", "ses_1"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "acme",
            withoutKeys: ["channel"],
            limit: 1,
            after: { createdAt: "1970-01-01T00:00:04.000000000Z", id: "ses_4" },
          }),
        ),
        "the limit counts only the rows kept",
      ).toEqual(["ses_1"]);

      await fx.writeAsOlderBinary(
        SESSION,
        "ses_old_channel",
        toBinary(
          SessionSchema,
          session("ses_old_channel", "acme", 10, { channel: "ach_9" }),
        ),
      );
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_old_plain",
        toBinary(SessionSchema, session("ses_old_plain", "acme", 9)),
      );
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "acme",
            withoutKeys: ["channel"],
          }),
        ),
        "a row read from its bytes is judged by the same rule",
      ).toEqual(["ses_old_plain", "ses_4", "ses_1"]);
    });

    it("keeps rows created at or after a bound, and rows with no stamp", async () => {
      await save(session("ses_old", "acme", 100));
      await save(session("ses_new", "acme", 200));
      await save(session("ses_unstamped", "acme", undefined));
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            createdAtOrAfter: "1970-01-01T00:02:30.000000000Z",
          }),
        ),
      ).toEqual(["ses_new", "ses_unstamped"]);
    });

    it("follows a key an update changes, and forgets a deleted row", async () => {
      await save(session("ses_1", "acme", 1, { agentId: "agt_1" }));
      await fx.store.updateResource(SESSION, "ses_1", SessionSchema, (s) => {
        s.status!.agentId = "agt_2";
      });
      const byAgent = (value: string) =>
        fx.store.queryResources(CONTRACT_SESSION_INDEX, {
          anyKey: [{ name: "agent", value }],
        });
      expect(ids(await byAgent("agt_1"))).toEqual([]);
      expect(ids(await byAgent("agt_2"))).toEqual(["ses_1"]);

      await fx.store.deleteResource(SESSION, "ses_1");
      expect(ids(await byAgent("agt_2"))).toEqual([]);
      expect(await fx.store.queryResources(CONTRACT_SESSION_INDEX, {})).toEqual(
        [],
      );
    });

    it("reads a row written by a binary that does not know the index from its bytes, and repairs it", async () => {
      await save(
        session("ses_moved", "acme", 100, { agentId: "agt_1" }),
      );
      // The older binary rewrites one row into another organization and
      // agent, and creates another row outright.
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_moved",
        toBinary(
          SessionSchema,
          session("ses_moved", "other", 100, { agentId: "agt_2" }),
        ),
      );
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_created",
        toBinary(SessionSchema, session("ses_created", "acme", 50)),
      );
      await save(session("ses_proven", "acme", 75));
      expect(await fx.countUnproven(SESSION, 1)).toBe(2);

      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "acme",
          }),
        ),
      ).toEqual(["ses_proven", "ses_created"]);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            anyKey: [{ name: "agent", value: "agt_2" }],
          }),
        ),
      ).toEqual(["ses_moved"]);
      expect(
        await fx.countUnproven(SESSION, 1),
        "both rows repaired by the read",
      ).toBe(0);
      expect(
        ids(
          await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
            org: "other",
          }),
        ),
        "and read through the index once repaired",
      ).toEqual(["ses_moved"]);
    });

    it("merges an unproven row into the right page of a cursor walk", async () => {
      for (let i = 0; i < 4; i++) {
        await save(session(`ses_${i}`, "acme", 100 + i));
      }
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_mid",
        toBinary(SessionSchema, session("ses_mid", "acme", 102)),
      );
      const first = await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
        org: "acme",
        limit: 2,
      });
      const second = await fx.store.queryResources(CONTRACT_SESSION_INDEX, {
        org: "acme",
        limit: 2,
        after: first[1]!.cursor,
      });
      expect([...ids(first), ...ids(second)]).toEqual([
        "ses_3",
        "ses_mid",
        "ses_2",
        "ses_1",
      ]);
    });

    it("skips an unproven row that does not decode", async () => {
      await save(session("ses_good", "acme", 1));
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_garbage",
        new Uint8Array([0xff, 0xff, 0xff]),
      );
      expect(
        ids(await fx.store.queryResources(CONTRACT_SESSION_INDEX, {})),
      ).toEqual(["ses_good"]);
    });

    it("leaves nothing unproven once a store has opened", async () => {
      await fx.writeAsOlderBinary(
        SESSION,
        "ses_1",
        toBinary(SessionSchema, session("ses_1", "acme", 1)),
      );
      await fx.writeAsOlderBinary(
        KIND,
        "acme",
        toBinary(OrganizationSchema, makeOrganization({ id: "acme" })),
      );
      expect(await fx.countUnproven(SESSION, 1)).toBe(1);

      await fx.openAnother(CONTRACT_STORE_OPTIONS);
      expect(
        await fx.countUnproven(SESSION, 1),
        "a declared kind is derived",
      ).toBe(0);
      expect(
        await fx.countUnproven(KIND),
        "an undeclared kind is stamped, so it never widens the unproven set",
      ).toBe(0);
    });

    it("re-derives rows written under another revision of a declaration", async () => {
      await save(session("ses_1", "acme", 1));
      const revised = declareListIndex({
        ...CONTRACT_SESSION_INDEX,
        revision: 2,
        keys: { org_copy: field("metadata.org") },
      });
      expect(await fx.countUnproven(SESSION, 2)).toBe(1);
      const other = await fx.openAnother({ listIndexes: [revised] });
      expect(await fx.countUnproven(SESSION, 2)).toBe(0);
      expect(
        ids(
          await other.queryResources(revised, {
            anyKey: [{ name: "org_copy", value: "acme" }],
          }),
        ),
      ).toEqual(["ses_1"]);
    });

    it("refuses a declaration it was not opened with, and a limit no caller means", async () => {
      const stranger = declareListIndex({ ...CONTRACT_SESSION_INDEX });
      await expect(fx.store.queryResources(stranger, {})).rejects.toThrow(
        "list index for session is not registered with this store",
      );
      await expect(
        fx.store.queryResources(CONTRACT_SESSION_INDEX, { limit: 0 }),
      ).rejects.toThrow("list index limit must be a positive integer, got 0");
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
      await expect(fx.store.pendingOAuthStates.deleteByOrg("o")).rejects.toThrow(
        "store is closed",
      );
      await expect(
        fx.store.resourceNames.claim(
          { kind: "organization", org: "", name: "o" },
          "org_o",
          new Date().toISOString(),
        ),
      ).rejects.toThrow("store is closed");
    });
  });
}
