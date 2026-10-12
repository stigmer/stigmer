/**
 * The Team store's Postgres adapter (../postgres-store.ts) before it
 * reaches the database: a team that is not fully shaped (an id, an
 * organization, a slug and an audit, all set by the create chain) is
 * refused as the programming error it is, with no query made. The
 * adapter's reads and writes against a real table are its Postgres suite's
 * (store.postgres.test.ts).
 */
import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { newTeamStore } from "../postgres-store.js";
import { storedTeam } from "./in-memory-team-store.js";

describe("the Team store's Postgres adapter", () => {
  it("refuses a team its chain did not shape, before any query", async () => {
    const queries: string[] = [];
    const pool = {
      query: (sql: string) => {
        queries.push(sql);
        return Promise.resolve({ rows: [], rowCount: 0 });
      },
    } as unknown as Pool;
    const team = storedTeam({ id: "tm_unshaped", org: "acme", slug: "sre" });
    if (team.metadata !== undefined) {
      team.metadata.org = "";
    }
    await expect(newTeamStore(pool).insert(team)).rejects.toThrow(/fully shaped/);
    expect(queries).toEqual([]);
  });
});
