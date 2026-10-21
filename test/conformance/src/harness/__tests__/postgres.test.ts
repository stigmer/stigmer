// Pins the Postgres storage seam (../postgres.ts): each provision creates a
// database of its own on the admin server named by CONFORMANCE_POSTGRES_URL,
// selects it for the spawned server by DATABASE_URL, says two servers may
// serve it at once (the rolling update's overlap, TargetProfile.restartServer),
// and drops it on release; with the variable unset, provisioning fails
// loudly. The pg client is stubbed; nothing here reaches a database.
import { afterEach, describe, expect, it, vi } from "vitest";

const queries: string[] = [];

vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect(): Promise<void> {}
      async query(sql: string): Promise<void> {
        queries.push(sql);
      }
      async end(): Promise<void> {}
    },
  },
}));

const { provisionPostgresStorage } = await import("../postgres");

afterEach(() => {
  queries.length = 0;
  vi.unstubAllEnvs();
});

describe("the Postgres storage seam", () => {
  it("creates a database of its own, selects it by DATABASE_URL, takes two servers at once, and drops it on release", async () => {
    vi.stubEnv("CONFORMANCE_POSTGRES_URL", "postgres://admin:pw@127.0.0.1:5432/postgres");
    const storage = await provisionPostgresStorage();
    const name = /^CREATE DATABASE (conformance_[0-9a-f]{16})$/.exec(queries[0] ?? "")?.[1];
    expect(name, `the create statement: ${queries[0]}`).toBeDefined();
    expect(storage.serverEnv).toEqual({ DATABASE_URL: `postgres://admin:pw@127.0.0.1:5432/${name}` });
    expect(storage.sharedByTwoServers).toBe(true);
    await storage.release();
    expect(queries[1]).toBe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  });

  it("fails loudly when CONFORMANCE_POSTGRES_URL is unset", async () => {
    vi.stubEnv("CONFORMANCE_POSTGRES_URL", "");
    await expect(provisionPostgresStorage()).rejects.toThrow(/CONFORMANCE_POSTGRES_URL is not set/);
  });
});
