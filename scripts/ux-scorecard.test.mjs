// Tests for scripts/ux-scorecard.mjs, the table of every UX promise with the
// tests that hold it and how they did.
// Run via `node --test scripts/ux-scorecard.test.mjs` (wired into root `npm test`).
//
// What these guard: which runner a holding file needs and the package it runs
// in; the runs planned (one vitest run per package, one node run for the
// tooling tests, the smokes only when asked) and their command lines; how an
// inventory key meets a report's (exactly, or by shape for a template title);
// a reporter's absolute paths read as the repository's; a case with no result
// reading "not run", never a pass; each promise's verdict and cell (passing,
// failing, not run, open, held in part); the planted-bug line, counted by the
// sweep's own summary; the text and Markdown tables; and, through a
// throwaway git repository, the command reading reports it is handed.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { typeScriptCandidates } from "./test-integrity.mjs";
import { readBar } from "./ux-bar.mjs";
import {
  caseStatus,
  commandOf,
  formatScorecard,
  keyMatcher,
  mutationLine,
  NODE_REPORTER,
  packageOf,
  placeOf,
  planRuns,
  resultsByFile,
  runnerOf,
  VISUAL_REPORTER,
  VISUAL_RUNNER,
  scoreRows,
  summaryLine,
} from "./ux-scorecard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const MANIFESTS = new Set(["client-apps/cli", "sdk/ink"]);
const hasManifest = (dir) => MANIFESTS.has(dir);

test("runs a vitest file in its package, a tooling test with node's runner, and a smoke as a smoke", () => {
  assert.equal(runnerOf("client-apps/cli/src/__tests__/command-sweep.test.ts"), "vitest");
  assert.equal(runnerOf("sdk/ink/src/__tests__/session-frames.test.tsx"), "vitest");
  assert.equal(runnerOf("scripts/ux-bar.test.mjs"), "node");
  assert.equal(runnerOf("test/install/lib/type-checker.test.mjs"), "node");
  assert.equal(runnerOf("test/install/smoke-libs.mjs"), "smoke");
  assert.equal(runnerOf("test/visual/tests/gallery.spec.ts"), "visual");
  assert.equal(runnerOf("test/e2e/tests/functional/accessibility.spec.ts"), "vitest", "only the visual suite's specs run as the visual suite");
  assert.equal(packageOf("client-apps/cli/src/output/__tests__/x.test.ts", hasManifest), "client-apps/cli");
  assert.equal(packageOf("loose/__tests__/x.test.ts", hasManifest), ".");
});

test("plans one vitest run per package, one node run, and the smokes and the visual suite only when asked", () => {
  const paths = [
    "client-apps/cli/src/output/__tests__/a.test.ts",
    "sdk/ink/src/__tests__/b.test.tsx",
    "client-apps/cli/src/__tests__/c.test.ts",
    "client-apps/cli/src/__tests__/c.test.ts",
    "scripts/d.test.mjs",
    "test/install/smoke-libs.mjs",
    "test/visual/tests/gallery.spec.ts",
  ];
  assert.deepEqual(planRuns(paths, hasManifest), [
    { kind: "vitest", cwd: "client-apps/cli", files: ["src/__tests__/c.test.ts", "src/output/__tests__/a.test.ts"], report: "vitest-client-apps-cli.json" },
    { kind: "vitest", cwd: "sdk/ink", files: ["src/__tests__/b.test.tsx"], report: "vitest-sdk-ink.json" },
    { kind: "node", cwd: ".", files: ["scripts/d.test.mjs"], report: "node-tooling.json" },
  ]);
  assert.deepEqual(planRuns(paths, hasManifest, { smoke: true }).at(-1), { kind: "smoke", cwd: ".", files: ["test/install/smoke-libs.mjs"], report: "smoke-libs.json" });
  assert.deepEqual(planRuns(paths, hasManifest, { visual: true }).at(-1), { kind: "visual", cwd: ".", files: ["tests/gallery.spec.ts"], report: "visual.json" });
});

