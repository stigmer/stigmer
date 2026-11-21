/**
 * The row-kind map and the host-customization contract say the same thing:
 * every kind in the map appears once in the contract's "Every part and its
 * decision" table with the same decision (Open, Closed, Kit-owned, or the
 * tool row's "The row and its step line are closed" for a body a host's
 * card opens), and the table names no kind the map lacks. The contract stays
 * prose a person writes; a drift between the two fails here. The compiler
 * holds the rest: an undecided kind or an unclaimed slot fails typecheck
 * (`row-kinds.ts`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { EVERY_SLOT_CLAIMED, ROW_KINDS, type RowKindDecision } from "../row-kinds";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../../../../.agents/skills/sdk-console-architecture/references/host-customization.md");

/** The decision a table row's decision cell states, by its opening words. */
function decisionOf(cell: string): RowKindDecision["decision"] | undefined {
  if (/^Open\b/.test(cell)) return "open";
  if (/^Kit-owned\b/.test(cell)) return "kit-owned";
  if (/^Closed\b/.test(cell)) return "closed";
  if (/^The row and its step line are closed\b/.test(cell)) return "body";
  return undefined;
}

/** Each row kind the contract's table names, with the decision its row states. */
function contractDecisions(): Array<{ readonly kind: string; readonly decision: RowKindDecision["decision"] | undefined }> {
  const text = readFileSync(contractPath, "utf8");
  const start = text.indexOf("## Every part and its decision");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);
  const rows = section.split("\n").filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));
  const found: Array<{ kind: string; decision: RowKindDecision["decision"] | undefined }> = [];
  // The first row is the table's head.
  for (const row of rows.slice(1)) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    const part = cells[0] ?? "";
    const decision = decisionOf(cells[2] ?? "");
    // Rows that name no row kind (the header, the composer) are parts, not kinds.
    for (const match of part.matchAll(/`([a-z][a-z-]*)`/g)) found.push({ kind: match[1]!, decision });
  }
  return found;
}

describe("the row-kind map", () => {
  it("claims every slot for an open row kind", () => {
    expect(EVERY_SLOT_CLAIMED).toBe(true);
  });

  it("agrees with the contract's table, kind by kind", () => {
    const named = contractDecisions();
    const fromMap = Object.entries(ROW_KINDS)
      .map(([kind, entry]) => ({ kind, decision: entry.decision }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect([...named].sort((a, b) => a.kind.localeCompare(b.kind))).toEqual(fromMap);
  });
});
