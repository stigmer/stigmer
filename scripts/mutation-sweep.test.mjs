// Tests for scripts/mutation-sweep.mjs: the targets file, the Stryker config
// it writes, the reading of Stryker's report, and the issue it keeps.
// Run via `node --test scripts/mutation-sweep.test.mjs` (wired into root `npm test`).
//
// What these guard: a targets file of the wrong shape is refused before a
// sweep starts; every target's config skips static mutants, writes only the
// JSON report, points every output outside the tree and removes its sandbox;
// a finding is named by what changed and where, not by Stryker's id or its
// line, so a line moved by an edit above it keeps its name and two identical
// changes in one file stay two; only the changes no test noticed and the lines
// no test runs are findings, listed apart; a `// Stryker disable` comment
// without a reason is listed; the issue body carries its target and its keys
// back to the next run; the confirm step applies a change for real, keeps
// Stryker's verdict only when every related test stays green, always restores
// the file and refuses one with uncommitted changes, and its cached verdicts
// drop a refuted finding; blanked strings and emptied objects are listed apart
// as probably harmless; and the publish plan creates, rewrites, comments,
// closes and reopens exactly when it should. Through a fake `gh` on PATH, the
// command's `--report --publish` and `--failed` end to end.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyChange,
  compareRuns,
  confirmFindings,
  findingKey,
  hasWork,
  keysFromBody,
  oneLine,
  publishPlan,
  readTargets,
  reasonlessDisables,
  renderIssue,
  sliceSource,
  strykerConfig,
  summarize,
  targetMarker,
  toConfirm,
} from "./mutation-sweep.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "mutation-sweep.mjs");

const TARGET = {
  title: "the credit gate",
  package: "backend/services/example",
  mutate: ["src/gate/**/*.ts", "!src/gate/**/__tests__/**"],
  concurrency: 2,
};

const SOURCE = ["export function allowed(used: number, cap: number): boolean {", "  if (used < cap && cap > 0) return true;", "  return used < cap;", "}", ""].join("\n");

/** A Stryker mutant at line `line`, columns `from` to `to` (end exclusive). */
function mutant(id, status, mutatorName, line, from, to, replacement, coveredBy = []) {
  return { id, status, mutatorName, replacement, coveredBy, location: { start: { line, column: from }, end: { line, column: to } } };
}

/** A report for one file with these mutants and one test file naming the tests. */
function report(mutants, source = SOURCE) {
  return {
    schemaVersion: "2",
    thresholds: { high: 80, low: 60 },
    files: { "src/gate/allowed.ts": { language: "typescript", source, mutants } },
    testFiles: { "src/gate/__tests__/allowed.test.ts": { tests: [{ id: "t1", name: "allows a run under the cap" }, { id: "t2", name: "refuses a run at the cap" }] } },
  };
}

// ─── The targets file ───────────────────────────────────────────────────

test("a well-formed targets file reads with no problems", () => {
  const { targets, problems } = readTargets(JSON.stringify({ targets: { "credit-gate": TARGET } }));
  assert.deepEqual(problems, []);
  assert.equal(targets["credit-gate"].package, "backend/services/example");
});

test("a targets file of the wrong shape names every problem", () => {
  assert.match(readTargets("{").problems[0], /not JSON/);
  assert.deepEqual(readTargets("{}").problems, ['needs a "targets" object']);
  const { problems } = readTargets(
    JSON.stringify({ targets: { Bad_Name: { title: "", package: "../escape", mutate: ["!only/excludes/**"], concurrency: 0 } } }),
  );
  assert.equal(problems.length, 5);
  assert.ok(problems.some((p) => p.includes('"package"')));
  assert.ok(problems.some((p) => p.includes('"mutate"')));
  assert.ok(problems.some((p) => p.includes('"concurrency"')));
});

