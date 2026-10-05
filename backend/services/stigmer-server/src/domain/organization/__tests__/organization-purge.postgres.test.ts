/**
 * The organization purge's proof on Postgres (organization-purge-suite.ts
 * says what it pins), on a database of its own; skipped without
 * TEST_DATABASE_URL.
 */
import { afterAll, beforeAll, describe } from "vitest";

import {
  createTestDatabase,
  testDatabaseAdminUrl,
} from "../../../store/postgres/__tests__/support.js";
import type { TestDatabase } from "../../../store/postgres/__tests__/support.js";
import {
  describeOrganizationPurge,
  postgresDatabase,
} from "./organization-purge-suite.js";

describe.skipIf(testDatabaseAdminUrl() === undefined)("on Postgres", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.drop();
  });
  describeOrganizationPurge("postgres", () =>
    postgresDatabase(database.databaseUrl),
  );
});
