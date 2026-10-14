// The access-history table rows (resources/access-history.ts) for the
// shapes the command's own fixtures do not reach: a grantee written as a
// group with its relation, a non-person grantee, and an entry missing its
// grantee or its resource, each named rather than dropped.

import { create } from "@bufbuild/protobuf";
import { AccessChange, AccessHistoryEntrySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { describe, expect, it } from "vitest";

import { accessHistoryRows, parseAfterSequence } from "../access-history.js";

describe("accessHistoryRows", () => {
  it("names a group by its relation, a non-person by its kind, and leaves a missing grantee or resource blank", () => {
    const rows = accessHistoryRows([
      create(AccessHistoryEntrySchema, {
        sequence: 1n,
        change: AccessChange.granted,
        principal: { kind: "team", id: "tm_core", name: "Core", relation: "member" },
      }),
      create(AccessHistoryEntrySchema, {
        sequence: 2n,
        change: AccessChange.granted,
        principal: { kind: "team", id: "tm_core", name: "Core" },
      }),
      create(AccessHistoryEntrySchema, { sequence: 3n, change: AccessChange.revoked }),
    ]);
    expect(rows.map((row) => [row[0], row[2], row[3], row[5]])).toEqual([
      ["1", "granted", "team Core (members)", ""],
      ["2", "granted", "team Core", ""],
      ["3", "removed", "", ""],
    ]);
  });

  it("reads --after as the last sequence held, 0 when absent", () => {
    expect(parseAfterSequence(undefined)).toBe(0n);
    expect(parseAfterSequence("")).toBe(0n);
    expect(parseAfterSequence("9223372036854775807")).toBe(9223372036854775807n);
  });
});
