/**
 * The two store drivers as test fixtures, for every authorization test
 * that must hold on sqlite AND Postgres (the source, the Authorizer, the
 * directory, the fire caller): `describe.each(driverFixtures(kinds))`
 * opens a fresh sqlite file per test, or the shared Postgres test
 * database with the named kinds cleared — the shape derived-tuples.test.ts
 * established, lifted here so four files do not carry four copies.
 *
 * Postgres is skipped, never failed, when no `TEST_DATABASE_URL` is set
 * (the store's own convention); `dropPostgresFixture` is the `afterAll`
 * each file registers so the database it created is dropped.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../boot/list-indexes.js";
import type { Store } from "../../store/interface.js";
import { PostgresStore } from "../../store/postgres/store.js";
import {
  createTestDatabase,
  testDatabaseAdminUrl,
  type TestDatabase,
} from "../../store/postgres/__tests__/support.js";
import { tempStore } from "../../store/sqlite/__tests__/support.js";

export interface OpenedStore {
  readonly store: Store;
  close(): Promise<void>;
}

export interface DriverFixture {
  readonly name: string;
  readonly skip: boolean;
  open(): Promise<OpenedStore>;
}

let postgresDatabase: TestDatabase | undefined;

/** Both drivers; `seededKinds` are cleared on the shared Postgres database before each open. */
export function driverFixtures(
  seededKinds: ReadonlyArray<ApiResourceKind>,
): ReadonlyArray<DriverFixture> {
  return [
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
        if (postgresDatabase === undefined) {
          postgresDatabase = await createTestDatabase();
        }
        const store = await PostgresStore.open(
          postgresDatabase.databaseUrl,
          undefined,
          { listIndexes: LIST_INDEXES },
        );
        for (const kind of seededKinds) {
          await store.deleteResourcesByKind(kind);
        }
        return { store, close: () => store.close() };
      },
    },
  ];
}

export async function dropPostgresFixture(): Promise<void> {
  await postgresDatabase?.drop();
  postgresDatabase = undefined;
}
