#!/usr/bin/env node

/**
 * Finds the tests that run the important code but would not notice it
 * breaking, and keeps one GitHub issue per area listing them.
 *
 * A green run says the tests passed, and coverage says they ran a line; neither
 * says a test checked what the line does. A test can call the code that
 * decides whether an organization has credits left, assert only that nothing
 * threw, and pass for ever, including after someone turns `<` into `<=`. This
 * script drives StrykerJS, which plants small changes in a package's files (a
 * flipped comparison, `&&` for `||`, an emptied function body, a blanked
 * string), switches them on one at a time, and runs the tests that cover
 * each. A change no test notices is a finding: the line is run, and nothing
 * checks it.
 *
 * The areas swept are a committed targets file:
 *   {
 *     "targets": {
 *       "<name>": {
 *         "title": "the server's authorization decisions",
 *         "package": "backend/services/stigmer-server",
 *         "mutate": ["src/authorization/**\/*.ts", "!src/authorization/**\/__tests__/**"],
 *         "concurrency": 2
 *       }
 *     }
 *   }
 * `mutate` is relative to the package, as Stryker reads it. The engines a
 * target's tests need (Postgres, OpenFGA) are the caller's to provide, with
 * `STIGMER_TEST_GATE=1` so a missing one fails instead of skipping: a sweep
 * whose database suites skipped would report every line only they check as
 * run by nothing.
 *
 * Four modes:
 *   - `--run <target>` writes the target's Stryker config into `--out`, runs
 *     Stryker in the package, and leaves `mutation.json` (Stryker's report)
 *     and `target.json` (which target, package and commit) in
 *     `<out>/<target>/`. Stryker edits the package's own files while it runs
 *     and restores them when it ends, keeping its copies of the originals in
 *     the package's `.stryker-tmp`, which it removes; so `--run` refuses a
 *     package with uncommitted or untracked files. `--dry-run` runs only
 *     Stryker's first, unchanged run of the target's tests, which proves it
 *     can run them; it writes to `<out>/<target>.dry-run/` and leaves no
 *     record. `--only <file>` sweeps one file, which
 *     is how a fix is checked locally in minutes; it writes to
 *     `<out>/<target>.only/`, so it never replaces the weekly run's report or
 *     its cache of verdicts, and `--publish` skips it.
 *     Then the confirm step applies each not-noticed change to the real file,
 *     runs every test that imports it with the package's own config, and
 *     restores the file: Stryker switches its changes on at run time, so code
 *     that runs while a module loads is never really changed, and about one
 *     finding in ten read as not noticed although a test would fail (the
 *     server's authorization code, 2026-10-01). Only a run in which a test
 *     failed refutes a finding, and only a green one confirms it. Its
 *     verdicts are written to `confirmed.json` and cached between runs: each
 *     is keyed by the finding and its file's content, and records the content
 *     of the tests that judged it, so it is judged again when they change.
 *     `--budget <minutes>` bounds the whole run, counted from the script's
 *     start: the confirm step starts no check that could end past it, and the
 *     findings it does not reach stay "not re-checked" for the next run.
 *   - `--list` prints the targets file's targets, validated, as JSON
 *     (`[{ "name", "package" }]`), for a workflow's matrix.
 *   - `--report` reads every `target.json` under the `--input` directories
 *     and prints, per target: the changes no test noticed (Stryker's
 *     `Survived`, less the ones the confirm step refuted), the blanked strings
 *     and emptied objects apart as probably harmless, the lines no test runs
 *     at all (`NoCoverage`, coverage's question rather than this one's, listed
 *     apart), and every `// Stryker disable` comment that gives no reason.
 *   - `--report --publish` keeps one issue per target, labelled
 *     `mutation-sweep`: created when a target first has findings, its body
 *     rewritten every run, a comment added when the list changed, closed when
 *     the list is empty, reopened when a finding returns. The previous run's
 *     list is read back from the issue body, so the script keeps no state.
 *     `--failed` files or comments on one `mutation-sweep-failure` issue
 *     instead, for a run that could not sweep.
 *
 * A finding is named by its file, Stryker's rule, the original text and the
 * replacement, not by Stryker's mutant id (renumbered every run) or its line
 * (moved by every edit above it), so a week-to-week change is honest. Two
 * identical changes in one file are told apart by their order.
 *
 * Usage:
 *   node scripts/mutation-sweep.mjs --targets <file> --run <target> --out <dir> [--only <file>] [--budget <minutes>]
 *   node scripts/mutation-sweep.mjs --targets <file> --run <target> --out <dir> --dry-run
 *   node scripts/mutation-sweep.mjs --targets <file> --list
 *   node scripts/mutation-sweep.mjs --targets <file> --report --input <dir> [--input <dir> ...] [--json]
 *   node scripts/mutation-sweep.mjs --targets <file> --report --input <dir> ... --publish --repo <owner/name> [--run-url <url>]
 *   node scripts/mutation-sweep.mjs --failed --repo <owner/name> --run-url <url>
 * Exit: 0 done (findings are reported, never refused, and a spent budget is
 * not a failure), Stryker's own code for a failed `--run`, 130 a confirm step
 * that was interrupted (its verdicts so far are saved, and its record is
 * written, so its findings publish with the unreached ones "not re-checked"),
 * 2 the script could not do what was asked (a usage error, an unreadable
 * input, a report for no known target). A Ctrl-C stops the confirm step at
 * once, since it reaches the test run too; a signal sent to this process
 * alone is seen only when the step ends, which then exits 130.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── The targets file ───────────────────────────────────────────────────

/** The label every target issue carries; the publish step finds its issues by it. */
export const LABEL = "mutation-sweep";

/** The label of the one issue a run that could not sweep files or comments on. */
export const FAILURE_LABEL = "mutation-sweep-failure";

