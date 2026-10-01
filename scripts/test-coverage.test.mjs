// Tests for scripts/test-coverage.mjs: the reading of a run's coverage and
// reports, the floors, and the judgement of a change's added lines.
// Run via `node --test scripts/test-coverage.test.mjs` (wired into root `npm test`).
//
// What these guard: how a path measured on another machine finds its tracked
// file and its package; how shards of one suite merge and when two inputs
// cannot; Istanbul's line and branch shares; that a case reported twice counts
// once; the floors file's shape, the comparison against it and how `--raise`
// lifts it (never lowers it, never from a partial run); which added lines are
// unrun (a statement whose range holds one, not only its first line); which
// changed files are judged, refused as unmeasured, or listed as not measured;
// and, through a throwaway git repository, the command's exit codes end to end.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  addedLines,
  casesByPackage,
  checkChange,
  checkFloors,
  fileTotals,
  floorTo1,
  formatReport,
  headerPath,
  lineHits,
  makeRelativizer,
  measure,
  mergeCoverage,
  packageOf,
  percent,
  raiseFloors,
  readFloors,
  readInputs,
  unrunLines,
} from "./test-coverage.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "test-coverage.mjs");

/** A statement spanning `from` to `to` (lines). */
const at = (from, to = from) => ({ start: { line: from, column: 0 }, end: { line: to, column: 1 } });

/** An Istanbul entry: statements as `[from, to, hits]`, branches as arrays of hits. */
function entry(path, statements, branches = []) {
  return {
    path,
    statementMap: Object.fromEntries(statements.map(([from, to], i) => [String(i), at(from, to)])),
    s: Object.fromEntries(statements.map(([, , hits], i) => [String(i), hits])),
    branchMap: Object.fromEntries(branches.map((counts, i) => [String(i), { type: "if", locations: counts.map(() => at(1)) }])),
    b: Object.fromEntries(branches.map((counts, i) => [String(i), counts])),
    fnMap: {},
    f: {},
  };
}

const floorsOf = (packages, margin = { lines: 0, branches: 0, cases: 0 }) => ({ margin, packages, problems: [] });

// ─── Paths and packages ─────────────────────────────────────────────────

test("a path measured on another machine finds the tracked file it ends with, the longest suffix first", () => {
  const relativize = makeRelativizer(["src/x.ts", "pkg/src/x.ts", "pkg/src/y.ts"]);
  assert.equal(relativize("/home/runner/work/stigmer/stigmer/pkg/src/x.ts"), "pkg/src/x.ts");
  assert.equal(relativize("/Users/someone/checkout/src/x.ts"), "src/x.ts");
  assert.equal(relativize("C:\\work\\pkg\\src\\y.ts"), "pkg/src/y.ts");
  assert.equal(relativize("/tmp/build/generated.ts"), undefined);
});

test("a file belongs to the nearest directory with a package.json, or to the root", () => {
  const dirs = new Set(["sdk/react", "sdk"]);
  assert.equal(packageOf("sdk/react/src/a/b.ts", dirs), "sdk/react");
  assert.equal(packageOf("sdk/other/c.ts", dirs), "sdk");
  assert.equal(packageOf("scripts/x.mjs", dirs), ".");
  assert.equal(packageOf("top.ts", dirs), ".");
});

// ─── Merging and measuring ──────────────────────────────────────────────

test("two shards of one suite merge by summing hits; a file measured from different source is reported, not summed", () => {
  const relativize = makeRelativizer(["p/a.ts", "p/b.ts"]);
  const shard1 = { "/m1/p/a.ts": entry("/m1/p/a.ts", [[1, 1, 1], [2, 2, 0]], [[1, 0]]) };
  const shard2 = {
    "/m2/p/a.ts": entry("/m2/p/a.ts", [[1, 1, 0], [2, 2, 3]], [[0, 2]]),
    "/m2/p/b.ts": entry("/m2/p/b.ts", [[1, 1, 1]]),
    "/m2/gen/c.ts": entry("/m2/gen/c.ts", [[1, 1, 1]]),
  };
  const other = { "/m3/p/b.ts": entry("/m3/p/b.ts", [[1, 1, 1], [2, 2, 1]]) };
  const { files, unmatched, mismatched } = mergeCoverage([shard1, shard2, other], relativize);
  // The same number of statements at other places is other source too, not a shard to sum.
  const moved = { "/m4/p/a.ts": entry("/m4/p/a.ts", [[1, 1, 1], [3, 3, 1]], [[1, 0]]) };
  assert.deepEqual(mergeCoverage([shard1, moved], relativize).mismatched, ["p/a.ts"]);
  assert.deepEqual(files.get("p/a.ts").s, { 0: 1, 1: 3 });
  // A mismatched file keeps the first input's hits; the second is reported, never summed in.
  assert.deepEqual(files.get("p/b.ts").s, { 0: 1 });
  assert.deepEqual(files.get("p/a.ts").b, { 0: [1, 2] });
  assert.deepEqual(unmatched, ["/m2/gen/c.ts"]);
  assert.deepEqual(mismatched, ["p/b.ts"]);
});