test("writes each run's report through vitest's JSON reporter or the node reporter", () => {
  assert.deepEqual(commandOf({ kind: "vitest", files: ["src/a.test.ts"] }, "/r/v.json", "/repo"), [
    "npx",
    ["vitest", "run", "src/a.test.ts", "--reporter=json", "--outputFile=/r/v.json"],
  ]);
  const reporter = ["--test-reporter", join("/repo", NODE_REPORTER), "--test-reporter-destination", "/r/n.json"];
  assert.deepEqual(commandOf({ kind: "node", files: ["scripts/a.test.mjs"] }, "/r/n.json", "/repo"), [process.execPath, ["--test", ...reporter, "scripts/a.test.mjs"]]);
  assert.deepEqual(commandOf({ kind: "smoke", files: ["test/install/smoke-libs.mjs"] }, "/r/n.json", "/repo"), [process.execPath, [...reporter, "test/install/smoke-libs.mjs", "--skip-build"]]);
  assert.deepEqual(commandOf({ kind: "visual", files: ["tests/gallery.spec.ts"] }, "/r/vis.json", "/repo"), [
    process.execPath,
    [join("/repo", VISUAL_RUNNER), "tests/gallery.spec.ts", `--reporter=list,${join("/repo", VISUAL_REPORTER)}`],
    { STIGMER_VISUAL_REPORT: "/r/vis.json" },
  ]);
});

test("matches a key exactly, and a template title by its shape", () => {
  assert.equal(keyMatcher("CLI-04 errors > Unavailable")("CLI-04 errors > Unavailable"), true);
  assert.equal(keyMatcher("CLI-04 errors > Unavailable")("CLI-04 errors > Unavailable (debug)"), false);
  assert.equal(keyMatcher("CLI-04 errors (a.b) > x")("CLI-04 errors (aXb) > x"), false, "text outside a placeholder is literal");
  const each = keyMatcher("CLI-04 errors > formats $name for $code");
  assert.equal(each("CLI-04 errors > formats NotFound for 5"), true);
  assert.equal(each("CLI-04 errors > formats NotFound"), false);
  assert.equal(keyMatcher("x > renders %s at 100%%")("x > renders loading at 100%"), true);
  assert.equal(keyMatcher("x > `INK-01 renders ${name} at ${cols}`")("x > INK-01 renders tools at 80"), true);
});

test("reads a report's absolute paths as the repository's, and every result under its key", () => {
  const reports = [
    {
      testResults: [
        { name: "/real/repo/a/b.test.ts", assertionResults: [{ ancestorTitles: ["CLI-01 data", "inner"], title: "x", status: "passed" }] },
        { name: 42, assertionResults: [] },
      ],
    },
    { testResults: [{ name: "/link/repo/scripts/c.test.mjs", assertionResults: [{ ancestorTitles: [], title: "y", status: "failed" }] }] },
  ];
  const real = (p) => p.replace("/link/", "/real/");
  const byFile = resultsByFile(reports, "/link/repo", real);
  assert.deepEqual([...byFile.keys()], ["a/b.test.ts", "scripts/c.test.mjs"]);
  assert.deepEqual(byFile.get("a/b.test.ts"), [{ key: "CLI-01 data > inner > x", status: "passed" }]);
});

test("reads a case with no result as not run, never a pass", () => {
  const byFile = new Map([["a.test.ts", [{ key: "k", status: "passed" }, { key: "s", status: "skipped" }, { key: "e > 1", status: "passed" }, { key: "e > 2", status: "failed" }]]]);
  assert.equal(caseStatus({ path: "a.test.ts", key: "k" }, byFile), "passed");
  assert.equal(caseStatus({ path: "a.test.ts", key: "s" }, byFile), "skipped");
  assert.equal(caseStatus({ path: "a.test.ts", key: "e > $n" }, byFile), "failed", "one failed row of an each fails it");
  assert.equal(caseStatus({ path: "a.test.ts", key: "gone" }, byFile), "not run");
  assert.equal(caseStatus({ path: "other.test.ts", key: "k" }, byFile), "not run");
});

