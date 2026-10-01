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
// command's `--report --publish` and `--failed` end to end; through a fake
// `npx` in a throwaway repository, `--run` end to end: its record, the
// confirm step's verdicts and their cache, an interrupted run, and the
// refusals of a dirty package and of a file outside it.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyChange,
  codeSpan,
  compareRuns,
  confirmFindings,
  confirmTimeout,
  findingKey,
  hasWork,
  keepVerdicts,
  keysFromBody,
  MAX_BODY,
  oneLine,
  publishPlan,
  readTargets,
  reasonlessDisables,
  relatedOutcome,
  renderIssue,
  sliceSource,
  strykerConfig,
  summarize,
  targetMarker,
  toConfirm,
  verdictsOf,
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

test("a related run is red only when a test failed, green only when tests ran and passed, and interrupted when killed", () => {
  const report = (total, failed, failedSuites = 0) => ({ numTotalTests: total, numFailedTests: failed, numFailedTestSuites: failedSuites, testResults: [] });
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(5, 2)), "red");
  assert.equal(relatedOutcome({ status: 0, signal: null }, report(5, 0)), "green");
  assert.equal(relatedOutcome({ status: null, signal: "SIGINT" }, report(5, 2)), "interrupted");
  assert.equal(relatedOutcome({ status: 130, signal: null }, undefined), "interrupted", "vitest catches SIGINT and exits 130 with no report");
  assert.equal(relatedOutcome({ status: 143, signal: null }, undefined), "interrupted", "and SIGTERM, 143");
  assert.equal(relatedOutcome({ status: null, signal: "SIGTERM", error: Object.assign(new Error("spawnSync npx ETIMEDOUT"), { code: "ETIMEDOUT" }) }, undefined), "timeout");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(5, 0, 1), { afterGreen: true }), "red", "a test file that fails to load right after a green run: the change broke it");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(0, 0, 2), { afterGreen: true }), "red", "every related file failed to load, so no test ran: still the change's doing");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(0, 0, 2)), "inconclusive", "the same with no green run just before proves nothing");
  assert.equal(relatedOutcome({ status: 1, signal: null }, undefined), "inconclusive", "no report: a crash proves nothing");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(0, 0)), "inconclusive", "no test ran");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(5, 0, 1)), "inconclusive", "a file that failed to load, as when an engine is down");
  assert.equal(relatedOutcome({ status: 1, signal: null }, report(5, 0)), "inconclusive", "red exit with no failed test");
});

