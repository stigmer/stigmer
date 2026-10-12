/**
 * Pins the composition's one transaction scaffold (../transaction.ts)
 * against a recording client: what reaches the database and how the client
 * goes back to the pool. The release is the point. pg-pool keeps a client
 * released bare and destroys one released with an error, so a client whose
 * ROLLBACK failed must be released with an error, or the next checkout gets
 * a connection still inside an aborted transaction. And the caller always
 * hears the fault that started the rollback, never the rollback's own.
 *
 * No database: each case scripts which statement fails. The sites' own
 * suites, several on a real Postgres, prove each store still behaves.
 */
import { describe, expect, it } from "vitest";

import { inTransaction, withTransaction } from "../transaction.js";

/** The pool and client the scaffold takes, named through it so this suite needs no driver package. */
type Pool = Parameters<typeof inTransaction>[0];
type Client = Parameters<Parameters<typeof inTransaction>[1]>[0];

interface Script {
  /** Statements that throw, by their text ("BEGIN", "COMMIT", "ROLLBACK"). */
  readonly fails?: ReadonlyArray<string>;
  /** Throw a bare string instead of an Error, as a driver may. */
  readonly bare?: boolean;
}

function rig(script: Script = {}) {
  const sql: string[] = [];
  const releases: Array<Error | undefined> = [];
  const client = {
    async query(text: string) {
      sql.push(text);
      if (script.fails?.includes(text)) {
        throw script.bare === true ? `${text} failed` : new Error(`${text} failed`);
      }
      return { rows: [], rowCount: 0 };
    },
    release(error?: Error | boolean) {
      releases.push(error === true ? new Error("destroyed") : error instanceof Error ? error : undefined);
    },
  } as unknown as Client;
  const pool = {
    connect: async () => client,
  } as unknown as Pool;
  return { pool, client, sql, releases };
}

const WORK_FAILED = new Error("the work failed");

describe("inTransaction", () => {
  it("commits work that asks to, answers its value and returns the client to the pool", async () => {
    const r = rig();
    const value = await inTransaction(r.pool, async (client) => {
      await client.query("UPDATE t");
      return { commit: true, value: 7 };
    });
    expect(value).toBe(7);
    expect(r.sql).toEqual(["BEGIN", "UPDATE t", "COMMIT"]);
    expect(r.releases).toEqual([undefined]);
  });

  it("rolls back work that asks not to commit, still answering its value", async () => {
    const r = rig();
    const value = await inTransaction(r.pool, async () => ({ commit: false, value: "unchanged" }));
    expect(value).toBe("unchanged");
    expect(r.sql).toEqual(["BEGIN", "ROLLBACK"]);
    expect(r.releases).toEqual([undefined]);
  });

  it("rolls back work that throws and rethrows its fault, the client back in the pool", async () => {
    const r = rig();
    await expect(
      inTransaction(r.pool, async () => {
        throw WORK_FAILED;
      }),
    ).rejects.toBe(WORK_FAILED);
    expect(r.sql).toEqual(["BEGIN", "ROLLBACK"]);
    expect(r.releases).toEqual([undefined]);
  });

  it("destroys a client whose rollback fails, and the caller still hears the work's fault", async () => {
    const r = rig({ fails: ["ROLLBACK"] });
    await expect(
      inTransaction(r.pool, async () => {
        throw WORK_FAILED;
      }),
    ).rejects.toBe(WORK_FAILED);
    expect(r.releases).toHaveLength(1);
    expect(r.releases[0]?.message).toBe("ROLLBACK failed");
  });

  it("destroys a client whose rollback throws something other than an Error", async () => {
    const r = rig({ fails: ["ROLLBACK"], bare: true });
    await expect(
      inTransaction(r.pool, async () => {
        throw WORK_FAILED;
      }),
    ).rejects.toBe(WORK_FAILED);
    expect(r.releases[0]?.message).toBe("destroyed");
  });

  it("destroys a client whose rollback fails when the work asked not to commit", async () => {
    const r = rig({ fails: ["ROLLBACK"] });
    await expect(inTransaction(r.pool, async () => ({ commit: false, value: 1 }))).rejects.toThrow(
      "ROLLBACK failed",
    );
    expect(r.releases).toHaveLength(1);
    expect(r.releases[0]?.message).toBe("ROLLBACK failed");
  });

  it("runs no work when BEGIN fails, answers that fault, and destroys a client that cannot roll back", async () => {
    const r = rig({ fails: ["BEGIN", "ROLLBACK"] });
    let ran = false;
    await expect(
      inTransaction(r.pool, async () => {
        ran = true;
        return { commit: true, value: 1 };
      }),
    ).rejects.toThrow("BEGIN failed");
    expect(ran).toBe(false);
    expect(r.releases[0]?.message).toBe("ROLLBACK failed");
  });

  it("answers a failed COMMIT as the fault, rolls back, and returns a client whose rollback succeeds", async () => {
    const r = rig({ fails: ["COMMIT"] });
    await expect(inTransaction(r.pool, async () => ({ commit: true, value: 1 }))).rejects.toThrow(
      "COMMIT failed",
    );
    expect(r.sql).toEqual(["BEGIN", "COMMIT", "ROLLBACK"]);
    expect(r.releases).toEqual([undefined]);
  });
});

describe("withTransaction", () => {
  it("always commits the work's value, and keeps the same failure rules", async () => {
    const r = rig();
    expect(await withTransaction(r.pool, async () => "done")).toBe("done");
    expect(r.sql).toEqual(["BEGIN", "COMMIT"]);

    const failing = rig({ fails: ["ROLLBACK"] });
    await expect(
      withTransaction(failing.pool, async () => {
        throw WORK_FAILED;
      }),
    ).rejects.toBe(WORK_FAILED);
    expect(failing.releases[0]?.message).toBe("ROLLBACK failed");
  });
});