const TARGET_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Reads the targets file; returns the targets and every problem with its shape. */
export function readTargets(text) {
  const problems = [];
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { targets: {}, problems: [`not JSON: ${error instanceof Error ? error.message : String(error)}`] };
  }
  const targets = doc?.targets;
  if (targets === null || typeof targets !== "object" || Array.isArray(targets)) {
    return { targets: {}, problems: ['needs a "targets" object'] };
  }
  for (const [name, target] of Object.entries(targets)) {
    if (!TARGET_NAME.test(name)) problems.push(`target "${name}": a name is lowercase words joined by "-"`);
    if (typeof target?.title !== "string" || target.title === "") problems.push(`target "${name}": needs a "title"`);
    if (typeof target?.package !== "string" || target.package === "" || target.package.startsWith("/") || target.package.includes("..")) {
      problems.push(`target "${name}": "package" is a directory relative to the repository root`);
    }
    if (!Array.isArray(target?.mutate) || !target.mutate.some((glob) => typeof glob === "string" && !glob.startsWith("!"))) {
      problems.push(`target "${name}": "mutate" lists at least one glob of files to change`);
    }
    if (target?.concurrency !== undefined && !(Number.isInteger(target.concurrency) && target.concurrency >= 1)) {
      problems.push(`target "${name}": "concurrency" is a whole number of test workers, at least 1`);
    }
  }
  return { targets, problems };
}

/**
 * The Stryker config for one target. Every setting but the files and the
 * worker count is the same for every target:
 *   - static mutants are skipped: a change that only runs while a module loads
 *     costs a full restart per mutant and rarely means anything;
 *   - a change counts as caught when any test that imports the file fails
 *     (Stryker's related scope), never only the target's own tests: on the
 *     server's authorization code the narrower scope listed a third of its
 *     findings wrongly (2026-10-01);
 *   - TypeScript's checker drops a change the compiler refuses (a removed `?.`
 *     on an optional field), which is not code anyone could write;
 *   - the first, unchanged run of every related test is allowed an hour, not
 *     Stryker's five minutes: on the server it took ten (2026-10-01);
 *   - only the JSON report is written, never the dashboard reporter, which
 *     uploads the report (and the source in it) to a third party;
 *   - Stryker changes the package's files in place and restores them when it
 *     ends, rather than in a copy one directory deeper: a test that reads a
 *     shared fixture by a relative path climbing out of its package (the
 *     runner's wire-contract test reads `test/fixtures/` that way) breaks in a
 *     copy. The caller refuses a package with uncommitted changes, so a killed
 *     run is undone with `git checkout`;
 *   - every output is pointed into `outDir`, outside the tree, and Stryker's
 *     own directory of originals is removed whatever the outcome, so a sweep
 *     never leaves a file a test run would collect or a clean-tree check would
 *     refuse.
 * `only` narrows the sweep to one file; `dryRun` runs only the first,
 * unchanged run, which proves Stryker can run the target's tests at all.
 * Neither reads or writes the incremental file.
 */
export function strykerConfig(target, outDir, { only, dryRun = false } = {}) {
  return {
    testRunner: "vitest",
    plugins: ["@stryker-mutator/vitest-runner", "@stryker-mutator/typescript-checker"],
    checkers: ["typescript"],
    mutate: only ? [only] : target.mutate,
    ignoreStatic: true,
    dryRunTimeoutMinutes: 60,
    concurrency: target.concurrency ?? 2,
    timeoutMS: 10_000,
    reporters: ["json", "progress"],
    jsonReporter: { fileName: join(outDir, "mutation.json") },
    incremental: !only && !dryRun,
    incrementalFile: join(outDir, "stryker-incremental.json"),
    ...(dryRun ? { dryRunOnly: true } : {}),
    inPlace: true,
    tempDirName: ".stryker-tmp",
    cleanTempDir: "always",
  };
}

// ─── Reading Stryker's report ───────────────────────────────────────────

/** The statuses that are findings, each with the heading it is listed under. */
export const FINDING_STATUSES = { Survived: "not noticed", NoCoverage: "never run" };

/**
 * Stryker's rules whose not-noticed changes are mostly harmless: a blanked
 * error message, an emptied log or event payload. They are listed apart, not
 * dropped, because a few matter (an error name a caller compares).
 */
export const PROBABLY_HARMLESS = new Set(["StringLiteral", "ObjectLiteral"]);

/** The text a location spans in `source` (lines and columns start at 1; the end is exclusive). */
export function sliceSource(source, location) {
  const lines = source.split("\n");
  const { start, end } = location;
  if (start.line === end.line) return (lines[start.line - 1] ?? "").slice(start.column - 1, end.column - 1);
  const parts = [(lines[start.line - 1] ?? "").slice(start.column - 1)];
  for (let line = start.line; line < end.line - 1; line++) parts.push(lines[line] ?? "");
  parts.push((lines[end.line - 1] ?? "").slice(0, end.column - 1));
  return parts.join("\n");
}

/** One line of text, at most `max` characters, for a list a person reads. */
export function oneLine(text, max = 80) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** A short, stable name for a finding: what changed where, not when or on which line. */
export function findingKey(file, mutator, original, replacement, occurrence) {
  const digest = createHash("sha256").update([file, mutator, original, replacement, String(occurrence)].join("\u0000")).digest("hex");
  return digest.slice(0, 12);
}

/** A `// Stryker disable` comment; group 1 is what it disables, group 2 the reason after a colon. */
const DISABLE = /\/\/\s*Stryker\s+disable\b(?:\s+next-line)?\s*([^:\n]*?)\s*(?::\s*(.*?))?\s*$/;

/** Every `// Stryker disable` comment in `source` that gives no reason, by line. */
export function reasonlessDisables(source) {
  const found = [];
  source.split("\n").forEach((text, index) => {
    const match = DISABLE.exec(text);
    if (match && !(match[2] ?? "").trim()) found.push({ line: index + 1, text: text.trim() });
  });
  return found;
}