test("every target's config skips static mutants, writes only JSON, keeps outputs outside the tree, removes its sandbox", () => {
  const config = strykerConfig(TARGET, "/out/credit-gate");
  assert.equal(config.testRunner, "vitest");
  assert.deepEqual(config.checkers, ["typescript"]);
  assert.ok(config.plugins.includes("@stryker-mutator/typescript-checker"));
  assert.equal(config.dryRunTimeoutMinutes, 60);
  assert.equal(config.testFiles, undefined, "every test that imports a file counts, never only the target's own");
  assert.equal(config.ignoreStatic, true);
  assert.deepEqual(config.reporters, ["json", "progress"]);
  assert.ok(!config.reporters.includes("dashboard"));
  assert.equal(config.jsonReporter.fileName, "/out/credit-gate/mutation.json");
  assert.equal(config.incrementalFile, "/out/credit-gate/stryker-incremental.json");
  assert.equal(config.cleanTempDir, "always");
  assert.equal(config.inPlace, true, "a test that reads a fixture outside its package breaks in a copy one directory deeper");
  assert.equal(config.incremental, true);
  assert.deepEqual(config.mutate, TARGET.mutate);
  assert.equal(config.concurrency, 2);
});

test("--only sweeps one file and does not read or write the incremental file", () => {
  const config = strykerConfig(TARGET, "/out/credit-gate", { only: "src/gate/allowed.ts" });
  assert.deepEqual(config.mutate, ["src/gate/allowed.ts"]);
  assert.equal(config.incremental, false);
});

// ─── Reading the report ─────────────────────────────────────────────────

test("a location's text is sliced with 1-based lines and columns and an exclusive end", () => {
  assert.equal(sliceSource(SOURCE, { start: { line: 2, column: 7 }, end: { line: 2, column: 17 } }), "used < cap");
  assert.equal(sliceSource("ab\ncd\nef", { start: { line: 1, column: 2 }, end: { line: 3, column: 2 } }), "b\ncd\ne");
});

test("long or multi-line text is flattened to one short line", () => {
  assert.equal(oneLine("a\n   b"), "a b");
  assert.equal(oneLine("x".repeat(100), 10), `${"x".repeat(9)}…`);
});

test("only the changes no test noticed and the lines no test runs are findings, counted apart", () => {
  const summary = summarize(
    report([
      mutant("1", "Killed", "EqualityOperator", 2, 7, 17, "used <= cap", ["t1", "t2"]),
      mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t1"]),
      mutant("3", "NoCoverage", "BlockStatement", 3, 3, 21, "{}"),
      mutant("4", "Timeout", "ConditionalExpression", 2, 7, 28, "true"),
      mutant("5", "Ignored", "StringLiteral", 1, 1, 2, '""'),
      mutant("6", "CompileError", "ArrowFunction", 1, 1, 2, "() => undefined"),
    ]),
    "backend/services/example",
  );
  assert.deepEqual(summary.counts, { total: 6, killed: 1, survived: 1, refuted: 0, timeout: 1, noCoverage: 1, ignored: 1, errors: 1 });
  assert.equal(summary.score, 50);
  assert.deepEqual(
    summary.findings.map((f) => [f.status, f.path, f.line, f.original, f.replacement, f.tests]),
    [
      ["Survived", "backend/services/example/src/gate/allowed.ts", 2, "cap > 0", "cap >= 0", ["allows a run under the cap"]],
      ["NoCoverage", "backend/services/example/src/gate/allowed.ts", 3, "return used < cap;", "{}", []],
    ],
  );
});

test("a finding keeps its name when an edit above moves its line", () => {
  const before = summarize(report([mutant("1", "Survived", "EqualityOperator", 3, 10, 20, "used <= cap")]), "pkg").findings[0];
  const moved = summarize(report([mutant("9", "Survived", "EqualityOperator", 4, 10, 20, "used <= cap")], `// a new first line\n${SOURCE}`), "pkg").findings[0];
  assert.equal(moved.original, before.original);
  assert.equal(moved.key, before.key);
  assert.notEqual(moved.line, before.line);
});

