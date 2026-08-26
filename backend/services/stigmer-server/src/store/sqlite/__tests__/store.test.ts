/**
 * Pins the sqlite driver's PHYSICAL contracts — the parts a Go-era
 * database on disk depends on and the contract suite deliberately cannot
 * express: the resources column layout (kind = the proto enum name,
 * updated_at stamped), and the SP-C FTS5 probe (bm25 weights, porter
 * stemming, DELETE+INSERT upsert), kept permanently so a Node build that
 * drops FTS5 fails CI here, not at a user's laptop.
 *
 * The driver's interface-shaped behavior is pinned by the shared contract
 * suite — see store-contract.test.ts (T01 D-4 extraction).
 */
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { makeOrganization, tempStore, type TempStore } from "./support.js";

const KIND = ApiResourceKind.organization;

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("physical layout", () => {
  it("stores kind as the proto name and stamps updated_at (Go reads these exact columns)", async () => {
    const org = makeOrganization({ id: "acme" });
    await temp.store.saveResource(KIND, "acme", OrganizationSchema, org);

    const db = new DatabaseSync(temp.dbPath);
    const row = db
      .prepare(`SELECT kind, updated_at FROM resources WHERE id = 'acme'`)
      .get() as { kind: string; updated_at: string };
    db.close();
    expect(row.kind).toBe("organization");
    expect(row.updated_at).not.toBe("");
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
