/**
 * The row-data map and the host-customization contract say the same thing:
 * every row kind appears once in the contract's "Drawing your own screen"
 * table, naming in backticks exactly the sources and words the map names
 * (a kind with no public data reads "None"), and the table names no kind the
 * map lacks. A source outside the dotted fields is a public name of
 * `@stigmer/react-core`, the package a drawing host installs, with no
 * exception: a host drawing every row needs no other package. The compiler
 * holds the rest: a kind with no entry, or a source that is no public name of
 * the core or no field, fails typecheck (`row-data.ts`).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as core from "@stigmer/react-core";
import { ROW_DATA, type RowData } from "../row-data";
import { ROW_KINDS } from "../row-kinds";

const here = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(here, "../../../../../.agents/skills/sdk-console-architecture/references/host-customization.md");

/** What a map entry names: its sources and words, or "none". */
function namesOf(entry: RowData): readonly string[] | "none" {
  if (entry.reads === "none") return "none";
  return [...entry.reads, ...(entry.words ?? [])].sort();
}

/** Each row kind the contract's table names, with what its reads cell names. */
function contractRows(): Array<{ readonly kind: string; readonly names: readonly string[] | "none" }> {
  const text = readFileSync(contractPath, "utf8");
  const start = text.indexOf("## Drawing your own screen");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, end === -1 ? undefined : end);
  const rows = section.split("\n").filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line));
  const found: Array<{ kind: string; names: readonly string[] | "none" }> = [];
  // The first row is the table's head.
  for (const row of rows.slice(1)) {
    const cells = row.split("|").slice(1, -1).map((cell) => cell.trim());
    const reads = cells[1] ?? "";
    const names = /^None\b/.test(reads) ? "none" : [...reads.matchAll(/`([^`]+)`/g)].map((match) => match[1]!).sort();
    // Rows that name no row kind (the files beside the thread, the
    // conversation's state) are parts, not kinds.
    for (const match of (cells[0] ?? "").matchAll(/`([a-z][a-z-]*)`/g)) found.push({ kind: match[1]!, names });
  }
  return found;
}

describe("the row-data map", () => {
  it("covers the same kinds as the row-kind map", () => {
    expect(Object.keys(ROW_DATA).sort()).toEqual(Object.keys(ROW_KINDS).sort());
  });

  it("reads only the core's public names", () => {
    const outside = Object.entries(ROW_DATA).flatMap(([kind, entry]) =>
      entry.reads === "none" ? [] : entry.reads.filter((source) => !source.includes(".") && !(source in core)).map((source) => ({ kind, source })),
    );
    expect(outside).toEqual([]);
  });

  it("agrees with the contract's table, kind by kind", () => {
    const named = contractRows().sort((a, b) => a.kind.localeCompare(b.kind));
    const fromMap = Object.entries(ROW_DATA)
      .map(([kind, entry]) => ({ kind, names: namesOf(entry) }))
      .sort((a, b) => a.kind.localeCompare(b.kind));
    expect(named).toEqual(fromMap);
  });
});