test("a line is a statement's start line, counted at its best statement; branches count each outcome", () => {
  const e = entry("p/a.ts", [[1, 1, 0], [1, 3, 2], [4, 4, 0]], [[1, 0], [0, 0, 5]]);
  assert.deepEqual([...lineHits(e)], [[1, 2], [4, 0]]);
  assert.deepEqual(fileTotals(e), { lines: 2, linesCovered: 1, branches: 5, branchesCovered: 2 });
  assert.equal(percent(0, 0), 100);
  assert.equal(percent(1, 4), 25);
});

test("a package's cases are its passed cases; a file two runs report counts once, at the run that passed more; shared titles each count", () => {
  const relativize = makeRelativizer(["p/a.test.ts", "p/c.test.ts", "q/b.test.ts"]);
  const dirs = new Set(["p", "q"]);
  const lane = (name, results) => ({ testResults: [{ name, assertionResults: results }] });
  const reports = [
    lane("/m1/p/a.test.ts", [{ fullName: "a one", status: "passed" }, { fullName: "a two", status: "failed" }]),
    lane("/m2/p/a.test.ts", [{ fullName: "a one", status: "passed" }, { fullName: "a two", status: "passed" }]),
    lane("/m2/p/c.test.ts", [{ fullName: "row", status: "passed" }, { fullName: "row", status: "passed" }]),
    lane("/m2/q/b.test.ts", [{ fullName: "b", status: "skipped" }]),
  ];
  assert.deepEqual([...casesByPackage(reports, relativize, dirs)], [["p", 4], ["q", 0]]);
});

test("a package's figures sum its files; cases are absent when no report named it", () => {
  const files = new Map([
    ["p/a.ts", entry("p/a.ts", [[1, 1, 1], [2, 2, 0]], [[1, 1]])],
    ["p/b.ts", entry("p/b.ts", [[1, 1, 1], [2, 2, 1]], [[0, 0]])],
    ["q/c.ts", entry("q/c.ts", [[1, 1, 0]])],
  ]);
  const measured = measure(files, new Map([["p", 7]]), new Set(["p", "q"]));
  assert.equal(measured.get("p").lines, 75);
  assert.equal(measured.get("p").branches, 50);
  assert.equal(measured.get("p").cases, 7);
  assert.equal(measured.get("q").lines, 0);
  assert.equal(measured.get("q").cases, undefined);
});

// ─── The floors ─────────────────────────────────────────────────────────

test("the floors file is read with its margin and refused when its shape is wrong", () => {
  const good = readFloors(JSON.stringify({ margin: { lines: 0.5 }, packages: { p: { lines: 80, branches: 70, cases: 10 } } }));
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.margin, { lines: 0.5, branches: 0, cases: 0 });
  assert.match(readFloors("{").problems[0], /not JSON/);
  const bad = readFloors(JSON.stringify({ margin: { cases: -1 }, packages: { p: { lines: "80", branches: 70 }, q: { lines: 81.45, branches: 100.1, cases: 2.5 } } }));
  assert.deepEqual(bad.problems, [
    "margin.cases must be a number of zero or more",
    "p: lines must be a number of zero or more",
    "p: cases must be a number of zero or more",
    "q: lines must be a percentage of at most 100 with at most one decimal place",
    "q: branches must be a percentage of at most 100 with at most one decimal place",
    "q: cases must be a whole number",
  ]);
});

test("a floor rounds down to one decimal place and never up", () => {
  assert.equal(floorTo1(81.47), 81.4);
  assert.equal(floorTo1(81.4), 81.4);
  assert.equal(floorTo1(0.1 + 0.2), 0.3);
  assert.equal(floorTo1(100), 100);
});