/** A short hash of a file's content, so a cached confirmation is dropped when the file changes. */
export function contentHash(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

/**
 * Turns one target's Stryker report into what a person acts on. `packageDir`
 * makes every path repository-relative (Stryker's are relative to the package).
 * `confirmed` maps a finding's confirm key to the confirm step's verdict: true
 * when the change, applied for real, left every related test green; false when
 * a test went red, so Stryker's "not noticed" was wrong and the finding is
 * dropped (counted as `refuted`).
 */
export function summarize(report, packageDir, { confirmed = {} } = {}) {
  const counts = { total: 0, killed: 0, survived: 0, refuted: 0, timeout: 0, noCoverage: 0, ignored: 0, errors: 0 };
  const findings = [];
  const reasonless = [];
  const survivedKeys = [];
  const testNames = new Map();
  for (const file of Object.values(report.testFiles ?? {})) {
    for (const t of file.tests ?? []) testNames.set(t.id, t.name);
  }
  for (const [reportPath, file] of Object.entries(report.files ?? {})) {
    const relativePath = reportPath.split("\\").join("/");
    const path = posix.join(packageDir, relativePath);
    const source = file.source ?? "";
    const hash = contentHash(source);
    for (const disable of reasonlessDisables(source)) reasonless.push({ path, ...disable });
    const seen = new Map();
    const mutants = [...(file.mutants ?? [])].sort((a, b) => a.location.start.line - b.location.start.line || a.location.start.column - b.location.start.column);
    for (const mutant of mutants) {
      counts.total += 1;
      if (mutant.status === "Timeout") counts.timeout += 1;
      else if (mutant.status === "Killed") counts.killed += 1;
      else if (mutant.status === "NoCoverage") counts.noCoverage += 1;
      else if (mutant.status === "Ignored") counts.ignored += 1;
      else if (mutant.status !== "Survived") counts.errors += 1;
      // Identical changes are numbered across every mutant, whatever its
      // status: counting only the findings would hand the first one's name,
      // and its cached verdict, to the second once a test catches the first.
      const original = sliceSource(source, mutant.location);
      const replacement = mutant.replacement ?? "";
      const identity = [mutant.mutatorName, original, replacement].join("\u0000");
      const occurrence = seen.get(identity) ?? 0;
      seen.set(identity, occurrence + 1);
      if (!(mutant.status in FINDING_STATUSES)) continue;
      const key = findingKey(path, mutant.mutatorName, original, replacement, occurrence);
      const confirmKey = `${key}@${hash}`;
      if (mutant.status === "Survived") {
        survivedKeys.push(confirmKey);
        if (confirmed[confirmKey] === false) {
          counts.refuted += 1;
          continue;
        }
        counts.survived += 1;
      }
      findings.push({
        key,
        confirmKey,
        status: mutant.status,
        path,
        relativePath,
        line: mutant.location.start.line,
        location: mutant.location,
        mutator: mutant.mutatorName,
        harmless: PROBABLY_HARMLESS.has(mutant.mutatorName),
        confirmed: confirmed[confirmKey] === true,
        original,
        replacement,
        tests: (mutant.coveredBy ?? []).map((id) => testNames.get(id) ?? id),
      });
    }
  }
  const caught = counts.killed + counts.timeout + counts.refuted;
  const judged = caught + counts.survived + counts.noCoverage;
  return { counts, score: judged === 0 ? undefined : Math.floor((caught / judged) * 1000) / 10, findings, reasonless, survivedKeys };
}

// ─── The confirm step ───────────────────────────────────────────────────

/**
 * The findings the confirm step must still check: the not-noticed ones in
 * the main list whose verdict is not cached. Stryker compiles every change
 * in at once and switches one on per test run, so code that runs while a
 * module loads (a registry filled at import) is never really changed, and its
 * changes read as not noticed although a test would fail on them: about one
 * finding in ten on the server's authorization code (2026-10-01). The
 * probably-harmless ones are not checked; their section says so.
 */
export function toConfirm(summary) {
  return summary.findings.filter((f) => f.status === "Survived" && !f.harmless && !f.confirmed);
}

/** `source` with the text at `location` replaced (lines and columns start at 1; the end is exclusive). */
export function applyChange(source, location, replacement) {
  const lines = source.split("\n");
  const offset = (p) => lines.slice(0, p.line - 1).reduce((sum, l) => sum + l.length + 1, 0) + p.column - 1;
  return source.slice(0, offset(location.start)) + replacement + source.slice(offset(location.end));
}

/**
 * What one run of the related tests says, read from vitest's JSON report
 * (`report`, undefined when none was written) and the process result:
 *   - "interrupted": the run was stopped by a signal (a Ctrl-C reaches the
 *     whole process group, vitest included), whether the process was killed
 *     by it or, as vitest does, caught it and exited 130 (SIGINT) or 143
 *     (SIGTERM) with no report;
 *   - "red": at least one test ran and failed;
 *   - "green": at least one test passed, none failed, and vitest exited 0;
 *   - "inconclusive": anything else (no report, no test ran or every one
 *     skipped, a file that failed to load, a crash), which proves nothing
 *     either way.
 *   - "timeout": the run outlived its time limit and was stopped; a change
 *     that makes the tests hang is noticed, as Stryker counts a timeout.
 * Only "green", "red" and "timeout" become verdicts. A test file that failed
 * to load, or a `beforeAll` that failed, is red only right after a green run
 * of the same tests with no change (`afterGreen`), even when it was the only
 * file and so no test ran at all: that is how a change to code that runs
 * while a module loads shows, and an engine that went down would have failed
 * the unchanged run too.
 */
export function relatedOutcome(result, report, { afterGreen = false } = {}) {
  if (result.error?.code === "ETIMEDOUT") return "timeout";
  // vitest catches SIGINT and SIGTERM itself and exits 128 plus the signal's number.
  if (result.signal || result.status === 130 || result.status === 143) return "interrupted";
  if (!report) return "inconclusive";
  if (report.numFailedTests > 0) return "red";
  if (report.numFailedTestSuites > 0) return afterGreen ? "red" : "inconclusive";
  // vitest counts skipped and todo tests in its total, so only a passed test proves one ran.
  if (!(report.numPassedTests > 0)) return "inconclusive";
  if (result.status === 0) return "green";
  return "inconclusive";
}

/** How long a run of a file's related tests may take: three times its unchanged run, and at least two minutes. */
export function confirmTimeout(baselineMs) {
  return Math.max(120_000, 3 * baselineMs);
}

/**
 * Applies each finding's change to the real file, runs every test that
 * imports it with the package's own config, and restores the file byte for
 * byte. `runRelated(relativePath)` returns `{ outcome, tests }`: the outcome
 * above and the package-relative test files that ran; it is told the time
 * limit for a changed run (three times the unchanged run, at least two
 * minutes, so a change that hangs cannot stall the sweep) and whether a green
 * run of the same tests came just before.
 *
 * The related tests first run once per file with no change: a file whose
 * tests are not green before any change (a flaky or failing test, an engine
 * that went down) gets no verdicts this run, since a red there would read as
 * a catch. A verdict records the content of every test file that ran
 * (`hashFile`), so it is dropped when one of them changes or goes away: a
 * catch that a later edit to the tests undid must be judged again.
 *
 * `deadline` (a time from `now`, in milliseconds) is the run's time budget: no
 * run starts whose limit could carry it past the deadline, and a file's
 * unchanged run is limited to the time that is left. When the budget is
 * spent the step stops, with the verdicts so far; the findings it did not
 * reach stay "not re-checked", and the next run's cache starts where this one
 * stopped. The first week of a large target has more findings to confirm
 * than a hosted job's six hours hold (the server's authorization code, about
 * two hours of them alone, 2026-10-01).
 *
 * The loop is synchronous, so a signal cannot be handled between steps; the
 * caller keeps one from killing the process mid-change, which would leave the
 * change in the file (`runTarget` does). An interrupted run is seen in the
 * child's result, restores the file, and stops with no verdict for that
 * finding. So a Ctrl-C is seen only while a child runs: one that lands
 * between two runs, or after vitest has already set a failing exit code, lets
 * the step go on to the next finding, and a second Ctrl-C stops it. Neither
 * records a wrong verdict. A file with uncommitted changes is refused, so
 * `git checkout` undoes whatever a killed process left.
 */
export function confirmFindings(findings, packageDir, { runRelated, isClean, hashFile, log = () => {}, deadline, now = Date.now }) {
  const verdicts = {};
  let interrupted = false;
  let handled = 0;
  // At the deadline exactly, a limit of zero would be no limit at all to spawnSync.
  const outOfTime = (limitMs) => deadline !== undefined && now() + limitMs >= deadline;
  const stopForBudget = () => log(`budget reached; ${findings.length - handled} finding(s) left not re-checked`);
  const byFile = new Map();
  for (const f of findings) byFile.set(f.relativePath, [...(byFile.get(f.relativePath) ?? []), f]);
  files: for (const [relativePath, group] of byFile) {
    const file = join(packageDir, relativePath);
    if (!isClean(file)) throw new Error(`${group[0].path} has uncommitted changes; the confirm step edits it and must be able to restore it from git`);
    if (outOfTime(0)) {
      stopForBudget();
      break;
    }
    const started = now();
    const baseline = runRelated(relativePath, { timeoutMs: deadline === undefined ? undefined : deadline - started, afterGreen: false });
    const timeoutMs = confirmTimeout(now() - started);
    if (baseline.outcome === "interrupted") {
      interrupted = true;
      break;
    }
    if (baseline.outcome === "timeout") {
      stopForBudget();
      break;
    }
    if (baseline.outcome !== "green") {
      log(`skipped    ${group[0].path}: its related tests are ${baseline.outcome} before any change, so ${group.length} finding(s) stay not re-checked`);
      handled += group.length;
      continue;
    }
    const original = readFileSync(file, "utf8");
    for (const f of group) {
      if (outOfTime(timeoutMs)) {
        stopForBudget();
        break files;
      }
      let run;
      try {
        writeFileSync(file, applyChange(original, f.location, f.replacement));
        run = runRelated(relativePath, { timeoutMs, afterGreen: true });
      } finally {
        writeFileSync(file, original);
      }
      if (run.outcome === "interrupted") {
        interrupted = true;
        break files;
      }
      handled += 1;
      if (run.outcome === "inconclusive") {
        log(`unclear    ${f.path}:${f.line} ${f.mutator} (no test failed, but the run did not pass)`);
        continue;
      }
      const tests = [...new Set([...baseline.tests, ...run.tests])].sort();
      verdicts[f.confirmKey] = { verdict: run.outcome === "green", tests: Object.fromEntries(tests.map((t) => [t, hashFile(t)])) };
      log(`${run.outcome === "green" ? "confirmed" : "refuted  "}  ${f.path}:${f.line} ${f.mutator}${run.outcome === "timeout" ? " (the tests hung)" : ""}`);
    }
  }
  return { verdicts, interrupted };
}

/**
 * The cached verdicts still worth keeping: the finding is still reported
 * (its key, which carries the file's content, is in `liveKeys`), and every
 * test file that ran for it has the same content now (`hashFile` returns
 * undefined for a file that is gone).
 *
 * What a verdict does not see: a change to a file the tests import but do not
 * name (a shared helper, a fixture, another source module) or to the vitest
 * config. An edit there that undoes a catch keeps the cached refutation, and
 * the finding stays hidden until the changed file, or a test that ran, is
 * touched. Stryker's own incremental mode has the same limit. Removing the
 * target's `confirmed.json` judges every finding again.
 */
export function keepVerdicts(cached, liveKeys, hashFile) {
  const kept = {};
  for (const [key, entry] of Object.entries(cached)) {
    if (!liveKeys.has(key) || typeof entry?.verdict !== "boolean") continue;
    if (Object.entries(entry.tests ?? {}).every(([test, hash]) => hashFile(test) === hash)) kept[key] = entry;
  }
  return kept;
}

/** The verdicts `summarize` reads: true (confirmed) or false (refuted), by confirm key. */
export function verdictsOf(entries) {
  return Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.verdict]));
}

