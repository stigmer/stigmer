/**
 * The late-bound name table (../late-name-table.ts). Pins:
 *   - a read before the composition hands the table over is a boot-order
 *     error naming the unit, never a silent miss;
 *   - once filled, every method forwards to the composed table with its
 *     arguments and answers its answer.
 */
import { describe, expect, it } from "vitest";

import type {
  ResourceNameEntry,
  ResourceNameRename,
  ResourceNameStore,
} from "@stigmer/server";

import { lateNameTable } from "../late-name-table.js";

const KEY = { kind: "team", org: "org_acme", name: "platform" };
const ENTRY: ResourceNameEntry = {
  ...KEY,
  id: "tem_1",
  state: "current",
  claimedAt: "2026-10-12T00:00:00.000Z",
  expiresAt: "",
};
const MOVE: ResourceNameRename = {
  kind: "team",
  org: "org_acme",
  id: "tem_1",
  from: "platform",
  to: "infra",
  fromExpiresAt: "",
  now: "2026-10-12T00:00:00.000Z",
};

const HOLDER = { kind: "team", org: "org_acme", id: "tem_1" };

describe("lateNameTable", () => {
  it("refuses a read before the hand-over, naming the unit", () => {
    const late = lateNameTable("the test unit");
    expect(() => late.names.resourceNames.resolve(KEY, "now")).toThrow(
      /the test unit read the name table before the composition handed it over/,
    );
  });

  it("forwards every method to the composed table once filled", async () => {
    const calls: Array<[string, unknown[]]> = [];
    const record =
      <T>(name: string, answer: T) =>
      (...args: unknown[]): Promise<T> => {
        calls.push([name, args]);
        return Promise.resolve(answer);
      };
    const composed: ResourceNameStore = {
      resolve: record("resolve", ENTRY),
      current: record("current", ENTRY),
      currentMany: record("currentMany", [ENTRY]),
      claim: record("claim", { claimed: true, entry: ENTRY }),
      rename: record("rename", { claimed: true, entry: ENTRY }),
      revertRename: record("revertRename", undefined),
      release: record("release", undefined),
      releaseName: record("releaseName", undefined),
    };
    const late = lateNameTable("the test unit");
    late.fill(composed);
    const names = late.names.resourceNames;

    expect(await names.resolve(KEY, "now")).toBe(ENTRY);
    expect(await names.current("team", "org_acme", "tem_1")).toBe(ENTRY);
    expect(await names.currentMany([HOLDER])).toEqual([ENTRY]);
    expect(await names.claim(KEY, "tem_1", "now")).toEqual({ claimed: true, entry: ENTRY });
    expect(await names.rename(MOVE)).toEqual({ claimed: true, entry: ENTRY });
    await names.revertRename(MOVE, ENTRY);
    await names.release("team", "org_acme", "tem_1");
    await names.releaseName(KEY, "tem_1");

    expect(calls).toEqual([
      ["resolve", [KEY, "now"]],
      ["current", ["team", "org_acme", "tem_1"]],
      ["currentMany", [[HOLDER]]],
      ["claim", [KEY, "tem_1", "now"]],
      ["rename", [MOVE]],
      ["revertRename", [MOVE, ENTRY]],
      ["release", ["team", "org_acme", "tem_1"]],
      ["releaseName", [KEY, "tem_1"]],
    ]);
  });
});
