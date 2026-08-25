/**
 * Pins the driver's method contracts against Go's
 * backend/libs/go/store/sqlite/store.go: resource CRUD physical layout,
 * updateResource RMW atomicity (BEGIN IMMEDIATE, D2 §2), the preserved
 * findAllByField quirk (sub-project DD-001), audit ordering + the #341
 * SetAuditTag head-repoint semantics, first-writer-wins events (oss#308
 * contract), the terminal-immutable schedule-run ledger (DD-017 D-7), the
 * FTS5 index maintenance, and the closed-store failure mode. The FTS5
 * ranking probe at the bottom is spike SP-C, kept permanently so a Node
 * build that drops FTS5 fails CI here, not at a user's laptop.
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import {
  AuditNotFoundError,
  ResourceNotFoundError,
} from "../../interface.js";
import type { WorkflowExecutionEventRecord } from "../../interface.js";
import { makeOrganization, tempStore, type TempStore } from "./support.js";

const KIND = ApiResourceKind.organization;

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

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

describe("resource CRUD", () => {
  it("round-trips a resource and stamps updated_at (kind stored as the proto name)", async () => {
    const org = makeOrganization({ id: "acme" });
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, org);

    const loaded = await temp.store.getResource(KIND, "acme", OrganizationSchema);
    expect(loaded.metadata?.name).toBe("Acme");

    // Physical layout is contract: Go reads these exact columns/values.
    const db = new DatabaseSync(temp.dbPath);
    const row = db
      .prepare(`SELECT kind, updated_at FROM resources WHERE id = 'acme'`)
      .get() as { kind: string; updated_at: string };
    db.close();
    expect(row.kind).toBe("organization");
    expect(row.updated_at).not.toBe("");
  });

  it("saveResource upserts (INSERT OR REPLACE on kind+id)", async () => {
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, makeOrganization());
    await temp.store.saveResource(
      KIND,
      "acme",
      OrganizationSchema,
      makeOrganization({ description: "second write" }),
    );
    const loaded = await temp.store.getResource(KIND, "acme", OrganizationSchema);
    expect(loaded.spec?.description).toBe("second write");
    expect(await temp.store.listResources(KIND)).toHaveLength(1);
  });

  it("getResource throws ResourceNotFoundError with the kind/id detail", async () => {
    await expect(
      temp.store.getResource(KIND, "ghost", OrganizationSchema),
    ).rejects.toThrow(ResourceNotFoundError);
    await expect(
      temp.store.getResource(KIND, "ghost", OrganizationSchema),
    ).rejects.toThrow("resource not found: organization/ghost");
  });

  it("deleteResource is a silent no-op for a missing resource", async () => {
    await expect(temp.store.deleteResource(KIND, "ghost")).resolves.toBeUndefined();
  });

  it("listResources returns an empty array (never undefined) for an empty kind", async () => {
    expect(await temp.store.listResources(KIND)).toEqual([]);
  });

  it("deleteResourcesByKind and ByIdPrefix return the deleted counts", async () => {
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, makeOrganization({ id: "acme" }));
    await temp.store.saveResource(KIND, "beta", OrganizationSchema, makeOrganization({ id: "beta" }));
    await temp.store.saveResource(KIND, "acme-2", OrganizationSchema, makeOrganization({ id: "acme-2" }));

    expect(await temp.store.deleteResourcesByIdPrefix(KIND, "acme")).toBe(2);
    expect(await temp.store.deleteResourcesByKind(KIND)).toBe(1);
  });
});

describe("updateResource (atomic RMW)", () => {
  it("applies the mutation and returns the persisted message", async () => {
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, makeOrganization());

    const updated = await temp.store.updateResource(
      KIND,
      "acme",
      OrganizationSchema,
      (org) => {
        org.spec!.description = "mutated";
      },
    );
    expect(updated.spec?.description).toBe("mutated");

    const reloaded = await temp.store.getResource(KIND, "acme", OrganizationSchema);
    expect(reloaded.spec?.description).toBe("mutated");
  });

  it("a throwing modify skips the write and propagates (transaction rolled back)", async () => {
    await temp.store.saveResource(
      KIND,
      "acme",
      OrganizationSchema,
      makeOrganization({ description: "original" }),
    );

    await expect(
      temp.store.updateResource(KIND, "acme", OrganizationSchema, () => {
        throw new Error("modify failed");
      }),
    ).rejects.toThrow("modify failed");

    const reloaded = await temp.store.getResource(KIND, "acme", OrganizationSchema);
    expect(reloaded.spec?.description).toBe("original");
    // The rolled-back transaction must not leave the connection wedged.
    await expect(
      temp.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
        org.spec!.description = "after rollback";
      }),
    ).resolves.toBeDefined();
  });

  it("throws ResourceNotFoundError for a missing resource", async () => {
    await expect(
      temp.store.updateResource(KIND, "ghost", OrganizationSchema, () => {}),
    ).rejects.toThrow(ResourceNotFoundError);
  });

  it("interleaved updates both land (single-connection serialization)", async () => {
    await temp.store.saveResource(
      KIND,
      "acme",
      OrganizationSchema,
      makeOrganization({ description: "" }),
    );
    await Promise.all([
      temp.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
        org.spec!.description += "|first";
      }),
      temp.store.updateResource(KIND, "acme", OrganizationSchema, (org) => {
        org.spec!.description += "|second";
      }),
    ]);
    const reloaded = await temp.store.getResource(KIND, "acme", OrganizationSchema);
    expect(reloaded.spec?.description).toBe("|first|second");
  });
});

describe("field and label queries", () => {
  it("findByField matches camelCase paths with snake_case fallback (Go's two-probe lookup)", async () => {
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, makeOrganization({ id: "acme" }));
    await temp.store.saveResource(
      KIND,
      "beta",
      OrganizationSchema,
      makeOrganization({ id: "beta", name: "Beta", description: "target" }),
    );

    const bySpec = await temp.store.findByField(
      KIND,
      "spec.description",
      "target",
      OrganizationSchema,
    );
    expect(bySpec.metadata?.id).toBe("beta");

    // "apiVersion" resolves via camelCase→snake_case ("api_version").
    const byTop = await temp.store.findByField(
      KIND,
      "apiVersion",
      "tenancy.stigmer.ai/v1",
      OrganizationSchema,
    );
    expect(byTop.metadata).toBeDefined();
  });

  it("findByField throws ResourceNotFoundError naming the predicate", async () => {
    await expect(
      temp.store.findByField(KIND, "spec.description", "none", OrganizationSchema),
    ).rejects.toThrow("resource not found: organization where spec.description=none");
  });

  it("findAllByField preserves the Go quirk: ALL rows of the kind, unfiltered (DD-001)", async () => {
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, makeOrganization({ id: "acme" }));
    await temp.store.saveResource(
      KIND,
      "beta",
      OrganizationSchema,
      makeOrganization({ id: "beta", description: "only-this-one" }),
    );

    const rows = await temp.store.findAllByField(KIND, "spec.description", "only-this-one");
    // Two rows despite the predicate matching one — the caller filters,
    // exactly as every Go call site does.
    expect(rows).toHaveLength(2);
  });

  it("findAllByLabel matches metadata.labels entries", async () => {
    await temp.store.saveResource(
      KIND,
      "acme",
      OrganizationSchema,
      makeOrganization({ id: "acme", labels: { "stigmer.ai/system": "true" } }),
    );
    await temp.store.saveResource(
      KIND,
      "beta",
      OrganizationSchema,
      makeOrganization({ id: "beta", labels: { "stigmer.ai/system": "false" } }),
    );

    const matches = await temp.store.findAllByLabel(
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
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-1", "");
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-2", "latest");

    const records = await temp.store.listAuditRecords(KIND, "acme");
    expect(records.map((record) => record.versionHash)).toEqual(["hash-2", "hash-1"]);
    expect(records[0]!.tag).toBe("latest");

    expect(await temp.store.countAuditEntries(KIND, "acme")).toBe(2);
    // Same-second inserts: the id DESC tiebreak keeps "latest" stable.
    expect(await temp.store.getLatestAuditHash(KIND, "acme")).toBe("hash-2");
  });

  it("getAuditByHash / getAuditByTag round-trip the snapshot", async () => {
    const org = makeOrganization({ description: "snapshotted" });
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-1", "stable");

    const byHash = await temp.store.getAuditByHash(KIND, "acme", "hash-1", OrganizationSchema);
    expect(byHash.spec?.description).toBe("snapshotted");

    const byTag = await temp.store.getAuditByTag(KIND, "acme", "stable", OrganizationSchema);
    expect(byTag.spec?.description).toBe("snapshotted");
  });

  it("audit lookups throw AuditNotFoundError when absent", async () => {
    await expect(
      temp.store.getAuditRecordByHash(KIND, "acme", "nope"),
    ).rejects.toThrow(AuditNotFoundError);
    await expect(
      temp.store.getAuditRecordByTag(KIND, "acme", "nope"),
    ).rejects.toThrow(AuditNotFoundError);
    await expect(temp.store.getLatestAuditHash(KIND, "acme")).rejects.toThrow(
      AuditNotFoundError,
    );
    expect(await temp.store.countAuditEntries(KIND, "acme")).toBe(0);
    expect(await temp.store.listAuditRecords(KIND, "acme")).toEqual([]);
  });

  it("setAuditTag moves the tag atomically — single holder (#341)", async () => {
    const org = makeOrganization();
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-1", "stable");
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-2", "");

    await temp.store.setAuditTag(KIND, "acme", "hash-2", "stable");

    const records = await temp.store.listAuditRecords(KIND, "acme");
    const byHash = new Map(records.map((record) => [record.versionHash, record.tag]));
    expect(byHash.get("hash-2")).toBe("stable");
    expect(byHash.get("hash-1"), "the prior holder is cleared").toBe("");
  });

  it("setAuditTag with a missing target rolls back — the prior holder keeps the tag", async () => {
    const org = makeOrganization();
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-1", "stable");

    await expect(
      temp.store.setAuditTag(KIND, "acme", "missing-hash", "stable"),
    ).rejects.toThrow(AuditNotFoundError);

    const record = await temp.store.getAuditRecordByTag(KIND, "acme", "stable");
    expect(record.versionHash, "a missing target never orphans the tag").toBe("hash-1");
  });

  it("duplicate rows for one hash are legal — newest wins (stigmer-cloud#191)", async () => {
    await temp.store.saveAudit(
      KIND, "acme", OrganizationSchema, makeOrganization({ description: "older" }), "hash-x", "",
    );
    await temp.store.saveAudit(
      KIND, "acme", OrganizationSchema, makeOrganization({ description: "newer" }), "hash-x", "",
    );

    const record = await temp.store.getAuditByHash(KIND, "acme", "hash-x", OrganizationSchema);
    expect(record.spec?.description).toBe("newer");
  });

  it("deleteAuditByResourceId removes the resource's records and reports the count", async () => {
    const org = makeOrganization();
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-1", "");
    await temp.store.saveAudit(KIND, "acme", OrganizationSchema, org, "hash-2", "");
    expect(await temp.store.deleteAuditByResourceId(KIND, "acme")).toBe(2);
    expect(await temp.store.countAuditEntries(KIND, "acme")).toBe(0);
  });
});

describe("workflow execution events", () => {
  it("append is insert-or-skip, first-writer-wins (oss#308 contract)", async () => {
    expect(
      await temp.store.appendWorkflowExecutionEvents("wfe_1", [event(1), event(2)]),
    ).toBe(2);
    // A retried batch re-sends the same sequence numbers: idempotent no-op
    // for the duplicates, the new event still lands.
    expect(
      await temp.store.appendWorkflowExecutionEvents("wfe_1", [event(1), event(3)]),
    ).toBe(1);
    expect(await temp.store.getMaxEventSequence("wfe_1")).toBe(3);
  });

  it("paginates by cursor with type and task filters", async () => {
    await temp.store.appendWorkflowExecutionEvents("wfe_1", [
      event(1, "task_started", "step-a"),
      event(2, "task_completed", "step-a"),
      event(3, "task_started", "step-b"),
    ]);

    const afterFirst = await temp.store.getWorkflowExecutionEvents("wfe_1", 1, "", "", 0);
    expect(afterFirst.map((row) => row.sequenceNumber)).toEqual([2, 3]);

    const started = await temp.store.getWorkflowExecutionEvents("wfe_1", 0, "task_started", "", 0);
    expect(started.map((row) => row.sequenceNumber)).toEqual([1, 3]);

    const stepA = await temp.store.getWorkflowExecutionEvents("wfe_1", 0, "", "step-a", 0);
    expect(stepA.map((row) => row.sequenceNumber)).toEqual([1, 2]);

    const limited = await temp.store.getWorkflowExecutionEvents("wfe_1", 0, "", "", 2);
    expect(limited).toHaveLength(2);
  });

  it("empty batches and unknown executions are calm no-ops", async () => {
    expect(await temp.store.appendWorkflowExecutionEvents("wfe_1", [])).toBe(0);
    expect(await temp.store.getMaxEventSequence("ghost")).toBe(0);
    expect(await temp.store.getWorkflowExecutionEvents("ghost", 0, "", "", 0)).toEqual([]);
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
    await temp.store.upsertScheduleRun(baseRun);
    await temp.store.upsertScheduleRun({ ...baseRun, outcome: "completed", completedAt: "2026-08-20T00:00:05Z" });

    const { runs, total } = await temp.store.listScheduleRuns("sch_1", 0, 0);
    expect(total).toBe(1);
    expect(runs[0]!.outcome).toBe("completed");
  });

  it("terminal rows are never downgraded by a replayed 'started' write", async () => {
    await temp.store.upsertScheduleRun({ ...baseRun, outcome: "completed", completedAt: "2026-08-20T00:00:05Z" });
    await temp.store.upsertScheduleRun(baseRun); // the replay

    const { runs } = await temp.store.listScheduleRuns("sch_1", 0, 0);
    expect(runs[0]!.outcome, "the verdict survives the replay").toBe("completed");
    expect(runs[0]!.completedAt).toBe("2026-08-20T00:00:05Z");
  });

  it("markLatestScheduleRunTerminal stamps the newest non-terminal row of that origin only", async () => {
    await temp.store.upsertScheduleRun(baseRun);
    // A newer MANUAL fire must not steal the cron run's verdict — the
    // origin filter is load-bearing (see the interface doc).
    await temp.store.upsertScheduleRun({
      ...baseRun,
      nominalFireTime: "2026-08-20T00:05:00Z",
      origin: "manual",
    });

    await temp.store.markLatestScheduleRunTerminal(
      "sch_1", "cron", "failed", "boom", "2026-08-20T00:01:00Z",
    );

    const { runs } = await temp.store.listScheduleRuns("sch_1", 0, 0);
    const cron = runs.find((run) => run.origin === "cron")!;
    const manual = runs.find((run) => run.origin === "manual")!;
    expect(cron.outcome).toBe("failed");
    expect(cron.reason).toBe("boom");
    expect(manual.outcome, "the manual row is untouched").toBe("started");
  });

  it("marking with no non-terminal row is a silent no-op", async () => {
    await expect(
      temp.store.markLatestScheduleRunTerminal("sch_ghost", "cron", "failed", "", "t"),
    ).resolves.toBeUndefined();
  });

  it("lists newest first with pagination totals; prune and delete report counts", async () => {
    for (const minute of ["00", "01", "02"]) {
      await temp.store.upsertScheduleRun({
        ...baseRun,
        nominalFireTime: `2026-08-20T00:${minute}:00Z`,
        recordedAt: `2026-08-20T00:${minute}:01Z`,
      });
    }

    const page = await temp.store.listScheduleRuns("sch_1", 0, 2);
    expect(page.total).toBe(3);
    expect(page.runs.map((run) => run.nominalFireTime)).toEqual([
      "2026-08-20T00:02:00Z",
      "2026-08-20T00:01:00Z",
    ]);

    expect(await temp.store.pruneScheduleRuns("2026-08-20T00:01:00Z")).toBe(1);
    expect(await temp.store.deleteScheduleRunsBySchedule("sch_1")).toBe(2);
  });
});

describe("search index (SP-C, permanent)", () => {
  it("upserts, ranks with Go's bm25 weights, stems with porter, and deletes", async () => {
    await temp.store.upsertSearchIndex(KIND, "acme", {
      name: "Billing Reconciler",
      description: "reconciles billing runs nightly",
      tags: "billing finance",
      org: "acme",
      visibility: "visibility_org",
      createdAt: 1,
    });
    await temp.store.upsertSearchIndex(KIND, "beta", {
      name: "Invoice Sync",
      description: "synchronizes invoices with the billing ledger",
      tags: "",
      org: "acme",
      visibility: "visibility_org",
      createdAt: 2,
    });

    // Read through a second connection — WAL allows concurrent readers,
    // and the query store (#13) will read exactly this way.
    const db = new DatabaseSync(temp.dbPath);
    const ranked = db
      .prepare(
        `SELECT resource_id, bm25(search_index, 1.0, 0, 10.0, 5.0, 5.0) AS score
         FROM search_index WHERE search_index MATCH ? ORDER BY score`,
      )
      .all('"billing"') as Array<{ resource_id: string }>;
    // name(10) + tags(5) hits outrank a description(5) hit.
    expect(ranked.map((row) => row.resource_id)).toEqual(["acme", "beta"]);

    const stemmed = db
      .prepare(`SELECT resource_id FROM search_index WHERE search_index MATCH ?`)
      .all('"reconciling"') as Array<{ resource_id: string }>;
    expect(stemmed, "porter stems reconciling→reconcil").toEqual([
      { resource_id: "acme" },
    ]);
    db.close();

    // Upsert replaces (DELETE + INSERT — FTS5 has no UPDATE).
    await temp.store.upsertSearchIndex(KIND, "acme", {
      name: "Renamed",
      description: "",
      tags: "",
      org: "acme",
      visibility: "visibility_org",
      createdAt: 1,
    });
    await temp.store.deleteSearchIndex(KIND, "beta");

    const remaining = new DatabaseSync(temp.dbPath);
    const rows = remaining
      .prepare(`SELECT resource_id, name FROM search_index`)
      .all() as Array<{ resource_id: string; name: string }>;
    remaining.close();
    expect(rows).toEqual([{ resource_id: "acme", name: "Renamed" }]);
  });
});

describe("lifecycle", () => {
  it("every method fails with 'store is closed' after close; close is idempotent", async () => {
    await temp.store.close();
    await temp.store.close(); // second close is a no-op, as in Go

    await expect(temp.store.listResources(KIND)).rejects.toThrow("store is closed");
    await expect(temp.store.bootstrapState.get("k")).rejects.toThrow("store is closed");
    await expect(temp.store.signalDedupe.release("o", "k")).rejects.toThrow("store is closed");
  });
});

describe("bootstrap state", () => {
  it("get returns '' (not an error) for a missing key; set upserts; getAll/delete/clear", async () => {
    expect(await temp.store.bootstrapState.get("missing")).toBe("");

    await temp.store.bootstrapState.set("seedpack_version", "1.0.0");
    await temp.store.bootstrapState.set("seedpack_version", "1.1.0");
    await temp.store.bootstrapState.set("bootstrap_status", "completed");

    expect(await temp.store.bootstrapState.get("seedpack_version")).toBe("1.1.0");
    expect(await temp.store.bootstrapState.getAll()).toEqual(
      new Map([
        ["seedpack_version", "1.1.0"],
        ["bootstrap_status", "completed"],
      ]),
    );

    await temp.store.bootstrapState.delete("bootstrap_status");
    await temp.store.bootstrapState.delete("bootstrap_status"); // absent → no error
    expect(await temp.store.bootstrapState.get("bootstrap_status")).toBe("");

    await temp.store.bootstrapState.clear();
    expect(await temp.store.bootstrapState.getAll()).toEqual(new Map());
  });
});