/** What changed since the previous run's list: keys new this run, and keys gone from it. */
export function compareRuns(previousKeys, currentKeys) {
  const before = new Set(previousKeys);
  const now = new Set(currentKeys);
  return { added: [...now].filter((k) => !before.has(k)), gone: [...before].filter((k) => !now.has(k)) };
}

// ─── The issue ──────────────────────────────────────────────────────────

/** The most findings an issue lists; the rest are counted. */
const MAX_LISTED = 200;

/** The most characters of visible text a body carries; the lists stop short of it, whatever their lines' length. */
const MAX_TEXT = 55_000;

/**
 * The longest body the script writes. GitHub refuses one over 65,536
 * characters, and the hidden list of finding keys grows with the findings, not
 * with what is listed: past this, the keys are left out and marked partial,
 * and the next run reports no week-to-week change rather than a wrong one.
 */
export const MAX_BODY = 60_000;

const MARKER = "mutation-sweep";

/** The hidden line that names an issue's target. */
export function targetMarker(name) {
  return `<!-- ${MARKER}:target=${name} -->`;
}

/**
 * The finding keys a previous body recorded: none for a body without the
 * marker (a new issue), undefined when the body recorded too many to keep, so
 * no change can be computed against it.
 */
export function keysFromBody(body) {
  if ((body ?? "").includes(`<!-- ${MARKER}:keys-partial -->`)) return undefined;
  const match = new RegExp(`<!-- ${MARKER}:keys=([0-9a-f,]*) -->`).exec(body ?? "");
  return match && match[1] ? match[1].split(",") : [];
}