/** A package directory holding SOURCE as src/gate/allowed.ts, and the two findings on its line 2. */
function confirmFixture() {
  const dir = mkdtempSync(join(tmpdir(), "mutation-sweep-confirm-"));
  mkdirSync(join(dir, "src/gate"), { recursive: true });
  writeFileSync(join(dir, "src/gate/allowed.ts"), SOURCE);
  const summary = summarize(
    report([mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"), mutant("2", "Survived", "LogicalOperator", 2, 7, 28, "used < cap || cap > 0")]),
    "pkg",
  );
  return { dir, file: join(dir, "src/gate/allowed.ts"), findings: toConfirm(summary) };
}

test("the confirm step keeps a finding only when the related tests stay green, and always restores the file", () => {
  const { dir, file, findings } = confirmFixture();
  try {
    const seen = [];
    const { verdicts, interrupted } = confirmFindings(findings, dir, {
      isClean: () => true,
      hashFile: (test) => `hash-of-${test}`,
      runRelated: (relativePath) => {
        const text = readFileSync(join(dir, relativePath), "utf8");
        seen.push(text.split("\n")[1]);
        return { outcome: text.includes("||") ? "red" : "green", tests: ["src/gate/__tests__/allowed.test.ts"] };
      },
    });
    assert.equal(interrupted, false);
    assert.deepEqual(seen, [SOURCE.split("\n")[1], "  if (used < cap || cap > 0) return true;", "  if (used < cap && cap >= 0) return true;"], "one unchanged run first, then each change");
    assert.deepEqual(Object.values(verdicts).map((v) => v.verdict), [false, true]);
    assert.deepEqual(Object.values(verdicts)[0].tests, { "src/gate/__tests__/allowed.test.ts": "hash-of-src/gate/__tests__/allowed.test.ts" });
    assert.equal(readFileSync(file, "utf8"), SOURCE);

    assert.throws(
      () => confirmFindings(findings, dir, { isClean: () => true, hashFile: () => "h", runRelated: (p) => { if (readFileSync(join(dir, p), "utf8") !== SOURCE) throw new Error("vitest crashed"); return { outcome: "green", tests: [] }; } }),
      /vitest crashed/,
    );
    assert.equal(readFileSync(file, "utf8"), SOURCE, "a crash mid-run still restores the file");
    assert.throws(() => confirmFindings(findings, dir, { isClean: () => false, hashFile: () => "h", runRelated: () => ({ outcome: "green", tests: [] }) }), /uncommitted changes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an interrupted or unclear run gives no verdict, and tests not green before any change skip the file", () => {
  const { dir, file, findings } = confirmFixture();
  try {
    let calls = 0;
    const interruptedRun = confirmFindings(findings, dir, {
      isClean: () => true,
      hashFile: () => "h",
      runRelated: () => (++calls === 1 ? { outcome: "green", tests: [] } : { outcome: "interrupted", tests: [] }),
    });
    assert.deepEqual(interruptedRun, { verdicts: {}, interrupted: true });
    assert.equal(calls, 2, "it stops at the interruption");
    assert.equal(readFileSync(file, "utf8"), SOURCE);

    const unclear = confirmFindings(findings, dir, { isClean: () => true, hashFile: () => "h", runRelated: (p) => ({ outcome: readFileSync(join(dir, p), "utf8") === SOURCE ? "green" : "inconclusive", tests: [] }) });
    assert.deepEqual(unclear.verdicts, {});

    const logged = [];
    const redFirst = confirmFindings(findings, dir, { isClean: () => true, hashFile: () => "h", runRelated: () => ({ outcome: "red", tests: [] }), log: (l) => logged.push(l) });
    assert.deepEqual(redFirst.verdicts, {}, "a red run before any change would read as a catch");
    assert.match(logged[0], /red before any change, so 2 finding\(s\) stay not re-checked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change that makes the tests hang is caught, and a changed run is limited to three times the unchanged one", () => {
  const { dir, findings } = confirmFixture();
  try {
    const seen = [];
    const { verdicts } = confirmFindings(findings, dir, {
      isClean: () => true,
      hashFile: () => "h",
      runRelated: (p, options) => {
        seen.push(options);
        return { outcome: readFileSync(join(dir, p), "utf8") === SOURCE ? "green" : "timeout", tests: [] };
      },
    });
    assert.deepEqual(Object.values(verdicts).map((v) => v.verdict), [false, false]);
    assert.deepEqual(seen[0], { timeoutMs: undefined, afterGreen: false }, "the unchanged run has no limit");
    assert.equal(seen[1].afterGreen, true);
    assert.ok(seen[1].timeoutMs >= 120_000);
    assert.equal(confirmTimeout(60_000), 180_000);
    assert.equal(confirmTimeout(1_000), 120_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a code span survives backticks in its text, and keeps an issue number from becoming a link", () => {
  assert.equal(codeSpan("cap > 0"), "`cap > 0`");
  assert.equal(codeSpan("`${a}` b"), "`` `${a}` b ``");
  assert.equal(codeSpan("a ``b`` c"), "```a ``b`` c```");
  const summary = summarize(report([mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t9"])]), "pkg");
  summary.findings[0].tests = ["keeps the grant (#776) and cloud #226"];
  const { body } = renderIssue({ name: "credit-gate", target: TARGET, summary });
  assert.match(body, /ran by: `keeps the grant \(#776\) and cloud #226`/);
});

test("a cached verdict is kept only while its finding is reported and the tests that judged it are unchanged", () => {
  const cached = {
    "a@1": { verdict: false, tests: { "t/x.test.ts": "h1" } },
    "b@1": { verdict: true, tests: { "t/x.test.ts": "h1", "t/y.test.ts": "h2" } },
    "c@1": { verdict: true, tests: {} },
    "d@1": { verdict: false, tests: { "t/gone.test.ts": "h3" } },
  };
  const hashes = { "t/x.test.ts": "h1", "t/y.test.ts": "changed" };
  const kept = keepVerdicts(cached, new Set(["a@1", "b@1", "d@1"]), (t) => hashes[t]);
  assert.deepEqual(Object.keys(kept), ["a@1"], "b: a test changed; c: no longer reported; d: its test is gone");
  assert.deepEqual(verdictsOf(kept), { "a@1": false });
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
  assert.match(body, /- L2 `cap > 0` -> `cap >= 0` \(EqualityOperator\) -- ran by: `allows a run under the cap` and 1 more/);
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

test("a body never passes GitHub's limit: too many keys are left out and marked partial", () => {
  const many = Array.from({ length: 5000 }, (_, i) => mutant(String(i), i % 2 ? "Survived" : "NoCoverage", "ConditionalExpression", 1, 1, 2, `v${i}`));
  const { body } = renderIssue({ name: "credit-gate", target: TARGET, summary: summarize(report(many, "e\n"), "pkg") });
  assert.ok(body.length <= MAX_BODY, `${body.length} characters`);
  assert.equal(keysFromBody(body), undefined, "the next run cannot compare against a partial list");
  const some = Array.from({ length: 1000 }, (_, i) => mutant(String(i), "Survived", "ConditionalExpression", 1, 1, 2, `v${i}`));
  const full = renderIssue({ name: "credit-gate", target: TARGET, summary: summarize(report(some, "e\n"), "pkg") });
  assert.ok(full.body.length <= MAX_BODY, `${full.body.length} characters`);
  assert.equal(keysFromBody(full.body).length, 1000);
});

test("a body's visible text stops short of GitHub's limit however long its lines are", () => {
  const long = "x".repeat(400);
  const files = {};
  for (let i = 0; i < 200; i++) {
    files[`src/${"deeply/nested/".repeat(8)}module-${i}.ts`] = { language: "typescript", source: `${long}\n`, mutants: [{ ...mutant(String(i), "Survived", "ConditionalExpression", 1, 1, 400, long), coveredBy: ["t1", "t2"] }] };
  }
  const wide = { schemaVersion: "2", thresholds: { high: 80, low: 60 }, files, testFiles: { "t.test.ts": { tests: [{ id: "t1", name: long }, { id: "t2", name: long }] } } };
  const { body } = renderIssue({ name: "credit-gate", target: TARGET, summary: summarize(wide, `backend/${"services/".repeat(10)}example`) });
  assert.ok(body.length <= MAX_BODY, `${body.length} characters`);
  assert.match(body, /…and \d+ more in the run's `mutation.json`/);
  const disables = Array.from({ length: 5000 }, (_, i) => `// Stryker disable next-line Rule${i}`).join("\n");
  const reasonless = renderIssue({ name: "credit-gate", target: TARGET, summary: summarize(report([], disables), "pkg") });
  assert.ok(reasonless.body.length <= MAX_BODY, `${reasonless.body.length} characters`);
  assert.match(reasonless.body, /### Disable comments without a reason \(5000\)/);
  assert.match(reasonless.body, /…and \d+ more\./);
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
    assert.ok(body.includes("[run](https://example.test/run/2)"));
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

test("--report reads the confirm step's verdicts beside the report, and leaves a refuted finding out", () => {
  const gh = fakeGh([]);
  try {
    const mutants = [mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t1"]), mutant("3", "Survived", "LogicalOperator", 2, 7, 28, "used < cap || cap > 0", ["t1"])];
    writeRun(gh.dir, "credit-gate", mutants);
    const [refuted, kept] = summarize(report(mutants), TARGET.package).findings;
    writeFileSync(join(gh.dir, "runs/credit-gate/confirmed.json"), JSON.stringify({ [refuted.confirmKey]: { verdict: false, tests: {} }, [kept.confirmKey]: { verdict: true, tests: {} } }));
    const out = spawnSync(process.execPath, [SCRIPT, "--targets", join(gh.dir, "targets.json"), "--report", "--input", join(gh.dir, "runs")], { env: gh.env, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /2 changes, 1 caught \(1 on re-check\), 1 not noticed/);
    assert.match(out.stdout, /-- 1 change no test notices/);
    assert.doesNotMatch(out.stdout, /used < cap \|\| cap > 0/);
    assert.doesNotMatch(out.stdout, /- L\d+ .*\(not re-checked\)/);
  } finally {
    rmSync(gh.dir, { recursive: true, force: true });
  }
});

test("--report --publish files nothing for a one-file check", () => {
  const gh = fakeGh([]);
  try {
    writeRun(gh.dir, "credit-gate", [mutant("2", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0", ["t1"])]);
    const meta = join(gh.dir, "runs/credit-gate/target.json");
    writeFileSync(meta, JSON.stringify({ ...JSON.parse(readFileSync(meta, "utf8")), only: "src/gate/allowed.ts" }));
    const out = spawnSync(process.execPath, [SCRIPT, "--targets", join(gh.dir, "targets.json"), "--report", "--input", join(gh.dir, "runs"), "--publish", "--repo", "o/r"], { env: gh.env, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(gh.calls().map((c) => c.split(" ").slice(0, 2).join(" ")), ["issue list"]);
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

// ─── --run, through a fake npx in a throwaway repository ────────────────

/**
 * A git repository holding one package with SOURCE in it, and a fake `npx`
 * on PATH that plays Stryker (it writes `FAKE_REPORT` where the config asks)
 * and vitest (red when the file under test contains `FAKE_RED_TEXT`; on a
 * changed file, interrupted as vitest is, exiting 130 with no report, when
 * `FAKE_VITEST=signal`, or killed by SIGINT when `FAKE_VITEST=killed`; on
 * the unchanged run too when `FAKE_VITEST=signal-first`; a failed Stryker
 * when `FAKE_STRYKER_STATUS` is set, or one that leaves the source file
 * changed when `FAKE_STRYKER_DIRTY` is; no
 * tests run when `FAKE_VITEST=none`; red on the unchanged file when
 * `FAKE_VITEST=red`). Every vitest call is logged, one line each.
 */
function runFixture() {
  const dir = mkdtempSync(join(tmpdir(), "mutation-sweep-run-"));
  const repo = join(dir, "repo");
  const pkg = join(repo, "backend/services/example");
  mkdirSync(join(pkg, "src/gate/__tests__"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), "{}\n");
  writeFileSync(join(pkg, "src/gate/allowed.ts"), SOURCE);
  writeFileSync(join(pkg, "src/gate/__tests__/allowed.test.ts"), "// the gate's tests\n");
  writeFileSync(join(dir, "targets.json"), JSON.stringify({ targets: { "credit-gate": TARGET } }));
  const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "fixture");
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify(report([mutant("1", "Survived", "EqualityOperator", 2, 21, 28, "cap >= 0"), mutant("2", "Survived", "LogicalOperator", 2, 7, 28, "used < cap || cap > 0")])),
  );
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "npx"),
    `#!${process.execPath}
const { appendFileSync, copyFileSync, readFileSync, writeFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const args = process.argv.slice(2);
if (args[1] === "stryker") {
  if (process.env.FAKE_STRYKER_STATUS) process.exit(Number(process.env.FAKE_STRYKER_STATUS));
  const config = JSON.parse(readFileSync(args[3], "utf8"));
  copyFileSync(process.env.FAKE_REPORT, config.jsonReporter.fileName);
  if (process.env.FAKE_STRYKER_DIRTY) appendFileSync("src/gate/allowed.ts", "// left behind\\n");
  process.exit(0);
}
const file = args[4];
const out = args.find((a) => a.startsWith("--outputFile=")).slice("--outputFile=".length);
const text = readFileSync(file, "utf8");
const changed = !text.includes("used < cap && cap > 0");
appendFileSync(process.env.FAKE_LOG, (changed ? "changed " : "unchanged ") + file + "\\n");
const mode = process.env.FAKE_VITEST ?? "";
if (mode === "signal" && changed) process.exit(130);
if (mode === "signal-first") process.exit(130);
if (mode === "killed" && changed) process.kill(process.pid, "SIGINT");
const red = (mode === "red" && !changed) || (process.env.FAKE_RED_TEXT && changed && text.includes(process.env.FAKE_RED_TEXT));
const tests = mode === "none" ? [] : [resolve("src/gate/__tests__/allowed.test.ts")];
writeFileSync(out, JSON.stringify({ numTotalTests: tests.length, numFailedTests: red ? 1 : 0, numFailedTestSuites: 0, testResults: tests.map((name) => ({ name })) }));
process.exit(red ? 1 : 0);
`,
  );
  chmodSync(join(bin, "npx"), 0o755);
  const log = join(dir, "vitest.log");
  const run = (env = {}, extra = []) =>
    spawnSync(process.execPath, [SCRIPT, "--targets", join(dir, "targets.json"), "--run", "credit-gate", "--out", join(dir, "out"), ...extra], {
      cwd: repo,
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_REPORT: join(dir, "report.json"), FAKE_LOG: log, FAKE_RED_TEXT: "||", ...env },
    });
  const calls = () => {
    try {
      return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  };
  const confirmed = () => JSON.parse(readFileSync(join(dir, "out/credit-gate/confirmed.json"), "utf8"));
  return { dir, repo, pkg, run, calls, confirmed, resetLog: () => rmSync(log, { force: true }) };
}

test("--run writes the target's record, confirms one finding, refutes the other, and leaves the tree clean", () => {
  const f = runFixture();
  try {
    const out = f.run();
    assert.equal(out.status, 0, out.stderr);
    const meta = JSON.parse(readFileSync(join(f.dir, "out/credit-gate/target.json"), "utf8"));
    assert.equal(meta.target, "credit-gate");
    assert.equal(meta.package, TARGET.package);
    assert.match(meta.commit, /^[0-9a-f]{40}$/);
    const config = JSON.parse(readFileSync(join(f.dir, "out/credit-gate/stryker.config.json"), "utf8"));
    assert.equal(config.jsonReporter.fileName, join(f.dir, "out/credit-gate/mutation.json"));
    assert.deepEqual(f.calls().map((c) => c.split(" ")[0]), ["unchanged", "changed", "changed"]);
    const verdicts = Object.values(f.confirmed());
    assert.deepEqual(verdicts.map((v) => v.verdict).sort(), [false, true]);
    assert.deepEqual(Object.keys(verdicts[0].tests), ["src/gate/__tests__/allowed.test.ts"]);
    assert.equal(readFileSync(join(f.pkg, "src/gate/allowed.ts"), "utf8"), SOURCE);
    assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: f.repo, encoding: "utf8" }).stdout, "");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--run reuses cached verdicts, and judges again once a test that judged them changes", () => {
  const f = runFixture();
  try {
    assert.equal(f.run().status, 0);
    f.resetLog();
    assert.equal(f.run().status, 0);
    assert.deepEqual(f.calls(), [], "both findings were judged and nothing changed");
    assert.equal(Object.keys(f.confirmed()).length, 2);
    writeFileSync(join(f.pkg, "src/gate/__tests__/allowed.test.ts"), "// the gate's tests, weakened\n");
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-am", "edit the test"], { cwd: f.repo });
    f.resetLog();
    assert.equal(f.run().status, 0);
    assert.equal(f.calls().length, 3, "the edited test invalidates both verdicts");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--run interrupted mid-confirm exits 130, records no verdict for the interrupted run, and restores the file", () => {
  for (const mode of ["signal", "killed"]) {
    const f = runFixture();
    try {
      const out = f.run({ FAKE_VITEST: mode });
      assert.equal(out.status, 130, `${mode}: ${out.stderr}`);
      assert.match(out.stderr, /interrupted/);
      assert.deepEqual(f.confirmed(), {}, mode);
      assert.equal(f.calls().length, 2, `${mode}: it stops at the first interrupted run`);
      assert.equal(readFileSync(join(f.pkg, "src/gate/allowed.ts"), "utf8"), SOURCE);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test("--run interrupted on the unchanged run stops there, exits 130 and records nothing", () => {
  const f = runFixture();
  try {
    const out = f.run({ FAKE_VITEST: "signal-first" });
    assert.equal(out.status, 130, out.stderr);
    assert.deepEqual(f.calls().map((c) => c.split(" ")[0]), ["unchanged"], "no change is applied after the interruption");
    assert.deepEqual(f.confirmed(), {});
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a failed Stryker run leaves no record that names its commit beside an earlier report", () => {
  const f = runFixture();
  try {
    assert.equal(f.run().status, 0);
    const out = f.run({ FAKE_STRYKER_STATUS: "1" });
    assert.equal(out.status, 1);
    assert.equal(existsSync(join(f.dir, "out/credit-gate/target.json")), false);
    assert.equal(existsSync(join(f.dir, "out/credit-gate/mutation.json")), false);
    assert.ok(existsSync(join(f.dir, "out/credit-gate/confirmed.json")), "the verdict cache stays for the next run");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("a confirm step that throws leaves no record to publish, and no verdict whose tests changed", () => {
  const f = runFixture();
  try {
    assert.equal(f.run().status, 0);
    assert.equal(Object.keys(f.confirmed()).length, 2);
    writeFileSync(join(f.pkg, "src/gate/__tests__/allowed.test.ts"), "// the gate's tests, weakened\n");
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-am", "edit the test"], { cwd: f.repo });
    const out = f.run({ FAKE_STRYKER_DIRTY: "1" });
    assert.equal(out.status, 2);
    assert.match(out.stderr, /uncommitted changes/);
    assert.equal(existsSync(join(f.dir, "out/credit-gate/target.json")), false, "--report reads only a run with a record");
    assert.deepEqual(f.confirmed(), {}, "both cached verdicts were judged by the test that changed");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--run --only writes beside the weekly run, so the weekly report and its verdicts survive", () => {
  const f = runFixture();
  try {
    assert.equal(f.run().status, 0);
    const weekly = f.confirmed();
    const out = f.run({}, ["--only", join(f.pkg, "src/gate/allowed.ts")]);
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(f.confirmed(), weekly);
    const only = JSON.parse(readFileSync(join(f.dir, "out/credit-gate.only/target.json"), "utf8"));
    assert.equal(only.only, "src/gate/allowed.ts");
    assert.equal(only.target, "credit-gate");
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("--run records nothing when no test ran, or when the tests are red before any change", () => {
  for (const mode of ["none", "red"]) {
    const f = runFixture();
    try {
      const out = f.run({ FAKE_VITEST: mode });
      assert.equal(out.status, 0, out.stderr);
      assert.deepEqual(f.confirmed(), {}, mode);
    } finally {
      rmSync(f.dir, { recursive: true, force: true });
    }
  }
});

test("--run refuses a package with uncommitted changes, and an --only file outside the package", () => {
  const f = runFixture();
  try {
    writeFileSync(join(f.pkg, "src/gate/allowed.ts"), `${SOURCE}// an edit\n`);
    const dirty = f.run();
    assert.equal(dirty.status, 2);
    assert.match(dirty.stderr, /backend\/services\/example has uncommitted changes/);
    spawnSync("git", ["checkout", "--", "."], { cwd: f.repo });
    writeFileSync(join(f.repo, "elsewhere.ts"), "export {};\n");
    const outside = f.run({}, ["--only", join(f.repo, "elsewhere.ts")]);
    assert.equal(outside.status, 2);
    assert.match(outside.stderr, /is not inside backend\/services\/example/);
    const missing = f.run({}, ["--only", join(f.pkg, "src/gate/missing.ts")]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /no such file/);
    assert.deepEqual(f.calls(), []);
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
