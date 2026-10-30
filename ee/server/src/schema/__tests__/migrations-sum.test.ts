/**
 * Holds the Enterprise chain to its committed `migrations.sum`: the file is
 * the chain's digests, line for line, so a step and its line change
 * together (the server's store/schema-checksum.ts says why each line is
 * frozen once merged). The chain also passes the server's
 * `reviewSchemaChain`: no step unsafe during a roll without its `contract`,
 * no generated code reachable from the chain module.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { renderMigrationSum, reviewSchemaChain } from "@stigmer/server";
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

describe("the Enterprise chain", () => {
  it("passes the schema review", () => {
    expect(
      reviewSchemaChain(
        path.resolve(import.meta.dirname, "..", "enterprise-migrations.ts"),
        ENTERPRISE_MIGRATIONS,
      ),
    ).toEqual([]);
  });
});