/**
 * `text` as a Markdown code span, fenced by one more backtick than its
 * longest run, so a template literal stays one span and a test name such as
 * "(#776)" is shown, not turned into a link to an unrelated issue.
 */
export function codeSpan(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

function findingLine(f) {
  const ran = f.tests.length === 0 ? "" : ` -- ran by: ${codeSpan(oneLine(f.tests[0], 70))}${f.tests.length > 1 ? ` and ${f.tests.length - 1} more` : ""}`;
  const unchecked = f.status === "Survived" && !f.harmless && !f.confirmed ? " (not re-checked)" : "";
  return `- L${f.line} ${codeSpan(oneLine(f.original, 60))} -> ${codeSpan(oneLine(f.replacement, 60))} (${f.mutator})${ran}${unchecked}`;
}

/**
 * Takes lines from `entries` while the shared budget (`lines` left and
 * `chars` left) allows; each entry is the lines it adds. Returns the lines
 * taken and how many entries they hold.
 */
function takeWithin(entries, budget) {
  const lines = [];
  let taken = 0;
  for (const add of entries) {
    const cost = add.reduce((n, l) => n + l.length + 1, 0);
    if (budget.lines === 0 || cost > budget.chars) break;
    lines.push(...add);
    taken += 1;
    budget.lines -= 1;
    budget.chars -= cost;
  }
  return { lines, taken };
}

/** Findings grouped under their file's name, as the entries `takeWithin` takes. */
function byFileEntries(findings) {
  let file;
  return findings.map((f) => {
    const add = f.path === file ? [] : ["", `**${codeSpan(f.path)}**`];
    file = f.path;
    return [...add, findingLine(f)];
  });
}

/**
 * The issue for one target: its title, and a body a person can act on that
 * also carries, hidden, the target's name and this run's finding keys.
 */
export function renderIssue({ name, target, summary, change, commit, runUrl }) {
  const notNoticed = summary.findings.filter((f) => f.status === "Survived" && !f.harmless);
  const harmless = summary.findings.filter((f) => f.status === "Survived" && f.harmless);
  const neverRun = summary.findings.filter((f) => f.status === "NoCoverage");
  const title = `Mutation sweep: ${target.title} -- ${notNoticed.length} change${notNoticed.length === 1 ? "" : "s"} no test notices`;
  const c = summary.counts;
  const facts = [
    runUrl ? `[run](${runUrl})` : undefined,
    commit ? `at \`${commit.slice(0, 9)}\`` : undefined,
    `${c.killed + c.timeout + c.refuted} of ${c.total} changes caught${summary.score === undefined ? "" : ` (${summary.score}%)`}`,
    c.refuted > 0 ? `${c.refuted} that Stryker missed were caught on re-check` : undefined,
    change ? `${change.added.length} new and ${change.gone.length} gone since the last run` : undefined,
  ].filter(Boolean);
  const body = [
    targetMarker(name),
    `The weekly mutation sweep planted ${c.total} small changes, one at a time, in ${target.title} (\`${target.package}\`: ${target.mutate.map((g) => `\`${g}\``).join(", ")}), and ran every test that imports the file. The changes under "Not noticed" were **not noticed**: every one of those tests still passed with the change in place. Each was applied again for real, outside Stryker, with the same result, except those marked "(not re-checked)", which are Stryker's verdict alone.`,
    "",
    "A finding is closed by a test that fails when the code is changed that way. When the change truly makes no difference (two ways of writing the same thing), the line above it carries `// Stryker disable next-line <rule>: <why it makes no difference>`, and the reviewer judges the reason. To check a fix locally:",
    "",
    "```",
    `node scripts/mutation-sweep.mjs --targets <targets file> --run ${name} --out <dir> --only <file>`,
    "```",
    "",
    facts.join(" · "),
  ];
  const budget = { lines: MAX_LISTED, chars: MAX_TEXT - body.join("\n").length };
  for (const [heading, group, note] of [
    [`Not noticed (${notNoticed.length})`, notNoticed, undefined],
    [`Never run by any test (${neverRun.length})`, neverRun, "No test runs these lines at all, so no change to them can be noticed."],
    [`Probably harmless: messages and payloads (${harmless.length})`, harmless, "A blanked string or an emptied object that no test noticed: mostly error messages and log or event payloads, listed so the few that matter (an error name a caller compares) are seen. Not re-checked."],
  ]) {
    if (group.length === 0) continue;
    const { lines, taken } = takeWithin(byFileEntries(group), budget);
    body.push("", `### ${heading}`, ...(note ? ["", note] : []), ...lines);
    if (taken < group.length) body.push("", `…and ${group.length - taken} more in the run's \`mutation.json\`.`);
  }
  if (summary.reasonless.length > 0) {
    const { lines, taken } = takeWithin(summary.reasonless.map((r) => [`- ${codeSpan(`${r.path}:${r.line}`)} ${codeSpan(oneLine(r.text, 100))}`]), budget);
    body.push("", `### Disable comments without a reason (${summary.reasonless.length})`, "", ...lines);
    if (taken < summary.reasonless.length) body.push("", `…and ${summary.reasonless.length - taken} more.`);
  }
  if (summary.findings.length === 0 && summary.reasonless.length === 0) body.push("", "Every change was caught. This issue closes itself, and reopens if a finding returns.");
  const keys = `<!-- ${MARKER}:keys=${summary.findings.map((f) => f.key).join(",")} -->`;
  const text = body.join("\n");
  const fits = text.length + keys.length + 3 <= MAX_BODY;
  return { title, body: `${text}\n\n${fits ? keys : `<!-- ${MARKER}:keys-partial -->`}\n` };
}