test("a floor raised from a run, at no margin, never refuses that same run; a hand-set floor is met at its own precision", () => {
  // 814 of 1000 is 81.39999999999999 in binary; 23 of 40 is 57.49999999999999.
  const run = new Map([["p", { lines: percent(814, 1000), branches: percent(23, 40), cases: 3 }]]);
  const raised = raiseFloors(run, floorsOf({}));
  assert.deepEqual(raised.floors.packages.p, { lines: 81.4, branches: 57.5, cases: 3 });
  assert.deepEqual(checkFloors(run, floorsOf(raised.floors.packages)), []);
  assert.deepEqual(checkFloors(run, floorsOf({ p: { lines: 81.5, branches: 57.5, cases: 3 } })).map((f) => f.message), ["lines 81.4% is below its floor of 81.5%"]);
});

test("a measured package below any of its floors, or with none, is refused; one with no report cannot prove its cases", () => {
  const measured = new Map([
    ["above", { lines: 81.5, branches: 70, cases: 10 }],
    ["low", { lines: 79.99, branches: 69.9, cases: 9 }],
    ["new", { lines: 50, branches: 50, cases: 3 }],
    ["silent", { lines: 90, branches: 90, cases: undefined }],
  ]);
  const floors = floorsOf({
    above: { lines: 81.4, branches: 70, cases: 10 },
    low: { lines: 80, branches: 70, cases: 10 },
    silent: { lines: 80, branches: 80, cases: 4 },
    unmeasured: { lines: 99, branches: 99, cases: 99 },
  });
  const findings = checkFloors(measured, floors).map((f) => `${f.rule} ${f.path} ${f.message}`);
  assert.deepEqual(findings, [
    "floor low lines 79.9% is below its floor of 80%",
    "floor low branches 69.9% is below its floor of 70%",
    "floor low 9 cases passed, below its floor of 10",
    "no-floor new measured (lines 50.0%, branches 50.0%, 3 cases) but has no floor; add it to the floors file",
    "floor silent has a floor of 4 cases but no run report was given, so its cases cannot be counted",
  ]);
});

test("raising lifts a floor to the measurement less the margin, never lowers one, and needs every floored package measured", () => {
  const floors = floorsOf(
    { p: { lines: 80, branches: 75, cases: 10 }, q: { lines: 50, branches: 50, cases: 5 } },
    { lines: 0.5, branches: 0.5, cases: 1 },
  );
  const full = new Map([
    ["p", { lines: 82.37, branches: 74, cases: 12 }],
    ["q", { lines: 50.2, branches: 50.2, cases: 5 }],
    ["r", { lines: 0.2, branches: 0, cases: undefined }],
  ]);
  const raised = raiseFloors(full, floors);
  assert.deepEqual(raised.missing, []);
  assert.deepEqual(raised.floors.packages, {
    p: { lines: 81.8, branches: 75, cases: 11 },
    q: { lines: 50, branches: 50, cases: 5 },
    r: { lines: 0, branches: 0, cases: 0 },
  });
  assert.deepEqual(raised.floors.margin, floors.margin);
  // What a raise writes is a floors file the reader accepts, from measurements that are not exact in binary.
  const odd = raiseFloors(new Map([["p", { lines: 0.1 + 0.2, branches: 57.49999999999999, cases: 1 }]]), floorsOf({}));
  assert.deepEqual(odd.floors.packages.p, { lines: 0.3, branches: 57.5, cases: 1 });
  assert.deepEqual(readFloors(JSON.stringify(odd.floors)).problems, []);
  assert.deepEqual(raiseFloors(new Map([["p", full.get("p")]]), floors).missing, ["q"]);
});

// ─── The change ─────────────────────────────────────────────────────────

test("added lines are read from a zero-context diff: hunks, a new file, a rename, a pure deletion", () => {
  const diff = [
    "diff --git a/p/a.ts b/p/a.ts",
    "--- a/p/a.ts",
    "+++ b/p/a.ts",
    "@@ -3,0 +4,2 @@ export function f() {",
    "+  one();",
    "+  two();",
    "@@ -10 +12 @@",
    "-old",
    "+new",
    "diff --git a/p/gone.ts b/p/gone.ts",
    "--- a/p/gone.ts",
    "+++ /dev/null",
    "@@ -1,3 +0,0 @@",
    "diff --git a/p/old.ts b/p/moved.ts",
    "--- a/p/old.ts",
    "+++ b/p/moved.ts",
    "@@ -7,1 +7,0 @@",
    "-dropped",
    "diff --git a/p/new.ts b/p/new.ts",
    "--- /dev/null",
    "+++ b/p/new.ts",
    "@@ -0,0 +1,3 @@",
  ].join("\n");
  const added = addedLines(diff);
  assert.deepEqual([...added.keys()], ["p/a.ts", "p/new.ts"]);
  assert.deepEqual([...added.get("p/a.ts")], [4, 5, 12]);
  assert.deepEqual([...added.get("p/new.ts")], [1, 2, 3]);
});