test("two identical changes in one file are two findings", () => {
  const source = "const a = x < y;\nconst b = x < y;\n";
  const { findings } = summarize(
    report([mutant("1", "Survived", "EqualityOperator", 2, 11, 16, "x <= y"), mutant("2", "Survived", "EqualityOperator", 1, 11, 16, "x <= y")], source),
    "pkg",
  );
  assert.equal(findings.length, 2);
  assert.notEqual(findings[0].key, findings[1].key);
  assert.equal(findings[0].line, 1);
  assert.equal(findingKey("f", "m", "o", "r", 0), findingKey("f", "m", "o", "r", 0));
  assert.notEqual(findingKey("f", "m", "o", "r", 0), findingKey("f", "m", "o", "r", 1));
});

test("a disable comment without a reason is listed; one with a reason, and a restore, are not", () => {
  const source = [
    "// Stryker disable next-line EqualityOperator: the count never equals the cap; the cap is checked first",
    "// Stryker disable next-line EqualityOperator",
    "// Stryker disable all",
    "// Stryker disable all:",
    "// Stryker restore all",
  ].join("\n");
  assert.deepEqual(
    reasonlessDisables(source).map((d) => d.line),
    [2, 3, 4],
  );
  const summary = summarize(report([], source), "pkg");
  assert.equal(summary.reasonless.length, 3);
  assert.equal(summary.reasonless[0].path, "pkg/src/gate/allowed.ts");
  assert.ok(hasWork(summary));
});