/** Whether a target's run left anything for a person to do. */
export function hasWork(summary) {
  return summary.findings.length > 0 || summary.reasonless.length > 0;
}

/**
 * What to do with a target's issue: `existing` is the open or closed issue
 * that carries its marker, if any. Returns the gh calls to make, in order, as
 * argument lists (the body is passed as a file, `{body}` in an argument).
 */
export function publishPlan({ repo, existing, rendered, work, change }) {
  if (!existing) {
    if (!work) return [];
    return [["issue", "create", "--repo", repo, "--label", LABEL, "--title", rendered.title, "--body-file", "{body}"]];
  }
  const number = String(existing.number);
  const calls = [];
  const open = existing.state === "OPEN";
  if (work && !open) calls.push(["issue", "reopen", number, "--repo", repo]);
  calls.push(["issue", "edit", number, "--repo", repo, "--title", rendered.title, "--body-file", "{body}"]);
  const moved = change.added.length + change.gone.length > 0;
  if (moved && (work || open)) {
    calls.push(["issue", "comment", number, "--repo", repo, "--body", `${change.added.length} new and ${change.gone.length} gone since the last run.`]);
  }
  if (!work && open) calls.push(["issue", "close", number, "--repo", repo, "--comment", "Every change was caught this run."]);
  return calls;
}

// ─── The command ────────────────────────────────────────────────────────

function gh(args, input) {
  return execFileSync("gh", args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 });
}

/** The confirm step's verdicts, beside the report; cached between weekly runs with the incremental file. */
export const CONFIRMED_FILE = "confirmed.json";

/** Every `target.json` under the inputs, at any depth, with the report beside it. */
export function readRuns(dirs) {
  const runs = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (entry === "target.json") {
        const meta = JSON.parse(readFileSync(path, "utf8"));
        const reportPath = join(dir, "mutation.json");
        const confirmedPath = join(dir, CONFIRMED_FILE);
        const confirmed = existsSync(confirmedPath) ? verdictsOf(JSON.parse(readFileSync(confirmedPath, "utf8"))) : {};
        runs.push({ ...meta, report: JSON.parse(readFileSync(reportPath, "utf8")), confirmed });
      }
    }
  };
  for (const dir of dirs) visit(dir);
  return runs;
}

function parseArgs(argv) {
  const opts = { targets: undefined, run: undefined, out: undefined, only: undefined, dryRun: false, budget: undefined, list: false, report: false, inputs: [], json: false, publish: false, failed: false, repo: undefined, runUrl: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--targets") opts.targets = argv[++i];
    else if (arg === "--run") opts.run = argv[++i];
    else if (arg === "--out") opts.out = argv[++i];
    else if (arg === "--only") opts.only = argv[++i];
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--budget") opts.budget = Number(argv[++i]);
    else if (arg === "--list") opts.list = true;
    else if (arg === "--report") opts.report = true;
    else if (arg === "--input") opts.inputs.push(argv[++i]);
    else if (arg === "--json") opts.json = true;
    else if (arg === "--publish") opts.publish = true;
    else if (arg === "--failed") opts.failed = true;
    else if (arg === "--repo") opts.repo = argv[++i];
    else if (arg === "--run-url") opts.runUrl = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  const modes = [opts.run !== undefined, opts.list, opts.report, opts.failed].filter(Boolean).length;
  if (modes !== 1) throw new Error("give exactly one of --run <target>, --list, --report or --failed");
  if (opts.failed && !(opts.repo && opts.runUrl)) throw new Error("--failed needs --repo and --run-url");
  if (!opts.failed && !opts.targets) throw new Error("--targets <file> is required");
  if (opts.run !== undefined && !opts.out) throw new Error("--run needs --out <dir>");
  if ((opts.only || opts.dryRun || opts.budget !== undefined) && opts.run === undefined) throw new Error("--only, --dry-run and --budget are for --run");
  if (opts.dryRun && (opts.only || opts.budget !== undefined)) throw new Error("--dry-run runs the whole target's first run and confirms nothing, so it takes no --only or --budget");
  if (opts.budget !== undefined && !(opts.budget > 0)) throw new Error("--budget is a number of minutes, more than 0");
  if (opts.report && opts.inputs.length === 0) throw new Error("--report needs at least one --input <dir>");
  if (opts.publish && !(opts.report && opts.repo)) throw new Error("--publish is for --report, with --repo");
  return opts;
}

function root() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
}

function loadTargets(path) {
  const { targets, problems } = readTargets(readFileSync(resolve(path), "utf8"));
  if (problems.length > 0) throw new Error(`${path}: ${problems.join("; ")}`);
  return targets;
}