test("names a holding file by its package's folder and its name", () => {
  assert.equal(placeOf("client-apps/cli/src/__tests__/command-sweep.test.ts"), "cli/command-sweep");
  assert.equal(placeOf("client-apps/cli/src/output/__tests__/human.goldens.test.ts"), "cli/human.goldens");
  assert.equal(placeOf("sdk/ink/src/__tests__/session-frames.test.tsx"), "ink/session-frames");
  assert.equal(placeOf("test/install/smoke-libs.mjs"), "smoke-libs");
  assert.equal(placeOf("test/visual/tests/gallery.spec.ts"), "visual/gallery");
  assert.equal(placeOf("scripts/ux-bar.test.mjs"), "scripts/ux-bar");
});

function bar() {
  return readBar(JSON.stringify({
    surfaces: { CLI: "the CLI", INK: "the kit" },
    promises: [
      { id: "CLI-01", promise: "Data goes to stdout and everything else to stderr; -o json prints clean data." },
      { id: "CLI-02", promise: "Every command that prints machine output accepts -o.", pending: ["stigmer#2620"] },
      { id: "CLI-03", promise: "A usage error exits 2.", pending: ["stigmer#2620"] },
      { id: "INK-01", promise: "Every state has a frame." },
      { id: "INK-02", promise: "An approval waits." },
    ],
  }));
}

const HOLDERS = new Map([
  ["CLI-01", [{ path: "client-apps/cli/src/output/__tests__/a.test.ts", key: "CLI-01 x" }]],
  ["CLI-02", [
    { path: "client-apps/cli/src/__tests__/command-sweep.test.ts", key: "CLI-02 sweep > one" },
    { path: "client-apps/cli/src/__tests__/command-sweep.test.ts", key: "CLI-02 sweep > two" },
  ]],
  ["CLI-03", []],
  ["INK-01", [{ path: "sdk/ink/src/__tests__/session-frames.test.tsx", key: "INK-01 frames > a" }, { path: "sdk/ink/src/__tests__/session-frames.test.tsx", key: "INK-01 frames > b" }]],
  ["INK-02", [{ path: "sdk/ink/src/__tests__/components.test.tsx", key: "INK-02 waits" }]],
]);

const BY_FILE = new Map([
  ["client-apps/cli/src/output/__tests__/a.test.ts", [{ key: "CLI-01 x", status: "passed" }]],
  ["client-apps/cli/src/__tests__/command-sweep.test.ts", [{ key: "CLI-02 sweep > one", status: "passed" }, { key: "CLI-02 sweep > two", status: "passed" }]],
  ["sdk/ink/src/__tests__/session-frames.test.tsx", [{ key: "INK-01 frames > a", status: "passed" }, { key: "INK-01 frames > b", status: "failed" }]],
]);

test("scores each promise: passing, held in part, open, failing, and not run", () => {
  const rows = scoreRows(bar(), HOLDERS, BY_FILE);
  assert.deepEqual(rows.map((r) => [r.id, r.verdict, r.cell]), [
    ["CLI-01", "passed", "✓ cli/a (1 case)"],
    ["CLI-02", "passed", "✓ cli/command-sweep (2 cases) · open stigmer#2620"],
    ["CLI-03", "open", "open stigmer#2620"],
    ["INK-01", "failed", "✗ ink/session-frames (1 of 2 cases failed)"],
    ["INK-02", "not run", "not run ink/components (1 case)"],
  ]);
  assert.equal(summaryLine(rows), "ux-scorecard: 5 promise(s): 2 held and passing (1 of them in part), 1 failing, 1 not run, 1 open");
});

test("lists at most two places for a promise held in many files", () => {
  const holders = new Map([["CLI-01", ["a", "b", "c"].map((n) => ({ path: `client-apps/cli/src/__tests__/${n}.test.ts`, key: "CLI-01 x" }))]]);
  const byFile = new Map(["a", "b", "c"].map((n) => [`client-apps/cli/src/__tests__/${n}.test.ts`, [{ key: "CLI-01 x", status: "passed" }]]));
  const one = readBar(JSON.stringify({ surfaces: { CLI: "c" }, promises: [{ id: "CLI-01", promise: "p" }] }));
  assert.equal(scoreRows(one, holders, byFile)[0].cell, "✓ cli/a, cli/b +1 (3 cases)");
});

