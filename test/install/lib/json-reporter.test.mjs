// Tests for test/install/lib/json-reporter.mjs: `node:test` events folded into
// vitest's JSON report shape.
// Run via `node --test test/install/lib/json-reporter.test.mjs` (wired into root `npm test`).
//
// What these pin: each case's describe chain, title, full name and status
// (passed, failed with its message, skipped, todo as pending); suites left
// out; cases grouped by file; the totals; and, end to end, that the
// reporter applies to a plain script run as `node --test-reporter=… script`
// with the human reporter beside it, which is how the install smokes run.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { collectReport } from "./json-reporter.mjs";

const REPORTER = fileURLToPath(new URL("./json-reporter.mjs", import.meta.url));

/** This process's environment without the runner's context variable. */
function withoutTestContext() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

const start = (name, nesting = 0, file = "/a.mjs") => ({ type: "test:start", data: { name, nesting, file } });
const pass = (name, nesting = 0, extra = {}, file = "/a.mjs") => ({
  type: "test:pass",
  data: { name, nesting, file, details: { type: "test" }, ...extra },
});

test("collectReport keys each case by its describe chain and title, and leaves suites out", () => {
  const report = collectReport([
    start("top"),
    pass("top"),
    start("outer"),
    start("inner", 1),
    start("deep", 2),
    pass("deep", 2),
    pass("inner", 1, { details: { type: "suite" } }),
    start("sibling", 1),
    pass("sibling", 1),
    pass("outer", 0, { details: { type: "suite" } }),
  ]);
  assert.deepEqual(
    report.testResults[0].assertionResults.map((c) => [c.ancestorTitles, c.title, c.fullName]),
    [
      [[], "top", "top"],
      [["outer", "inner"], "deep", "outer inner deep"],
      [["outer"], "sibling", "outer sibling"],
    ],
  );
});

test("collectReport maps pass, fail, skip and todo to vitest's statuses, with the failure's message", () => {
  const cause = new Error("expected 1 to be 2");
  const report = collectReport([
    start("ok"),
    pass("ok"),
    start("broken"),
    { type: "test:fail", data: { name: "broken", nesting: 0, file: "/a.mjs", details: { type: "test", error: Object.assign(new Error("test failed"), { cause }) } } },
    start("skipped"),
    pass("skipped", 0, { skip: "not on this platform" }),
    start("later"),
    pass("later", 0, { todo: true }),
    { type: "test:diagnostic", data: { message: "tests 4" } },
  ]);
  const [file] = report.testResults;
  assert.deepEqual(
    file.assertionResults.map((c) => [c.title, c.status, c.failureMessages]),
    [
      ["ok", "passed", []],
      ["broken", "failed", ["expected 1 to be 2"]],
      ["skipped", "skipped", []],
      ["later", "pending", []],
    ],
  );
  assert.equal(file.status, "failed");
  assert.deepEqual(
    [report.numTotalTests, report.numPassedTests, report.numFailedTests, report.numPendingTests, report.success],
    [4, 1, 1, 2, false],
  );
});

test("collectReport groups cases by file and keeps each file's chain apart", () => {
  const report = collectReport([
    start("suite", 0, "/a.mjs"),
    start("one", 0, "/b.mjs"),
    pass("one", 0, {}, "/b.mjs"),
    start("two", 1, "/a.mjs"),
    pass("two", 1, {}, "/a.mjs"),
  ]);
  assert.deepEqual(
    report.testResults.map((f) => [f.name, f.status, f.assertionResults.map((c) => c.fullName)]),
    [
      ["/b.mjs", "passed", ["one"]],
      ["/a.mjs", "passed", ["suite two"]],
    ],
  );
  assert.equal(collectReport([]).success, true);
});

test("the reporter applies to a plain script beside the human reporter, and writes the report file", () => {
  // The real path: the runner names a file by it (macOS links /var to /private/var).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "json-reporter-")));
  try {
    const script = join(dir, "cases.mjs");
    writeFileSync(
      script,
      [
        'import { describe, test } from "node:test";',
        'test("first case", () => {});',
        'describe("a group", () => { test("second case", () => { throw new Error("nope"); }); });',
      ].join("\n"),
    );
    const out = join(dir, "report.json");
    const run = spawnSync(
      process.execPath,
      ["--test-reporter=spec", "--test-reporter-destination=stdout", `--test-reporter=${REPORTER}`, `--test-reporter-destination=${out}`, script],
      // Under `node --test` the child inherits NODE_TEST_CONTEXT and would
      // stream its events to this runner instead of to its own reporters.
      { encoding: "utf8", env: withoutTestContext() },
    );
    assert.equal(run.status, 1, "a failing case fails the script");
    assert.match(run.stdout, /first case/, "the human reporter still prints");
    const report = JSON.parse(readFileSync(out, "utf8"));
    assert.equal(report.testResults[0].name, script);
    assert.deepEqual(
      report.testResults[0].assertionResults.map((c) => [c.ancestorTitles, c.title, c.status, c.failureMessages]),
      [
        [[], "first case", "passed", []],
        [["a group"], "second case", "failed", ["nope"]],
      ],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