test("an added line whose text starts `++ ` is a line, not a file header; quoted and spaced paths are read as git wrote them", () => {
  const diff = [
    "diff --git a/p/a.ts b/p/a.ts",
    "--- a/p/a.ts",
    "+++ b/p/a.ts",
    "@@ -1,0 +2,1 @@",
    "+++ counter;",
    "@@ -10,0 +11,1 @@",
    "+x();",
    'diff --git "a/p/q\\"uo.ts" "b/p/q\\"uo.ts"',
    '--- "a/p/q\\"uo.ts"',
    '+++ "b/p/q\\"uo.ts"',
    "@@ -0,0 +1 @@",
    "diff --git a/p/sp ace.ts b/p/sp ace.ts",
    "--- a/p/sp ace.ts\t",
    "+++ b/p/sp ace.ts\t",
    "@@ -0,0 +4 @@",
  ].join("\n");
  const added = addedLines(diff);
  assert.deepEqual([...added.keys()], ["p/a.ts", 'p/q"uo.ts', "p/sp ace.ts"]);
  assert.deepEqual([...added.get("p/a.ts")], [2, 11]);
  assert.equal(headerPath('"b/caf\\303\\251 \\360\\237\\247\\252.ts"'), "b/café 🧪.ts");
  assert.equal(headerPath("/dev/null"), "/dev/null");
});

test("an unrun statement is found on any added line of its range, once, and a statement that ran never is", () => {
  const e = entry("p/a.ts", [[3, 6, 0], [8, 8, 2], [9, 9, 0], [9, 9, 0], [20, 20, 0]]);
  assert.deepEqual(unrunLines(e, new Set([5, 8, 9])), [5, 9]);
  assert.deepEqual(unrunLines(e, new Set([8])), []);
  assert.deepEqual(unrunLines(e, new Set([30])), []);
});

