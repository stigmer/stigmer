/**
 * Pins the memory kind's indexed reads (../queries.ts) over a real sqlite
 * store opened with the server's list indexes (stigmer#1405): a subject's
 * read answers that subject's rows in the one organization, in every
 * lifecycle state, newest first; the "" sentinel reads by organization
 * and stays exact against a named subject's rows; the organization read
 * answers every subject's rows there and none elsewhere; and rows a
 * binary that does not know the index wrote (a second handle opened with
 * no declarations, the overlap of a roll) answer the same.
 */
import { DatabaseSync } from "node:sqlite";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { apiResourceKindName } from "../../../store/proto-fields.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { listOrganizationMemories, listSubjectMemories } from "../queries.js";

let temp: TempStore;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

async function seed(
  store: Store,
  row: {
    id: string;
    org: string;
    subject: string;
    day: number;
    state?: MemoryLifecycleState;
  },
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.memory,
    row.id,
    MemorySchema,
    create(MemorySchema, {
      metadata: { id: row.id, name: row.id, org: row.org },
      spec: { content: row.id, subjectIdentityAccountId: row.subject },
      status: {
        lifecycleState:
          row.state ?? MemoryLifecycleState.lifecycle_state_confirmed,
        audit: {
          specAudit: {
            createdAt: timestampFromDate(new Date(Date.UTC(2026, 8, row.day))),
          },
        },
      },
    }),
  );
}

/** Memory rows whose index facts are not proven under revision 1 (the store-contract reading). */
function unprovenMemoryRows(): number {
  const db = new DatabaseSync(temp.dbPath);
  try {
    return (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM resources
           WHERE kind = ? AND (list_indexed_at IS NOT updated_at
             OR list_index_revision IS NULL OR list_index_revision <> 1)`,
        )
        .get(apiResourceKindName(ApiResourceKind.memory)) as { count: number }
    ).count;
  } finally {
    db.close();
  }
}

const ids = (memories: ReadonlyArray<Memory>): string[] =>
  memories.map((memory) => memory.metadata?.id ?? "");

async function seedTwoOrganizations(store: Store): Promise<void> {
  await seed(store, {
    id: "mem_carol_1",
    org: "acme",
    subject: "ida_carol",
    day: 1,
  });
  await seed(store, {
    id: "mem_carol_2",
    org: "acme",
    subject: "ida_carol",
    day: 3,
    state: MemoryLifecycleState.lifecycle_state_proposed,
  });
  await seed(store, {
    id: "mem_dave",
    org: "acme",
    subject: "ida_dave",
    day: 2,
  });
  await seed(store, { id: "mem_local", org: "acme", subject: "", day: 4 });
  await seed(store, {
    id: "mem_carol_zeta",
    org: "zeta",
    subject: "ida_carol",
    day: 5,
  });
}

describe("listSubjectMemories", () => {
  it("answers one subject's rows in one organization, every state, newest first", async () => {
    await seedTwoOrganizations(temp.store);
    expect(
      ids(await listSubjectMemories(temp.store, "acme", "ida_carol")),
    ).toEqual(["mem_carol_2", "mem_carol_1"]);
    expect(
      ids(await listSubjectMemories(temp.store, "zeta", "ida_carol")),
    ).toEqual(["mem_carol_zeta"]);
    expect(await listSubjectMemories(temp.store, "zeta", "ida_dave")).toEqual(
      [],
    );
  });

  it("reads the single-operator sentinel by organization, and only its own rows", async () => {
    await seedTwoOrganizations(temp.store);
    expect(ids(await listSubjectMemories(temp.store, "acme", ""))).toEqual([
      "mem_local",
    ]);
    expect(await listSubjectMemories(temp.store, "zeta", "")).toEqual([]);
  });

  it("answers rows a binary without the index wrote", async () => {
    const older = SqliteStore.open(temp.dbPath);
    try {
      await seedTwoOrganizations(older);
    } finally {
      await older.close();
    }
    expect(unprovenMemoryRows(), "the rows carry no memory index facts").toBe(
      5,
    );
    expect(
      ids(await listSubjectMemories(temp.store, "acme", "ida_carol")),
    ).toEqual(["mem_carol_2", "mem_carol_1"]);
    expect(ids(await listSubjectMemories(temp.store, "acme", ""))).toEqual([
      "mem_local",
    ]);
  });
});

describe("listOrganizationMemories", () => {
  it("answers every subject's rows in the organization, newest first, and none elsewhere", async () => {
    await seedTwoOrganizations(temp.store);
    expect(ids(await listOrganizationMemories(temp.store, "acme"))).toEqual([
      "mem_local",
      "mem_carol_2",
      "mem_dave",
      "mem_carol_1",
    ]);
    expect(ids(await listOrganizationMemories(temp.store, "zeta"))).toEqual([
      "mem_carol_zeta",
    ]);
  });
});
