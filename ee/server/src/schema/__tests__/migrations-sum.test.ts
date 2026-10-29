/**
 * Holds the Enterprise chain to its committed `migrations.sum`: the file is
 * the chain's digests, line for line, so a step and its line change
 * together (the server's store/schema-checksum.ts says why each line is
 * frozen once merged).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderMigrationSum } from "@stigmer/server";
import { describe, expect, it } from "vitest";

import { ENTERPRISE_MIGRATIONS } from "../enterprise-migrations.js";

describe("the Enterprise chain's migrations.sum", () => {
  it("is the chain's digests", () => {
    expect(
      readFileSync(
        path.resolve(import.meta.dirname, "..", "migrations.sum"),
        "utf8",
      ),
    ).toBe(renderMigrationSum(ENTERPRISE_MIGRATIONS));
  });
});
