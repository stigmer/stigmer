// Unit arms for the inventory library: the schema, the id discipline, and the
// three coverage invariants. Pure — no target, no filesystem beyond a fixture
// string.
// Domain: conformance inventory.
import { describe, expect, it } from "vitest";
import { computeCoverage, extractTags, parseInventory } from "../inventory";

const ROW = `
rows:
  - id: billing.rpc.adjust-credits.owner-can-adjust
    surface: billing
    lane: rpc.adjustCredits
    behavior: An org owner adjusts credits and the balance reflects the amount.
    java_source: domain/billing/request/handler/AdjustCreditsHandler.java:40
    java_test: none
    class: behavior
    disposition: conformance
    observability: launcher
    caller: primary
    needs: [funded-org]
`;

function withRows(extra: string): string {
  return `${ROW}${extra}`;
}

describe("parseInventory", () => {
  it("accepts a well-formed row and defaults the metrics section", () => {
    const { inventory, problems } = parseInventory(ROW);
    expect(problems).toEqual([]);
    expect(inventory.rows).toHaveLength(1);
    expect(inventory.rows[0]?.disposition).toBe("conformance");
  });

  it("rejects a numeric or single-segment id", () => {
    const bad = ROW.replace("billing.rpc.adjust-credits.owner-can-adjust", "billing.B-RPC-07");
    const { problems } = parseInventory(bad);
    expect(problems.some((p) => p.kind === "schema" && p.message.includes("row id"))).toBe(true);
  });

  it("rejects an id whose surface segment disagrees with the surface field", () => {
    const bad = ROW.replace("surface: billing", "surface: proxy");
    const { problems } = parseInventory(bad);
    expect(problems.some((p) => p.message.includes("first segment must equal its surface"))).toBe(true);
  });

  it("rejects unknown fields and unknown dispositions", () => {
    expect(parseInventory(ROW.replace("needs: [funded-org]", "needs: [funded-org]\n    extra: x")).problems).not.toEqual([]);
    expect(parseInventory(ROW.replace("disposition: conformance", "disposition: someday")).problems).not.toEqual([]);
  });

  it("reports a duplicated id once per repeat", () => {
    const dup = withRows(ROW.replace("rows:\n", ""));
    const { problems } = parseInventory(dup);
    expect(problems.filter((p) => p.kind === "duplicate-id")).toHaveLength(1);
  });
});

describe("extractTags", () => {
  it("finds every bracketed row id in a suite source, ignoring other brackets", () => {
    const source = `it("[billing.rpc.adjust-credits.owner-can-adjust] adjusts", ...); const x = arr[0]; // [proxy.llm.unknown-provider.400]`;
    expect(extractTags(source, "a.test.ts").map((t) => t.id)).toEqual([
      "billing.rpc.adjust-credits.owner-can-adjust",
      "proxy.llm.unknown-provider.400",
    ]);
  });
});

describe("computeCoverage", () => {
  it("passes when every tested row is tagged exactly by existing tests", () => {
    const { inventory } = parseInventory(ROW);
    const coverage = computeCoverage(inventory, [{ id: "billing.rpc.adjust-credits.owner-can-adjust", file: "a.test.ts" }]);
    expect(coverage.problems).toEqual([]);
    expect(coverage.coveredRows).toBe(1);
  });

  it("names an uncovered conformance row", () => {
    const { inventory } = parseInventory(ROW);
    const coverage = computeCoverage(inventory, []);
    expect(coverage.problems.map((p) => p.kind)).toEqual(["uncovered-row"]);
  });

  it("names a tag that points at no row", () => {
    const { inventory } = parseInventory(ROW);
    const coverage = computeCoverage(inventory, [
      { id: "billing.rpc.adjust-credits.owner-can-adjust", file: "a.test.ts" },
      { id: "billing.rpc.nope.nothing", file: "b.test.ts" },
    ]);
    expect(coverage.problems.map((p) => p.kind)).toEqual(["unknown-tag"]);
  });

  it("refuses a tag on a row whose proof lives elsewhere", () => {
    const { inventory } = parseInventory(ROW.replace("disposition: conformance", "disposition: smoke"));
    const coverage = computeCoverage(inventory, [{ id: "billing.rpc.adjust-credits.owner-can-adjust", file: "a.test.ts" }]);
    expect(coverage.problems.map((p) => p.kind)).toEqual(["tag-on-untested-disposition"]);
  });

  it("does not require a tag on unit, smoke, debris or debris-candidate rows", () => {
    for (const disposition of ["unit", "smoke", "debris", "debris-candidate"]) {
      const { inventory } = parseInventory(ROW.replace("disposition: conformance", `disposition: ${disposition}`));
      expect(computeCoverage(inventory, []).problems).toEqual([]);
    }
  });

  it("requires a tag on deviation rows — the suite asserts the contract there", () => {
    const { inventory } = parseInventory(ROW.replace("disposition: conformance", "disposition: deviation"));
    expect(computeCoverage(inventory, []).problems.map((p) => p.kind)).toEqual(["uncovered-row"]);
  });
});
