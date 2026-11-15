/**
 * What this driver logs about a list-indexed row whose bytes do not decode
 * (stigmer/stigmer#3152): one warning when a list marks it, none from the
 * lists after, and at open one line per kind naming the rows still marked.
 * The contract kit pins the mark itself on both drivers
 * (../../__tests__/store-contract.ts, "list index"); it cannot see a
 * store's logger (interface.ts, StoreOpenOptions), so the logging is
 * proven per driver, the Postgres twin in
 * ../../postgres/__tests__/list-index-repair.postgres.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex } from "../../list-index.js";
import type { StoreLogger } from "../../logger.js";
import { SqliteStore } from "../store.js";

const sessions = declareListIndex({
  kind: ApiResourceKind.session,
  schema: SessionSchema,
  revision: 1,
  keys: {},
});

interface LogLine {
  readonly level: "debug" | "info" | "warn";
  readonly message: string;
  readonly fields: Record<string, unknown> | undefined;
}

function recordingLogger(): StoreLogger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    debug: (message, fields) => lines.push({ level: "debug", message, fields }),
    info: (message, fields) => lines.push({ level: "info", message, fields }),
    warn: (message, fields) => lines.push({ level: "warn", message, fields }),
  };
}

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "stigmer-undecodable-"));
  dbPath = path.join(dir, "stigmer.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes damaged bytes the way a binary that does not know the index writes a row. */
function writeDamaged(ids: ReadonlyArray<string>): void {
  const db = new DatabaseSync(dbPath);
  try {
    for (const id of ids) {
      db.prepare(
        `INSERT OR REPLACE INTO resources (kind, id, data, updated_at)
         VALUES ('session', ?, ?, datetime('now'))`,
      ).run(id, new Uint8Array([0xff, 0xff, 0xff]));
    }
  } finally {
    db.close();
  }
}

describe("a list-indexed row that does not decode", () => {
  it("is warned about once, when a list marks it, and named once per kind at open", async () => {
    const logger = recordingLogger();
    const store = SqliteStore.open(dbPath, logger, { listIndexes: [sessions] });
    try {
      writeDamaged(["ses_b", "ses_a"]);
      logger.lines.length = 0;
      for (let i = 0; i < 3; i++) {
        await store.queryResources(sessions, { org: "acme" });
        await store.queryResourcesForSweep(sessions, {});
      }
      // The unproven arms answer in no set order, so the lines are compared by id.
      const byId = [...logger.lines].sort((a, b) =>
        String(a.fields?.id).localeCompare(String(b.fields?.id)),
      );
      expect(byId).toEqual([
        {
          level: "warn",
          message:
            "list index: a row does not decode; marked, lists skip it until it is rewritten",
          fields: { kind: "session", id: "ses_a" },
        },
        {
          level: "warn",
          message:
            "list index: a row does not decode; marked, lists skip it until it is rewritten",
          fields: { kind: "session", id: "ses_b" },
        },
      ]);
    } finally {
      await store.close();
    }

    const reopened = recordingLogger();
    const again = SqliteStore.open(dbPath, reopened, {
      listIndexes: [sessions],
    });
    try {
      expect(reopened.lines.filter((line) => line.level === "warn")).toEqual([
        {
          level: "warn",
          message:
            "list index: rows do not decode; lists skip them until they are rewritten",
          fields: { kind: "session", rows: 2, ids: ["ses_a", "ses_b"] },
        },
      ]);
      reopened.lines.length = 0;
      await again.queryResources(sessions, {});
      expect(reopened.lines, "a list after open logs nothing").toEqual([]);
    } finally {
      await again.close();
    }
  });

  it("names at most ten ids in the line at open, with the whole count", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `ses_${String(i).padStart(2, "0")}`,
    );
    const first = SqliteStore.open(dbPath, undefined, {
      listIndexes: [sessions],
    });
    await first.close();
    writeDamaged(ids);

    const logger = recordingLogger();
    const store = SqliteStore.open(dbPath, logger, { listIndexes: [sessions] });
    try {
      expect(logger.lines.filter((line) => line.level === "warn")).toEqual([
        {
          level: "warn",
          message:
            "list index: rows do not decode; lists skip them until they are rewritten",
          fields: { kind: "session", rows: 12, ids: ids.slice(0, 10) },
        },
      ]);
      logger.lines.length = 0;
      await store.queryResources(sessions, {});
      expect(logger.lines, "the open marked them; no list warns again").toEqual(
        [],
      );
    } finally {
      await store.close();
    }
  });
});
