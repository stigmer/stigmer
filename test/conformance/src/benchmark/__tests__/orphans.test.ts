// Unit arms for the sweep's parsing and its decision of what an attempt left
// running.
// Domain: conformance benchmark.
//
// Pinned: `ps` rows and `lsof` fields parse, anything else is skipped; a
// working directory matches the workspace or a path under it, never a
// sibling sharing its prefix; the runner and everything below it are never
// left behind; candidates are grouped by process group, so one `go run &`
// (the `go` process and its server) is one; a group that is the runner's or
// this process's own is never signalled whole; a candidate gone from the
// table is not counted.
import { describe, expect, it } from "vitest";
import { descendantsOf, leftovers, parsePids, parseProcessTable, pidsUnder } from "../orphans";

const TABLE = parseProcessTable(
  [
    "    1     0     1",
    "  500     1   500", // the benchmark
    "  600   500   500", // the runner, in the benchmark's group
    "  610   600   610", // the runner's agent host
    "  620   610   620", // a command the runner still owns
    "  700     1   700", // a backgrounded `go run`, re-parented away
    "  701   700   700", // the server it built
    "  800     1   500", // a stray in the benchmark's own group
    "not a row",
    "",
  ].join("\n"),
);

describe("parseProcessTable", () => {
  it("reads pid, ppid and pgid per row and skips anything else", () => {
    expect(TABLE).toHaveLength(8);
    expect(TABLE[5]).toEqual({ pid: 700, ppid: 1, pgid: 700 });
  });
});

describe("pidsUnder", () => {
  it("takes the processes working in the directory or under it, never a sibling sharing its prefix", () => {
    const fields = [
      "p700",
      "fcwd",
      "n/tmp/stigmer-benchmark/orders-sync",
      "p701",
      "fcwd",
      "n/tmp/stigmer-benchmark/orders-sync/cmd/server",
      "p702",
      "fcwd",
      "n/tmp/stigmer-benchmark/orders-sync-old",
      "p703",
      "fcwd",
      "n/Users/someone",
    ].join("\n");
    expect(pidsUnder(fields, "/tmp/stigmer-benchmark/orders-sync").sort()).toEqual([700, 701]);
  });
});

describe("parsePids", () => {
  it("reads one pid a line and skips blanks", () => {
    expect(parsePids("701\n\n702\n")).toEqual([701, 702]);
    expect(parsePids("")).toEqual([]);
  });
});

describe("descendantsOf", () => {
  it("is the root and everything below it", () => {
    expect([...descendantsOf(TABLE, 600)].sort()).toEqual([600, 610, 620]);
  });

  it("walks a row that is its own parent once (the kernel's pid 0 on Linux)", () => {
    const table = parseProcessTable("    0     0     0\n    1     0     1\n    2     1     1\n");
    expect([...descendantsOf(table, 0)].sort()).toEqual([0, 1, 2]);
  });
});

describe("leftovers", () => {
  it("groups what is no longer the runner's by process group, and never takes the runner's own", () => {
    expect(leftovers({ table: TABLE, runnerPid: 600, selfPid: 500, working: [620, 700, 701], listening: [701] })).toEqual([
      { pgid: 700, pids: [700, 701], wholeGroup: true },
    ]);
  });

  it("signals only the found processes of a group the runner or this process leads", () => {
    expect(leftovers({ table: TABLE, runnerPid: 600, selfPid: 500, working: [800], listening: [] })).toEqual([
      { pgid: 500, pids: [800], wholeGroup: false },
    ]);
  });

  it("counts nothing gone from the table, and nothing at all when nothing was found", () => {
    expect(leftovers({ table: TABLE, runnerPid: 600, selfPid: 500, working: [999], listening: [] })).toEqual([]);
    expect(leftovers({ table: TABLE, runnerPid: 600, selfPid: 500, working: [], listening: [] })).toEqual([]);
  });
});