test("a refuted finding is dropped and counted caught; a confirmed one is marked", () => {
  const mutants = [mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"), mutant("2", "Survived", "LogicalOperator", 2, 7, 28, "used < cap || cap > 0")];
  const first = summarize(report(mutants), "pkg");
  assert.deepEqual(first.survivedKeys, first.findings.map((f) => f.confirmKey));
  const [refuted, kept] = first.findings;
  const second = summarize(report(mutants), "pkg", { confirmed: { [refuted.confirmKey]: false, [kept.confirmKey]: true } });
  assert.equal(second.counts.refuted, 1);
  assert.equal(second.counts.survived, 1);
  assert.deepEqual(second.findings.map((f) => [f.key, f.confirmed]), [[kept.key, true]]);
  assert.equal(second.score, 50);
  assert.deepEqual(second.survivedKeys, first.survivedKeys, "a refuted finding's verdict stays cached");
});

test("a cached verdict no longer applies once its file changes", () => {
  const m = [mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0")];
  const before = summarize(report(m), "pkg").findings[0];
  const edited = summarize(report(m, `${SOURCE}// edited\n`), "pkg", { confirmed: { [before.confirmKey]: false } });
  assert.equal(edited.findings[0].key, before.key);
  assert.notEqual(edited.findings[0].confirmKey, before.confirmKey);
  assert.equal(edited.counts.refuted, 0);
});

test("only the main list's unchecked not-noticed findings are confirmed", () => {
  const summary = summarize(
    report([
      mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"),
      mutant("2", "Survived", "StringLiteral", 1, 1, 2, '""'),
      mutant("3", "NoCoverage", "BlockStatement", 3, 3, 21, "{}"),
    ]),
    "pkg",
  );
  assert.deepEqual(toConfirm(summary).map((f) => f.mutator), ["EqualityOperator"]);
  assert.deepEqual(summary.findings.map((f) => f.harmless), [true, false, false]);
});

test("a change is applied by its exact location", () => {
  assert.equal(applyChange(SOURCE, { start: { line: 2, column: 7 }, end: { line: 2, column: 17 } }, "used <= cap").split("\n")[1], "  if (used <= cap && cap > 0) return true;");
  assert.equal(applyChange("ab\ncd\nef", { start: { line: 1, column: 2 }, end: { line: 3, column: 2 } }, "X"), "aXf");
});

test("the confirm step keeps a finding only when the related tests stay green, and always restores the file", () => {
  const dir = mkdtempSync(join(tmpdir(), "mutation-sweep-confirm-"));
  try {
    mkdirSync(join(dir, "src/gate"), { recursive: true });
    const file = join(dir, "src/gate/allowed.ts");
    writeFileSync(file, SOURCE);
    const summary = summarize(
      report([mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"), mutant("2", "Survived", "LogicalOperator", 2, 7, 28, "used < cap || cap > 0")]),
      "pkg",
    );
    const seen = [];
    const { verdicts, interrupted } = confirmFindings(toConfirm(summary), dir, {
      isClean: () => true,
      runRelated: (relativePath) => {
        const text = readFileSync(join(dir, relativePath), "utf8");
        seen.push(text.split("\n")[1]);
        return text.includes("cap >= 0");
      },
    });
    assert.equal(interrupted, false);
    assert.deepEqual(seen, ["  if (used < cap || cap > 0) return true;", "  if (used < cap && cap >= 0) return true;"]);
    assert.deepEqual(Object.values(verdicts), [false, true]);
    assert.equal(readFileSync(file, "utf8"), SOURCE);

    assert.throws(
      () => confirmFindings(toConfirm(summary), dir, { isClean: () => true, runRelated: () => { throw new Error("vitest crashed"); } }),
      /vitest crashed/,
    );
    assert.equal(readFileSync(file, "utf8"), SOURCE, "a crash mid-run still restores the file");
    assert.throws(() => confirmFindings(toConfirm(summary), dir, { isClean: () => false, runRelated: () => true }), /uncommitted changes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a run with no mutants judged has no score", () => {
  assert.equal(summarize(report([]), "pkg").score, undefined);
});

// ─── The issue ──────────────────────────────────────────────────────────

test("what changed between two runs is the keys new and the keys gone", () => {
  assert.deepEqual(compareRuns(["a", "b"], ["b", "c"]), { added: ["c"], gone: ["a"] });
  assert.deepEqual(compareRuns([], []), { added: [], gone: [] });
});

test("the body names its target and carries this run's keys back to the next run", () => {
  const summary = summarize(
    report([mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t1", "t2"]), mutant("3", "NoCoverage", "BlockStatement", 3, 3, 21, "{}")]),
    "backend/services/example",
  );
  const { title, body } = renderIssue({ name: "credit-gate", target: TARGET, summary, change: { added: ["x"], gone: [] }, commit: "0123456789abcdef", runUrl: "https://example.test/run/1" });
  assert.equal(title, "Mutation sweep: the credit gate -- 1 change no test notices");
  assert.ok(body.startsWith(targetMarker("credit-gate")));
  assert.deepEqual(keysFromBody(body), summary.findings.map((f) => f.key));
  assert.match(body, /### Not noticed \(1\)/);
  assert.match(body, /### Never run by any test \(1\)/);
  assert.match(body, /- L2 `cap > 0` -> `cap >= 0` \(EqualityOperator\) -- ran by: "allows a run under the cap" and 1 more/);
  assert.match(body, /`0123456789`|`012345678`/);
  assert.match(body, /1 new and 0 gone since the last run/);
  assert.match(body, /--run credit-gate --out <dir> --only <file>/);
  assert.match(body, /\(not re-checked\)/);
});

test("probably-harmless changes are listed apart and left out of the title's count; a refuted one is reported as caught", () => {
  const mutants = [mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"), mutant("2", "Survived", "StringLiteral", 1, 1, 2, '""'), mutant("3", "Survived", "LogicalOperator", 2, 7, 28, "x")];
  const first = summarize(report(mutants), "pkg");
  const byMutator = Object.fromEntries(first.findings.map((f) => [f.mutator, f.confirmKey]));
  const summary = summarize(report(mutants), "pkg", { confirmed: { [byMutator.EqualityOperator]: true, [byMutator.LogicalOperator]: false } });
  const { title, body } = renderIssue({ name: "credit-gate", target: TARGET, summary });
  assert.equal(title, "Mutation sweep: the credit gate -- 1 change no test notices");
  assert.match(body, /### Probably harmless: messages and payloads \(1\)/);
  assert.match(body, /1 that Stryker missed were caught on re-check/);
  assert.doesNotMatch(body, /- L\d+ .*\(not re-checked\)/);
});

test("a body over the listing budget says how many more there are", () => {
  const mutants = Array.from({ length: 230 }, (_, i) => mutant(String(i), "Survived", "BooleanLiteral", 1, 1, 2, `v${i}`));
  const summary = summarize(report(mutants, "e\n"), "pkg");
  const { body } = renderIssue({ name: "credit-gate", target: TARGET, summary });
  assert.match(body, /…and 30 more/);
  assert.equal(keysFromBody(body).length, 230);
  assert.ok(body.length < 65_536);
});

test("a body with no findings says the issue closes itself", () => {
  const summary = summarize(report([mutant("1", "Killed", "EqualityOperator", 2, 7, 17, "used <= cap")]), "pkg");
  const { title, body } = renderIssue({ name: "credit-gate", target: TARGET, summary });
  assert.equal(title, "Mutation sweep: the credit gate -- 0 changes no test notices");
  assert.match(body, /Every change was caught/);
  assert.deepEqual(keysFromBody(body), []);
  assert.equal(hasWork(summary), false);
});

test("an issue body with no keys marker reads as no previous findings", () => {
  assert.deepEqual(keysFromBody(undefined), []);
  assert.deepEqual(keysFromBody("no marker here"), []);
});

// ─── The publish plan ───────────────────────────────────────────────────

const rendered = { title: "T", body: "B" };
const verbs = (calls) => calls.map((c) => c.slice(0, 2).join(" "));

test("no issue and no findings: nothing is filed", () => {
  assert.deepEqual(publishPlan({ repo: "o/r", existing: undefined, rendered, work: false, change: { added: [], gone: [] } }), []);
});

test("no issue and findings: one issue is created with the label and the body file", () => {
  const calls = publishPlan({ repo: "o/r", existing: undefined, rendered, work: true, change: { added: ["a"], gone: [] } });
  assert.deepEqual(calls, [["issue", "create", "--repo", "o/r", "--label", "mutation-sweep", "--title", "T", "--body-file", "{body}"]]);
});

test("an open issue whose list did not change is rewritten, with no comment", () => {
  const calls = publishPlan({ repo: "o/r", existing: { number: 7, state: "OPEN" }, rendered, work: true, change: { added: [], gone: [] } });
  assert.deepEqual(verbs(calls), ["issue edit"]);
});

test("an open issue whose list changed is rewritten and gets one comment", () => {
  const calls = publishPlan({ repo: "o/r", existing: { number: 7, state: "OPEN" }, rendered, work: true, change: { added: ["a"], gone: ["b", "c"] } });
  assert.deepEqual(verbs(calls), ["issue edit", "issue comment"]);
  assert.equal(calls[1].at(-1), "1 new and 2 gone since the last run.");
});

test("an open issue whose list emptied is rewritten, told, and closed", () => {
  const calls = publishPlan({ repo: "o/r", existing: { number: 7, state: "OPEN" }, rendered, work: false, change: { added: [], gone: ["a"] } });
  assert.deepEqual(verbs(calls), ["issue edit", "issue comment", "issue close"]);
});

test("a closed issue whose finding returned is reopened, rewritten and told", () => {
  const calls = publishPlan({ repo: "o/r", existing: { number: 7, state: "CLOSED" }, rendered, work: true, change: { added: ["a"], gone: [] } });
  assert.deepEqual(verbs(calls), ["issue reopen", "issue edit", "issue comment"]);
});

test("a closed issue that stays clean is only rewritten", () => {
  const calls = publishPlan({ repo: "o/r", existing: { number: 7, state: "CLOSED" }, rendered, work: false, change: { added: [], gone: [] } });
  assert.deepEqual(verbs(calls), ["issue edit"]);
});

// ─── The command, through a fake gh ─────────────────────────────────────

/** A scratch directory with a fake `gh` that logs its calls and answers `issue list` from a file. */
function fakeGh(existingIssues) {
  const dir = mkdtempSync(join(tmpdir(), "mutation-sweep-test-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(dir, "issues.json"), JSON.stringify(existingIssues));
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      `printf '%s\\n' "$*" >> "${join(dir, "calls.log")}"`,
      'for a in "$@"; do case "$prev" in --body-file) cat "$a" >> ' + `"${join(dir, "bodies.log")}"` + ";; esac; prev=$a; done",
      `case "$1 $2" in "issue list") cat "${join(dir, "issues.json")}";; esac`,
      "",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, calls: () => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n") };
}

function writeRun(dir, name, mutants) {
  const runDir = join(dir, "runs", name);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "target.json"), JSON.stringify({ target: name, package: TARGET.package, commit: "abc1234567", only: null }));
  writeFileSync(join(runDir, "mutation.json"), JSON.stringify(report(mutants)));
  writeFileSync(join(dir, "targets.json"), JSON.stringify({ targets: { [name]: TARGET } }));
}

test("--report --publish files a new issue for a target with findings", () => {
  const gh = fakeGh([]);
  try {
    writeRun(gh.dir, "credit-gate", [mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t1"])]);
    const out = spawnSync(process.execPath, [SCRIPT, "--targets", join(gh.dir, "targets.json"), "--report", "--input", join(gh.dir, "runs"), "--publish", "--repo", "o/r", "--run-url", "https://example.test/run/2"], { env: gh.env, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const calls = gh.calls();
    assert.match(calls[0], /^issue list --repo o\/r --label mutation-sweep --state all/);
    assert.match(calls[1], /^issue create --repo o\/r --label mutation-sweep --title Mutation sweep: the credit gate -- 1 change no test notices --body-file /);
    const body = readFileSync(join(gh.dir, "bodies.log"), "utf8");
    assert.ok(body.includes(targetMarker("credit-gate")));
    assert.ok(body.includes("https://example.test/run/2"));
  } finally {
    rmSync(gh.dir, { recursive: true, force: true });
  }
});

test("--report --publish closes the target's open issue once every change is caught", () => {
  const previous = renderIssue({ name: "credit-gate", target: TARGET, summary: summarize(report([mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0")]), TARGET.package) });
  const gh = fakeGh([{ number: 41, state: "OPEN", body: previous.body }]);
  try {
    writeRun(gh.dir, "credit-gate", [mutant("2", "Killed", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t2"])]);
    const out = spawnSync(process.execPath, [SCRIPT, "--targets", join(gh.dir, "targets.json"), "--report", "--input", join(gh.dir, "runs"), "--publish", "--repo", "o/r"], { env: gh.env, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(gh.calls().slice(1).map((c) => c.split(" ").slice(0, 3).join(" ")), ["issue edit 41", "issue comment 41", "issue close 41"]);
  } finally {
    rmSync(gh.dir, { recursive: true, force: true });
  }
});

test("--report refuses a run for a target the file does not name", () => {
  const gh = fakeGh([]);
  try {
    writeRun(gh.dir, "credit-gate", []);
    writeFileSync(join(gh.dir, "targets.json"), JSON.stringify({ targets: { other: TARGET } }));
    const out = spawnSync(process.execPath, [SCRIPT, "--targets", join(gh.dir, "targets.json"), "--report", "--input", join(gh.dir, "runs")], { env: gh.env, encoding: "utf8" });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /targets the file does not name: credit-gate/);
  } finally {
    rmSync(gh.dir, { recursive: true, force: true });
  }
});

test("--failed comments on the open failure issue, or files one", () => {
  for (const [existing, verb] of [
    [[{ number: 9 }], "issue comment 9"],
    [[], "issue create --repo"],
  ]) {
    const gh = fakeGh(existing);
    try {
      const out = spawnSync(process.execPath, [SCRIPT, "--failed", "--repo", "o/r", "--run-url", "https://example.test/run/3"], { env: gh.env, encoding: "utf8" });
      assert.equal(out.status, 0, out.stderr);
      const calls = gh.calls();
      assert.match(calls[0], /^issue list --repo o\/r --label mutation-sweep-failure --state open/);
      assert.ok(calls[1].startsWith(verb), calls[1]);
    } finally {
      rmSync(gh.dir, { recursive: true, force: true });
    }
  }
});

test("a usage error exits 2 and names the problem", () => {
  const out = spawnSync(process.execPath, [SCRIPT, "--report"], { encoding: "utf8" });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /--targets <file> is required/);
  const both = spawnSync(process.execPath, [SCRIPT, "--targets", "x", "--report", "--failed"], { encoding: "utf8" });
  assert.equal(both.status, 2);
  assert.match(both.stderr, /exactly one of/);
});