test("a change is judged in measured files, refused where a floored package went unmeasured, and listed elsewhere", () => {
  const dirs = new Set(["p", "q", "r"]);
  const files = new Map([["p/src/a.ts", entry("p/src/a.ts", [[1, 1, 0], [2, 2, 1]])]]);
  const added = new Map([
    ["p/src/a.ts", new Set([1, 2])],
    ["p/src/__tests__/a.test.ts", new Set([1])],
    ["p/src/types.d.ts", new Set([1])],
    ["p/README.md", new Set([1])],
    ["p/scripts/build.mjs", new Set([1])],
    ["q/src/b.ts", new Set([1])],
    ["r/src/c.ts", new Set([1])],
  ]);
  const floors = floorsOf({ p: { lines: 0, branches: 0, cases: 0 }, q: { lines: 0, branches: 0, cases: 0 } });
  const { findings, notMeasured } = checkChange(added, files, new Set(["p"]), floors, dirs);
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.path}`), ["unrun p/src/a.ts:1", "unmeasured q/src/b.ts"]);
  assert.match(findings[0].message, /never run by a test \(p's own tests\)/);
  assert.deepEqual(notMeasured, ["p/scripts/build.mjs", "r/src/c.ts"]);
});

test("the report lists findings, each measured package against its floor, and one summary line", () => {
  const text = formatReport({
    findings: [{ rule: "unrun", path: "p/a.ts:3", message: "is never run by a test (p's own tests)" }],
    measured: new Map([["p", { lines: 81.25, branches: 70, cases: 9 }], ["q", { lines: 100, branches: 100, cases: undefined }]]),
    floors: floorsOf({ p: { lines: 80, branches: 70, cases: 9 } }),
    notMeasured: ["scripts/x.mjs"],
    base: "origin/main (abc123456)",
    changedFiles: 2,
    unmatched: ["/m/gen/a.ts", "/m/gen/b.ts", "/m/gen/c.ts", "/m/gen/d.ts"],
  });
  assert.equal(text, [
    "✗ unrun  p/a.ts:3  is never run by a test (p's own tests)",
    "• unmatched  4 measured file(s) match no tracked file and were left out (/m/gen/a.ts, /m/gen/b.ts, /m/gen/c.ts, …)",
    "• measured  p  lines 81.3%, branches 70.0%, 9 cases (floor 80%, 70%, 9)",
    "• measured  q  lines 100.0%, branches 100.0%, cases not reported",
    "• not measured  scripts/x.mjs",
    "test-coverage: 2 package(s) measured, 2 changed file(s) checked against origin/main (abc123456); 1 finding(s)",
  ].join("\n"));
});

// ─── Reading the inputs ─────────────────────────────────────────────────

test("inputs are found at any depth: coverage by its file name, reports by their shape; other JSON is ignored", () => {
  const dir = mkdtempSync(join(tmpdir(), "test-coverage-inputs-"));
  try {
    mkdirSync(join(dir, "lane", "shard-1", "coverage"), { recursive: true });
    writeFileSync(join(dir, "lane", "shard-1", "coverage", "coverage-final.json"), JSON.stringify({ "/x/a.ts": entry("/x/a.ts", [[1, 1, 1]]) }));
    writeFileSync(join(dir, "lane", "shard-1", "coverage", "coverage-summary.json"), JSON.stringify({ total: {} }));
    writeFileSync(join(dir, "lane", "shard-1", "report.json"), JSON.stringify({ testResults: [] }));
    writeFileSync(join(dir, "lane", "package.json"), JSON.stringify({ name: "x" }));
    const inputs = readInputs([dir]);
    assert.equal(inputs.coverage.length, 1);
    assert.equal(inputs.reports.length, 1);
    writeFileSync(join(dir, "broken.json"), "{");
    assert.throws(() => readInputs([dir]), SyntaxError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── The command, end to end ────────────────────────────────────────────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "test-coverage-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  // A user's diff configuration must not change what the command reads (`w/` and `i/` prefixes instead of `b/`).
  git("config", "diff.mnemonicPrefix", "true");
  const write = (path, text) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: dir, encoding: "utf8" });
  return { dir, git, write, run };
}

/** A run's output for pkg/src/a.ts, as if measured on another machine: statements `[from, to, hits]`, and the passed cases. */
function runOutput(r, statements, cases = ["a works"]) {
  const elsewhere = "/home/runner/work/stigmer/stigmer/pkg/src/a.ts";
  r.write("in/lane/coverage/coverage-final.json", JSON.stringify({ [elsewhere]: entry(elsewhere, statements) }));
  r.write("in/lane/report.json", JSON.stringify({
    testResults: [{ name: "/home/runner/work/stigmer/stigmer/pkg/src/__tests__/a.test.ts", assertionResults: cases.map((fullName) => ({ fullName, status: "passed" })) }],
  }));
}

test("the command: an unrun added line is refused and named, a test that runs it clears it, and a raise writes the floors", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/a.ts", "export const a = 1;\n");
    r.write("pkg/src/__tests__/a.test.ts", "it('a works', () => {});\n");
    r.write("floors.json", JSON.stringify({ margin: { lines: 0, branches: 0, cases: 0 }, packages: { pkg: { lines: 50, branches: 0, cases: 1 } } }));
    r.write(".gitignore", "in/\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    r.git("checkout", "-q", "-b", "change");
    r.write("pkg/src/a.ts", "export const a = 1;\nexport function b(x) {\n  if (x) return 2;\n  return 3;\n}\n");
    r.git("commit", "-qam", "b");

    runOutput(r, [[1, 1, 1], [2, 5, 1], [3, 3, 1], [4, 4, 0]]);
    const refused = r.run("--floors", "floors.json", "--input", "in", "--base", "main");
    assert.equal(refused.status, 1, refused.stdout + refused.stderr);
    assert.match(refused.stdout, /^✗ unrun  pkg\/src\/a\.ts:4  is never run by a test \(pkg's own tests\)$/m);
    assert.match(refused.stdout, /• measured  pkg  lines 75\.0%, branches 100\.0%, 1 cases \(floor 50%, 0%, 1\)/);
    assert.match(refused.stdout, /test-coverage: 1 package\(s\) measured, 1 changed file\(s\) checked against main \([0-9a-f]{9}\); 1 finding\(s\)$/m);

    runOutput(r, [[1, 1, 1], [2, 5, 1], [3, 3, 1], [4, 4, 1]], ["a works", "b falls through"]);
    const clean = r.run("--floors", "floors.json", "--input", "in", "--base", "main");
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /; clean$/m);

    const raised = r.run("--floors", "floors.json", "--input", "in", "--raise");
    assert.equal(raised.status, 0, raised.stderr);
    assert.match(raised.stdout, /• raised  pkg  50%, 0%, 1 -> 100%, 100%, 2/);
    assert.deepEqual(JSON.parse(readFileSync(join(r.dir, "floors.json"), "utf8")).packages, { pkg: { lines: 100, branches: 100, cases: 2 } });
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the command: a changed file with a space in its name is judged; a raise reads a run through gh, and a failed download cannot be judged", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/sp ace.ts", "export const a = 1;\n");
    r.write("floors.json", JSON.stringify({ margin: { lines: 0, branches: 0, cases: 0 }, packages: { pkg: { lines: 0, branches: 0, cases: 0 } } }));
    r.write(".gitignore", "in/\nbin/\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    r.git("checkout", "-q", "-b", "change");
    r.write("pkg/src/sp ace.ts", "export const a = 1;\nexport const b = () => 2;\n");
    r.git("commit", "-qam", "b");
    const spaced = "/m/pkg/src/sp ace.ts";
    r.write("in/coverage-final.json", JSON.stringify({ [spaced]: entry(spaced, [[1, 1, 1], [2, 2, 0]]) }));
    const judged = r.run("--floors", "floors.json", "--input", "in", "--base", "main");
    assert.equal(judged.status, 1, judged.stdout + judged.stderr);
    assert.match(judged.stdout, /✗ unrun  pkg\/src\/sp ace\.ts:2  is never run by a test/);

    // A stand-in for gh on PATH: it copies the run's artifacts into --dir, or fails.
    r.write("bin/gh", `#!/bin/sh\nif [ "$3" = "404" ]; then echo "no such run" >&2; exit 1; fi\nwhile [ "$1" != "--dir" ]; do shift; done\nmkdir -p "$2/coverage-lane" && cp "${join(r.dir, "in", "coverage-final.json")}" "$2/coverage-lane/"\n`);
    execFileSync("chmod", ["+x", join(r.dir, "bin", "gh")]);
    const env = { ...process.env, PATH: `${join(r.dir, "bin")}:${process.env.PATH}` };
    const fromRun = spawnSync(process.execPath, [SCRIPT, "--floors", "floors.json", "--from-run", "7", "--raise"], { cwd: r.dir, encoding: "utf8", env });
    assert.equal(fromRun.status, 0, fromRun.stderr);
    assert.deepEqual(JSON.parse(readFileSync(join(r.dir, "floors.json"), "utf8")).packages, { pkg: { lines: 50, branches: 100, cases: 0 } });
    const failed = spawnSync(process.execPath, [SCRIPT, "--floors", "floors.json", "--from-run", "404", "--raise"], { cwd: r.dir, encoding: "utf8", env });
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /could not download run 404's coverage artifacts with gh/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the command: a drop below a floor is refused without a base; no coverage, a bad floors file or a bad flag cannot be judged", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/a.ts", "export const a = 1;\n");
    r.write("floors.json", JSON.stringify({ margin: { lines: 0, branches: 0, cases: 0 }, packages: { pkg: { lines: 90, branches: 0, cases: 0 } } }));
    r.write("bad-floors.json", JSON.stringify({ packages: { pkg: { lines: 90 } } }));
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");

    runOutput(r, [[1, 1, 1], [2, 2, 0]]);
    const low = r.run("--floors", "floors.json", "--input", "in");
    assert.equal(low.status, 1);
    assert.match(low.stdout, /✗ floor  pkg  lines 50% is below its floor of 90%/);

    r.write("empty/note.txt", "nothing measured");
    const nothing = r.run("--floors", "floors.json", "--input", "empty");
    assert.equal(nothing.status, 2);
    assert.match(nothing.stderr, /no coverage-final\.json under the inputs/);

    const shape = r.run("--floors", "bad-floors.json", "--input", "in");
    assert.equal(shape.status, 2);
    assert.match(shape.stderr, /pkg: branches must be a number of zero or more/);

    const partial = r.run("--floors", "floors.json", "--from-run", "1");
    assert.equal(partial.status, 2);
    assert.match(partial.stderr, /--from-run is for --raise only/);

    assert.equal(r.run("--input", "in").status, 2);

    const both = r.run("--floors", "floors.json", "--input", "in", "--from-run", "1", "--raise");
    assert.equal(both.status, 2);
    assert.match(both.stderr, /give --from-run or --input, not both/);

    const foreign = "/elsewhere/untracked/z.ts";
    r.write("foreign/coverage-final.json", JSON.stringify({ [foreign]: entry(foreign, [[1, 1, 1]]) }));
    const unmatched = r.run("--floors", "floors.json", "--input", "foreign");
    assert.equal(unmatched.status, 2, unmatched.stdout);
    assert.match(unmatched.stderr, /none of the 1 measured file\(s\) matches a tracked file \(first: \/elsewhere\/untracked\/z\.ts\)/);

    const a = "/m2/pkg/src/a.ts";
    r.write("split/shard-2/coverage-final.json", JSON.stringify({ [a]: entry(a, [[1, 1, 1], [3, 3, 0]]) }));
    r.write("split/shard-1/coverage-final.json", JSON.stringify({ [a]: entry(a, [[1, 1, 1], [2, 2, 0]]) }));
    const mismatchedRaise = r.run("--floors", "floors.json", "--input", "split", "--raise");
    assert.equal(mismatchedRaise.status, 2);
    assert.match(mismatchedRaise.stderr, /measured pkg\/src\/a\.ts twice with different statements or branches/);
    const mismatchedJudge = r.run("--floors", "floors.json", "--input", "split");
    assert.equal(mismatchedJudge.status, 1);
    assert.match(mismatchedJudge.stdout, /✗ mismatch  pkg\/src\/a\.ts  was measured twice/);

    const json = r.run("--floors", "floors.json", "--input", "in", "--json");
    assert.equal(json.status, 1);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.findings[0].rule, "floor");
    assert.equal(parsed.measured.pkg.lines, 50);

    r.write("two-floors.json", JSON.stringify({ margin: { lines: 0, branches: 0, cases: 0 }, packages: { pkg: { lines: 0, branches: 0, cases: 0 }, other: { lines: 1, branches: 1, cases: 1 } } }));
    const partialRaise = r.run("--floors", "two-floors.json", "--input", "in", "--raise");
    assert.equal(partialRaise.status, 2);
    assert.match(partialRaise.stderr, /not a full run; these packages have floors and were not measured: other/);
    assert.equal(JSON.parse(readFileSync(join(r.dir, "two-floors.json"), "utf8")).packages.other.lines, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("the command: with a base and no coverage, the change alone is judged; a floored package's changed source is refused as unmeasured", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/a.ts", "export const a = 1;\n");
    r.write("tools/run.mjs", "export const run = 1;\n");
    r.write("floors.json", JSON.stringify({ margin: { lines: 0, branches: 0, cases: 0 }, packages: { pkg: { lines: 90, branches: 0, cases: 0 } } }));
    r.write(".gitignore", "empty/\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    r.git("checkout", "-q", "-b", "change");
    r.write("empty/.keep", "");

    // A change outside every package ran no package's tests: nothing to measure, nothing refused.
    r.write("tools/run.mjs", "export const run = 2;\n");
    r.git("commit", "-qam", "tools");
    const outside = r.run("--floors", "floors.json", "--input", "empty", "--base", "main");
    assert.equal(outside.status, 0, outside.stdout + outside.stderr);
    assert.match(outside.stdout, /^• not measured  tools\/run\.mjs$/m);
    assert.match(outside.stdout, /^test-coverage: 0 package\(s\) measured, 1 changed file\(s\) checked against main \([0-9a-f]{9}\); clean$/m);

    // A floored package's source changed and no lane measured it: the change cannot pass unjudged.
    r.write("pkg/src/a.ts", "export const a = 2;\n");
    r.git("commit", "-qam", "pkg");
    const inside = r.run("--floors", "floors.json", "--input", "empty", "--base", "main");
    assert.equal(inside.status, 1, inside.stdout + inside.stderr);
    assert.match(inside.stdout, /^✗ unmeasured  pkg\/src\/a\.ts  changed, but pkg's coverage was not collected in this run/m);

    // Without a base, or for a raise, no coverage still measured nothing.
    assert.equal(r.run("--floors", "floors.json", "--input", "empty").status, 2);
    assert.equal(r.run("--floors", "floors.json", "--input", "empty", "--base", "main", "--raise").status, 2);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