/**
 * Runs every test that imports `file` (package-relative) with the package's
 * own config, writing vitest's JSON report to `reportPath`, and reads the
 * outcome (`relatedOutcome`) and the test files that ran. A run that outlives
 * `timeoutMs` is stopped and reads "timeout"; any other failure to start it
 * is thrown, since it proves nothing about the change. The limit sends
 * SIGTERM to `npx`, which passes it on to vitest and waits for it: vitest
 * exits on it (143), so a change that hangs a test cannot hold the step, but
 * a test runner that ignored SIGTERM would.
 */
export function runRelatedTests(packageDir, file, reportPath, { timeoutMs, afterGreen }) {
  rmSync(reportPath, { force: true });
  const run = spawnSync("npx", ["--no-install", "vitest", "related", "--run", file, "--reporter=json", `--outputFile=${reportPath}`], { cwd: packageDir, stdio: "ignore", timeout: timeoutMs });
  if (run.error && run.error.code !== "ETIMEDOUT") throw run.error;
  let json;
  try {
    json = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch {
    json = undefined;
  }
  const tests = (json?.testResults ?? []).map((t) => relative(packageDir, t.name).split("\\").join("/"));
  return { outcome: relatedOutcome(run, json, { afterGreen }), tests };
}

/**
 * Removes the setup files Stryker's vitest runner writes into the package,
 * `stryker-setup-<worker>.js`, one per test-runner worker. Run in place, it
 * deletes each only when that worker's vitest closes, and the runner a freed
 * checker becomes is not always closed first: a one-file sweep of the
 * runner's pricing code left `stryker-setup-1.js` behind (Stryker 10.0.0,
 * 2026-10-02), which the next run refuses as an untracked file.
 */
function removeStrykerSetupFiles(packageDir) {
  for (const entry of readdirSync(packageDir)) {
    if (/^stryker-setup-\d+\.js$/.test(entry)) rmSync(join(packageDir, entry), { force: true });
  }
}

async function runTarget(opts) {
  const targets = loadTargets(opts.targets);
  const target = targets[opts.run];
  if (!target) throw new Error(`no target "${opts.run}" in ${opts.targets} (known: ${Object.keys(targets).join(", ")})`);
  const repo = root();
  const packageDir = join(repo, target.package);
  // A one-file check and a dry run write beside the weekly run's directory,
  // never into it, so neither can replace that run's report or its cache.
  const outDir = resolve(opts.out, opts.only ? `${opts.run}.only` : opts.dryRun ? `${opts.run}.dry-run` : opts.run);
  mkdirSync(outDir, { recursive: true });
  // The record names this run's commit only once this run's report exists.
  // The directory may hold an earlier run's record and report (a workflow
  // restores last week's state into it), so both go before anything can
  // refuse the run: a refused run must leave nothing to publish.
  rmSync(join(outDir, "target.json"), { force: true });
  rmSync(join(outDir, "mutation.json"), { force: true });
  // Both sides through realpath: git names the repository by its real path, and a
  // path given through a symlink (macOS's /var is /private/var) would read as outside it.
  if (opts.only && !existsSync(opts.only)) throw new Error(`--only ${opts.only}: no such file`);
  const only = opts.only ? relative(realpathSync(packageDir), realpathSync(resolve(opts.only))).split("\\").join("/") : undefined;
  if (only && only.startsWith("..")) throw new Error(`--only ${opts.only} is not inside ${target.package}`);
  // Untracked files count: Stryker changes a file a glob matches whether git
  // tracks it or not, and git cannot restore an untracked one after a killed run.
  const dirty = execFileSync("git", ["status", "--porcelain", "--", target.package], { cwd: repo, encoding: "utf8" }).trim();
  if (dirty) throw new Error(`${target.package} has uncommitted changes or untracked files; the sweep changes its files in place and must be able to restore them from git:\n${dirty}`);
  const configPath = join(outDir, "stryker.config.json");
  writeFileSync(configPath, `${JSON.stringify(strykerConfig(target, outDir, { only, dryRun: opts.dryRun }), null, 2)}\n`);
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const result = spawnSync("npx", ["--no-install", "stryker", "run", configPath], { cwd: packageDir, stdio: "inherit" });
  removeStrykerSetupFiles(packageDir);
  if (result.error) throw result.error;
  if (result.status !== 0) return result.status ?? 2;
  if (opts.dryRun) {
    console.log(`mutation-sweep: ${opts.run}'s tests pass under Stryker; nothing was swept`);
    return 0;
  }

  // The confirm step. The cache holds the earlier runs' verdicts (restored
  // beside the incremental file); one is kept only while its finding is still
  // reported and the tests that judged it are unchanged.
  const confirmedPath = join(outDir, CONFIRMED_FILE);
  const hashFile = (test) => {
    const path = join(packageDir, test);
    return existsSync(path) ? contentHash(readFileSync(path, "utf8")) : undefined;
  };
  const report = JSON.parse(readFileSync(join(outDir, "mutation.json"), "utf8"));
  const unjudged = summarize(report, target.package);
  const cached = keepVerdicts(existsSync(confirmedPath) ? JSON.parse(readFileSync(confirmedPath, "utf8")) : {}, new Set(unjudged.survivedKeys), hashFile);
  // Only the verdicts still worth keeping stay beside the report, before the
  // confirm step can fail: a stale one must never outlive a run that threw.
  writeFileSync(confirmedPath, `${JSON.stringify(cached, null, 2)}\n`);
  const pending = toConfirm(summarize(report, target.package, { confirmed: verdictsOf(cached) }));
  console.log(`mutation-sweep: confirming ${pending.length} not-noticed change(s) against every test that imports each file`);
  const vitestReport = join(outDir, "related.json");
  // The confirm step changes a real file while each child runs, so a signal
  // must not kill this process mid-change. The loop is synchronous, so Node
  // runs these listeners only once it returns: a Ctrl-C reaches the child too
  // and is seen at once, while a signal sent to this process alone is seen
  // when the step ends, which then exits 130 instead of 0.
  const received = [];
  const note = (signal) => received.push(signal);
  process.on("SIGINT", note);
  process.on("SIGTERM", note);
  let outcome;
  try {
    outcome = confirmFindings(pending, packageDir, {
      runRelated: (file, options) => runRelatedTests(packageDir, file, vitestReport, options),
      isClean: (file) => execFileSync("git", ["status", "--porcelain", "--", file], { cwd: repo, encoding: "utf8" }).trim() === "",
      hashFile,
      log: (line) => console.log(`mutation-sweep: ${line}`),
      deadline: opts.budget === undefined ? undefined : opts.startedAt + opts.budget * 60_000,
    });
    // A signal that arrived while a child ran waits for the event loop to
    // deliver it. One turn is enough on Node 22 but not on 23, which delivers
    // it only after a timer has run; a short timer covers both.
    await new Promise((settle) => setTimeout(settle, 100));
  } finally {
    process.off("SIGINT", note);
    process.off("SIGTERM", note);
  }
  const interrupted = outcome.interrupted || received.length > 0;
  rmSync(vitestReport, { force: true });
  writeFileSync(confirmedPath, `${JSON.stringify({ ...cached, ...outcome.verdicts }, null, 2)}\n`);
  // The record comes last, so a run whose confirm step threw leaves none for
  // `--report` to publish.
  writeFileSync(join(outDir, "target.json"), `${JSON.stringify({ target: opts.run, package: target.package, commit, only: only ?? null }, null, 2)}\n`);
  if (interrupted) console.error("mutation-sweep: interrupted; the file being checked was restored, and the verdicts so far are saved");
  return interrupted ? 130 : 0;
}

/** The targets file's targets, validated, as `[{ name, package }]`: what a workflow builds its matrix from. */
function listTargets(opts) {
  const targets = loadTargets(opts.targets);
  console.log(JSON.stringify(Object.entries(targets).map(([name, target]) => ({ name, package: target.package }))));
  return 0;
}

function previousIssues(repo) {
  const listed = JSON.parse(gh(["issue", "list", "--repo", repo, "--label", LABEL, "--state", "all", "--limit", "200", "--json", "number,state,body"]));
  return listed;
}

function report(opts) {
  const targets = loadTargets(opts.targets);
  const runs = readRuns(opts.inputs.map((d) => resolve(d)));
  if (runs.length === 0) {
    console.error("mutation-sweep: no target.json under the inputs; nothing ran, so nothing can be reported");
    return 2;
  }
  const unknown = runs.filter((r) => !targets[r.target]);
  if (unknown.length > 0) {
    console.error(`mutation-sweep: reports for targets the file does not name: ${unknown.map((r) => r.target).join(", ")}`);
    return 2;
  }
  const issues = opts.publish ? previousIssues(opts.repo) : [];
  const out = [];
  for (const run of runs) {
    const target = targets[run.target];
    const summary = summarize(run.report, target.package, { confirmed: run.confirmed });
    const existing = issues.find((i) => (i.body ?? "").includes(targetMarker(run.target)));
    const previousKeys = keysFromBody(existing?.body);
    const change = existing && previousKeys ? compareRuns(previousKeys, summary.findings.map((f) => f.key)) : undefined;
    const rendered = renderIssue({ name: run.target, target, summary, change, commit: run.commit, runUrl: opts.runUrl });
    out.push({ target: run.target, summary, rendered });
    if (opts.publish && !run.only) {
      const bodyDir = mkdtempSync(join(tmpdir(), "mutation-sweep-"));
      try {
        const bodyFile = join(bodyDir, "body.md");
        writeFileSync(bodyFile, rendered.body);
        for (const call of publishPlan({ repo: opts.repo, existing, rendered, work: hasWork(summary), change: change ?? { added: [], gone: [] } })) {
          gh(call.map((a) => (a === "{body}" ? bodyFile : a)));
        }
      } finally {
        rmSync(bodyDir, { recursive: true, force: true });
      }
    }
  }
  if (opts.json) {
    console.log(JSON.stringify(out.map(({ target, summary }) => ({ target, ...summary })), null, 2));
  } else {
    for (const { target, summary, rendered } of out) {
      const c = summary.counts;
      console.log(`• ${target}: ${c.total} changes, ${c.killed + c.timeout + c.refuted} caught (${c.refuted} on re-check), ${c.survived} not noticed, ${c.noCoverage} never run, ${summary.reasonless.length} reasonless disable(s)${summary.score === undefined ? "" : ` (${summary.score}%)`}`);
      if (!opts.publish) console.log(`\n${rendered.title}\n\n${rendered.body}`);
    }
  }
  return 0;
}

function failed(opts) {
  const open = JSON.parse(gh(["issue", "list", "--repo", opts.repo, "--label", FAILURE_LABEL, "--state", "open", "--json", "number"]));
  if (open.length > 0) {
    gh(["issue", "comment", String(open[0].number), "--repo", opts.repo, "--body", `The mutation sweep failed again: ${opts.runUrl}`]);
  } else {
    gh(["issue", "create", "--repo", opts.repo, "--label", FAILURE_LABEL, "--title", "Mutation sweep: the weekly run could not sweep", "--body", `The weekly mutation sweep failed: ${opts.runUrl}\n\nA failure here is the sweep's own (a target's tests red before any change was planted, Stryker crashing, a timeout), not a finding about the tests. The target issues are left as the last good run wrote them. Later failures comment here; close this once a run is green.`]);
  }
  return 0;
}

async function main(argv) {
  const startedAt = Date.now();
  const opts = { ...parseArgs(argv), startedAt };
  if (opts.run !== undefined) return runTarget(opts);
  if (opts.list) return listTargets(opts);
  if (opts.failed) return failed(opts);
  return report(opts);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`mutation-sweep: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