test("counts planted bugs as the sweep's own summary does", () => {
  assert.equal(mutationLine([]), undefined);
  const mutant = (id, status, line) => ({ id, mutatorName: "EqualityOperator", replacement: "<=", status, location: { start: { line, column: 1 }, end: { line, column: 2 } } });
  const report = {
    files: {
      "src/command-tree.ts": {
        source: "a\nb\nc\nd\ne\n",
        mutants: [mutant("1", "Killed", 1), mutant("2", "Killed", 2), mutant("3", "Survived", 3), mutant("4", "NoCoverage", 4), mutant("5", "Ignored", 5)],
      },
    },
  };
  assert.equal(
    mutationLine([{ package: "client-apps/cli", report, confirmed: {} }]),
    "planted bugs caught: 2 of 4 (1 not noticed, 1 never run; 1 disabled with a reason)",
  );
});

test("prints the table as text, truncating long promises, and as Markdown", () => {
  const rows = scoreRows(bar(), HOLDERS, BY_FILE);
  const text = formatScorecard(rows, { mutation: "planted bugs caught: 1 of 1 (0 not noticed, 0 never run; 0 disabled with a reason)" }).split("\n");
  assert.equal(text[0], `CLI-01  ${"Data goes to stdout and everything else to stderr; -o json…".padEnd(60)}  ✓ cli/a (1 case)`);
  assert.equal(text.at(-2), "planted bugs caught: 1 of 1 (0 not noticed, 0 never run; 0 disabled with a reason)");
  assert.match(text.at(-1), /^ux-scorecard: 5 promise\(s\)/);
  const markdown = formatScorecard(rows, { format: "markdown" }).split("\n");
  assert.deepEqual(markdown.slice(0, 3), [
    "| Promise | | Held by / open |",
    "| --- | --- | --- |",
    "| CLI-01 | Data goes to stdout and everything else to stderr; -o json prints clean data. | ✓ cli/a (1 case) |",
  ]);
});

test("the command: reads the reports it is handed and refuses what it cannot judge", () => {
  const dir = mkdtempSync(join(tmpdir(), "ux-scorecard-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    const write = (path, text) => {
      mkdirSync(join(dir, dirname(path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    git("init", "-q", "-b", "main");
    write("test/ux-bar.json", JSON.stringify({ surfaces: { CLI: "c" }, promises: [{ id: "CLI-01", promise: "held" }, { id: "CLI-02", promise: "open", pending: ["stigmer#1"] }] }));
    write("pkg/package.json", "{}");
    write("pkg/src/__tests__/a.test.ts", `it("CLI-01 holds it", () => {});`);
    git("add", ".");
    write("reports/vitest-pkg.json", JSON.stringify({ testResults: [{ name: join(dir, "pkg/src/__tests__/a.test.ts"), assertionResults: [{ ancestorTitles: [], title: "CLI-01 holds it", status: "passed" }] }] }));
    const typescript = typeScriptCandidates(ROOT).flatMap((d) => ["--typescript", d]);
    const run = (...args) => spawnSync(process.execPath, [join(HERE, "ux-scorecard.mjs"), ...typescript, ...args], { cwd: dir, encoding: "utf8" });

    const printed = run("--input", "reports");
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /^CLI-01 {2}held {2,}✓ pkg\/a \(1 case\)$/m);
    assert.match(printed.stdout, /^CLI-02 {2}open {2,}open stigmer#1$/m);
    assert.match(printed.stdout, /ux-scorecard: 2 promise\(s\): 1 held and passing \(0 of them in part\), 0 failing, 0 not run, 1 open/);

    assert.match(run("--input", "nowhere").stdout, /^CLI-01 .*not run pkg\/a \(1 case\)$/m, "no report is not run");
    assert.equal(run().status, 2, "no --input");
    assert.equal(run("--input", "reports", "--format", "html").status, 2);
    write("test/ux-bar.json", "{");
    assert.equal(run("--input", "reports").status, 2, "a malformed bar");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
