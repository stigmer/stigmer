#!/usr/bin/env node

/**
 * Refuses a change whose new lines no test runs, and a package whose tests
 * quietly run less of it than they did.
 *
 * A green run says the tests passed; it does not say they ran the code a
 * change added. A forty-line handler can land with an error branch nobody
 * ever executed, and a package can lose a third of its tested code over a
 * month of pull requests that each looked fine. This script reads what the
 * gate's own test runs measured (vitest's v8 coverage, written as Istanbul's
 * `coverage-final.json`, and vitest's JSON report) and judges two things:
 *
 *   - the change: every executable statement on a line the change added, in a
 *     file a measured package's coverage includes, must have run at least
 *     once. A statement spanning several lines counts when any of its lines
 *     was added, so an edit in the middle of a long call is judged too. The
 *     one exception is v8's own ignore hint in the code
 *     (`/* v8 ignore next -- @preserve: <reason> *\/`): the provider drops
 *     those statements, and the hint and its reason sit in the diff for the
 *     reviewer to judge.
 *   - each package against its floor: the share of its lines and of its
 *     branches its tests ran, and how many of its cases passed, must not fall
 *     below the committed floor (--floors). A floor is the lowest a package
 *     may fall to, not its last measurement, so a pull request edits the
 *     file only to add a new package, to lower a floor it declares, or to
 *     raise its own early; `--raise` lifts the floors from a full run, and
 *     never lowers one.
 *
 * Inputs are found under each --input directory, at any depth: every
 * `coverage-final.json` and every vitest JSON report (a `report.json`, or any
 * JSON file with `testResults`). The paths inside them are absolute paths on
 * the machine that ran the tests, which need not be this one, so each is
 * matched to the tracked file it ends with. A file is attributed to the
 * package with the nearest package.json. Coverage of one package collected in
 * several runs (the shards of one suite, one package run by two lanes) is
 * merged by summing its hit counts, and a test file reported by two runs
 * counts its cases once, from the run that passed more of them.
 *
 * The inputs are expected from the subject configs as they are set: AST-aware
 * remapping (`coverage.experimentalAstAwareRemapping`), whose statements and
 * branches are the source's own, so every run of one file reports the same
 * map. The default remapping's map depends on what V8 happened to compile in
 * that run, so two shards could disagree and the file would be refused as a
 * mismatch. And every source file under a config's `include` is listed, a
 * file no test loads at zero (vitest's `coverage.all`), so a changed source
 * file the coverage does not list is one its config excludes.
 *
 * Every new ignore hint says why. With --base, an added line holding one of
 * the provider's hints (`istanbul`, `c8`, `v8` or `node:coverage`, then
 * `ignore`, then `if`, `else`, `next`, `file`, `start` or `stop`) in a code
 * file is refused (`ignore-reason`) unless the hint carries a reason after a
 * `--`; `stop` only closes a `start`, so it needs none. In TypeScript and JSX
 * an `if`, `else` or `next` hint must also be a legal comment (`@preserve`):
 * the transform strips every other comment before the provider reads the
 * code, so a plain one ignores nothing (measured 2026-10-02 under vitest
 * 3.2.4; `start` and `stop` are read from the source text and survive). And
 * `ignore file` is refused outright: a whole module out of its package's
 * figures belongs in the vitest config's `exclude`, where the gate's own
 * files are reviewed, not in a comment. An existing hint is never read, only
 * the lines a change adds, and the rule holds in every file, measured or not,
 * so it never depends on which packages a run measured.
 *
 * A floor that moves is judged on a run that measured it. With --base, every
 * package whose floor the change adds or changes (any figure, up or down;
 * test-integrity.mjs refuses a lowered one the pull request does not declare)
 * must have been measured in this run, or it is refused
 * (`floor-unmeasured`): a floor set by hand and never measured would merge
 * green and fail the next change that touches its package. The base's floors
 * file is the one at the same path at the merge base.
 *
 * Only the packages this run measured are judged, because a pull request
 * runs only the packages it affects. A package with a floor whose source the
 * change edits must have been measured, or the change cannot be judged and is
 * refused; a measured package with no floor is refused too, so a new package
 * cannot enter the gate unmeasured. Changed code outside every measured
 * package's coverage (scripts, other languages, files a config excludes) is
 * listed as not measured and refused nowhere.
 *
 * A change can run no package's tests at all (a pull request that edits only
 * a workflow), so with --base a run with no coverage is still judged: every
 * changed source file in a floored package is then `unmeasured`, and nothing
 * else is. Without --base (a full run, a raise) no coverage means the run
 * measured nothing, which cannot be judged.
 *
 * The floors file:
 *   {
 *     "margin": { "lines": 0.5, "branches": 0.5, "cases": 0 },
 *     "packages": { "<package dir>": { "lines": 81.4, "branches": 72.0, "cases": 2397 } }
 *   }
 * `margin` is how far below a full run's measurement `--raise` sets a floor:
 * two runs of one commit can cover slightly different lines when a test's path
 * depends on timing, and a floor at the bare measurement would fail unrelated
 * pull requests.
 *
 * Usage:
 *   node scripts/test-coverage.mjs --floors <file> --input <dir> [--input <dir> ...]
 *       [--base <ref>] [--json]
 *   node scripts/test-coverage.mjs --floors <file> --input <dir> ... --raise
 *   node scripts/test-coverage.mjs --floors <file> --from-run <run id> --raise
 * A raise needs a full run, one that measured every package with a floor: a
 * dispatched `Gate` (`gh workflow run ci.gate.yaml --ref main`) runs every
 * lane and every package. A pull-request or merge-queue run measures only
 * what its change reaches, and a raise refuses it as not a full run.
 * Exit: 0 clean (or floors written), 1 findings, 2 the script could not judge
 * (a usage or git error, unreadable input, no coverage at all without --base,
 * or coverage that matches no tracked file).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// ─── What a coverage file and a report look like ────────────────────────

/** The file name vitest's `json` coverage reporter writes. */
export const COVERAGE_FILE = "coverage-final.json";

/** Source files whose changed lines can be judged at all: anything else (docs, data, other languages) is not code a vitest run measures. */
const CODE = /\.(?:[cm]?[jt]sx?)$/;

/** A test file is the subject of the integrity tool, not of coverage. */
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

const FIGURES = ["lines", "branches", "cases"];

/**
 * A coverage ignore hint on a line: the provider's own prefixes and directives
 * (ast-v8-to-istanbul 0.3.12, `IGNORE_PATTERN` and `IGNORE_LINES_PATTERN` in
 * its ignore-hints module), anywhere on the line. The provider reads `start`
 * and `stop` as plain text on any line, a JSDoc continuation line included,
 * and `if`, `else`, `next` and `file` at the start of a comment's text, which
 * can be a later line of a block comment; so no comment opener is required
 * here. This matches wider than the provider, so a hint it would not honour
 * (or the words in a string) is also asked for its reason, which hides
 * nothing.
 */
const IGNORE_HINT = /\b(?:istanbul|[cv]8|node:coverage)\s+ignore\s+(if|else|next|file|start|stop)(?=\W|$)/;

/** The separators a declaration accepts (test-integrity.mjs `DECLARATION`), before a hint's reason. */
const REASON = /(?:--|—|–)(.*)$/;

/** Sources the TypeScript transform rewrites, stripping every comment that is not a legal one. */
const TRANSFORMED = /\.(?:[cm]?tsx?|jsx)$/;

/** The hints read from the transformed code's comments, which only a legal comment survives to. */
const AST_HINTS = new Set(["if", "else", "next"]);

// ─── Reading the inputs ─────────────────────────────────────────────────

/** Every file under `dir`, at any depth. */
export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * The inputs found under the given directories: `{ coverage: [map], reports: [report] }`.
 * A JSON file that is neither is ignored; one that is not JSON throws (the run cannot be judged).
 */
export function readInputs(dirs) {
  const coverage = [];
  const reports = [];
  for (const dir of dirs) {
    for (const path of walk(dir)) {
      if (!path.endsWith(".json")) continue;
      const name = posix.basename(path.split("\\").join("/"));
      if (name === COVERAGE_FILE) {
        coverage.push(JSON.parse(readFileSync(path, "utf8")));
        continue;
      }
      if (name === "coverage-summary.json") continue;
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(data?.testResults)) reports.push(data);
    }
  }
  return { coverage, reports };
}

/**
 * A resolver from an absolute path on any machine to the tracked file it ends
 * with, or undefined. The longest tracked suffix wins, so `a/src/x.ts` is not
 * mistaken for `src/x.ts`.
 */
export function makeRelativizer(tracked) {
  const set = new Set(tracked);
  return (absolute) => {
    const parts = String(absolute).split("\\").join("/").split("/");
    for (let i = 0; i < parts.length; i++) {
      const candidate = parts.slice(i).join("/");
      if (set.has(candidate)) return candidate;
    }
    return undefined;
  };
}

/** The package directory that owns `path`: the nearest directory with a package.json ("." for the root). */
export function packageOf(path, packageDirs) {
  let dir = posix.dirname(path);
  while (true) {
    if (packageDirs.has(dir)) return dir;
    if (dir === "." || dir === "/" || dir === "") return ".";
    dir = posix.dirname(dir);
  }
}

// ─── Merging and measuring ──────────────────────────────────────────────

/** Two inputs measured the same source the same way when every statement and branch sits at the same place. */
function sameShape(a, b) {
  const branches = (map) => Object.entries(map ?? {}).map(([id, branch]) => [id, branch.locations]);
  return JSON.stringify(a.statementMap) === JSON.stringify(b.statementMap)
    && JSON.stringify(branches(a.branchMap)) === JSON.stringify(branches(b.branchMap));
}

/**
 * One coverage entry per tracked file, hit counts summed across every input.
 * Returns `{ files: Map<path, entry>, unmatched: [absolute path], mismatched: [path] }`.
 * Two inputs for one file that disagree on its statements or branches were
 * measured from different source or a different config; their sum would be
 * meaningless, so the file is reported instead.
 */
export function mergeCoverage(maps, relativize) {
  const files = new Map();
  const unmatched = [];
  const mismatched = new Set();
  for (const map of maps) {
    for (const [absolute, entry] of Object.entries(map)) {
      const path = relativize(entry.path ?? absolute);
      if (!path) {
        unmatched.push(entry.path ?? absolute);
        continue;
      }
      const current = files.get(path);
      if (!current) {
        files.set(path, {
          path,
          statementMap: entry.statementMap ?? {},
          branchMap: entry.branchMap ?? {},
          s: { ...(entry.s ?? {}) },
          b: Object.fromEntries(Object.entries(entry.b ?? {}).map(([k, v]) => [k, [...v]])),
        });
        continue;
      }
      if (!sameShape(current, { statementMap: entry.statementMap ?? {}, branchMap: entry.branchMap ?? {} })) {
        mismatched.add(path);
        continue;
      }
      for (const [id, count] of Object.entries(entry.s ?? {})) current.s[id] = (current.s[id] ?? 0) + count;
      for (const [id, counts] of Object.entries(entry.b ?? {})) {
        const into = current.b[id] ?? (current.b[id] = counts.map(() => 0));
        counts.forEach((count, i) => { into[i] = (into[i] ?? 0) + count; });
      }
    }
  }
  return { files, unmatched, mismatched: [...mismatched] };
}

/**
 * A file's line hits, Istanbul's way: a line is the start line of a
 * statement, and its count is the highest of the statements starting there.
 */
export function lineHits(entry) {
  const lines = new Map();
  for (const [id, loc] of Object.entries(entry.statementMap)) {
    const line = loc.start.line;
    const count = entry.s[id] ?? 0;
    if (!lines.has(line) || lines.get(line) < count) lines.set(line, count);
  }
  return lines;
}

/** Covered and total lines and branch outcomes of one file. */
export function fileTotals(entry) {
  const lines = lineHits(entry);
  let linesCovered = 0;
  for (const count of lines.values()) if (count > 0) linesCovered++;
  let branches = 0;
  let branchesCovered = 0;
  for (const counts of Object.values(entry.b)) {
    for (const count of counts) {
      branches++;
      if (count > 0) branchesCovered++;
    }
  }
  return { lines: lines.size, linesCovered, branches, branchesCovered };
}

/** A share in percent; nothing to measure counts as fully measured. */
export function percent(covered, total) {
  return total === 0 ? 100 : (covered / total) * 100;
}

/**
 * The passed cases per package. A test file reported by more than one run
 * (one package run by two lanes) counts once, at the run that passed more of
 * its cases. Cases are counted, not named: two cases of one file may share a
 * title (an `it.each` row, a repeated name), and each is a case.
 */
export function casesByPackage(reports, relativize, packageDirs) {
  const byFile = new Map();
  for (const report of reports) {
    for (const file of report.testResults ?? []) {
      const path = relativize(file.name);
      if (!path) continue;
      const passed = (file.assertionResults ?? []).filter((result) => result.status === "passed").length;
      byFile.set(path, Math.max(byFile.get(path) ?? 0, passed));
    }
  }
  const packages = new Map();
  for (const [path, passed] of byFile) {
    const pkg = packageOf(path, packageDirs);
    packages.set(pkg, (packages.get(pkg) ?? 0) + passed);
  }
  return packages;
}

/**
 * Each measured package's figures: `Map<package, { lines, branches, cases, files, ... }>`.
 * `cases` is undefined for a package whose run report was not given.
 */
export function measure(files, cases, packageDirs) {
  const packages = new Map();
  for (const entry of files.values()) {
    const pkg = packageOf(entry.path, packageDirs);
    const sum = packages.get(pkg) ?? { files: 0, lineTotal: 0, linesCovered: 0, branchTotal: 0, branchesCovered: 0 };
    const t = fileTotals(entry);
    sum.files++;
    sum.lineTotal += t.lines;
    sum.linesCovered += t.linesCovered;
    sum.branchTotal += t.branches;
    sum.branchesCovered += t.branchesCovered;
    packages.set(pkg, sum);
  }
  for (const [pkg, sum] of packages) {
    sum.lines = percent(sum.linesCovered, sum.lineTotal);
    sum.branches = percent(sum.branchesCovered, sum.branchTotal);
    sum.cases = cases.get(pkg);
  }
  return packages;
}

// ─── The floors ─────────────────────────────────────────────────────────

/** The floors file, checked for shape: `{ margin, packages, problems }`. */
export function readFloors(text) {
  const problems = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { margin: { lines: 0, branches: 0, cases: 0 }, packages: {}, problems: [`not JSON: ${error.message}`] };
  }
  const margin = { lines: 0, branches: 0, cases: 0, ...(data?.margin ?? {}) };
  const packages = data?.packages ?? {};
  if (typeof packages !== "object" || Array.isArray(packages)) problems.push("`packages` must be an object keyed by package directory");
  for (const figure of FIGURES) {
    if (typeof margin[figure] !== "number" || margin[figure] < 0) problems.push(`margin.${figure} must be a number of zero or more`);
  }
  for (const [pkg, floor] of Object.entries(packages)) {
    for (const figure of FIGURES) {
      const value = floor?.[figure];
      if (typeof value !== "number" || value < 0) problems.push(`${pkg}: ${figure} must be a number of zero or more`);
      else if (figure === "cases" && !Number.isInteger(value)) problems.push(`${pkg}: cases must be a whole number`);
      // A share is compared at one decimal place (floorTo1), so a finer floor could refuse the measurement it was meant to admit.
      else if (figure !== "cases" && (value > 100 || Math.round(value * 10) !== value * 10)) problems.push(`${pkg}: ${figure} must be a percentage of at most 100 with at most one decimal place`);
    }
  }
  return { margin, packages, problems };
}

/**
 * One decimal place, rounded down: a floor never rounds up past what was
 * measured. The small epsilon absorbs binary representation (814/1000 as a
 * percent is 81.39999999999999), and the floors are compared at this same
 * precision, so a floor raised from a run never refuses that run.
 */
export function floorTo1(value) {
  return Math.floor(value * 10 + 1e-9) / 10;
}

/** Findings for every measured package below its floor, or with none. */
export function checkFloors(measured, floors) {
  const findings = [];
  for (const [pkg, figures] of measured) {
    const floor = floors.packages[pkg];
    if (!floor) {
      findings.push({ rule: "no-floor", path: pkg, message: `measured (lines ${figures.lines.toFixed(1)}%, branches ${figures.branches.toFixed(1)}%${figures.cases === undefined ? "" : `, ${figures.cases} cases`}) but has no floor; add it to the floors file` });
      continue;
    }
    // Compared at the floor's own precision (floorTo1), never at the raw float.
    const lines = floorTo1(figures.lines);
    const branches = floorTo1(figures.branches);
    if (lines < floor.lines) findings.push({ rule: "floor", path: pkg, message: `lines ${lines}% is below its floor of ${floor.lines}%` });
    if (branches < floor.branches) findings.push({ rule: "floor", path: pkg, message: `branches ${branches}% is below its floor of ${floor.branches}%` });
    if (figures.cases === undefined) {
      if (floor.cases > 0) findings.push({ rule: "floor", path: pkg, message: `has a floor of ${floor.cases} cases but no run report was given, so its cases cannot be counted` });
    } else if (figures.cases < floor.cases) {
      findings.push({ rule: "floor", path: pkg, message: `${figures.cases} cases passed, below its floor of ${floor.cases}` });
    }
  }
  return findings;
}

/**
 * The floors a full run lifts them to: each figure is the measurement less the
 * margin, rounded down, and never below the floor already there. Every package
 * with a floor must have been measured, or the run was not a full one.
 */
export function raiseFloors(measured, floors) {
  const missing = Object.keys(floors.packages).filter((pkg) => !measured.has(pkg));
  const packages = {};
  for (const [pkg, figures] of [...measured].sort(([a], [b]) => a.localeCompare(b))) {
    const old = floors.packages[pkg] ?? { lines: 0, branches: 0, cases: 0 };
    packages[pkg] = {
      lines: Math.max(old.lines, floorTo1(Math.max(0, figures.lines - floors.margin.lines))),
      branches: Math.max(old.branches, floorTo1(Math.max(0, figures.branches - floors.margin.branches))),
      cases: Math.max(old.cases, figures.cases === undefined ? 0 : Math.max(0, figures.cases - floors.margin.cases)),
    };
  }
  return { missing, floors: { margin: floors.margin, packages } };
}

// ─── The change ─────────────────────────────────────────────────────────

/**
 * A path as git prints it in a diff header: C-quoted when it holds a quote, a
 * backslash or a control character (`core.quotePath=false` still quotes
 * those), and followed by a tab when it holds a space.
 */
export function headerPath(text) {
  const raw = text.replace(/\t$/, "");
  if (!raw.startsWith('"')) return raw;
  const named = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", '"': '"', "\\": "\\" };
  const bytes = [];
  // By code point, so a character outside the basic plane is never split in two.
  const body = Array.from(raw.slice(1, raw.endsWith('"') ? -1 : undefined));
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "\\") {
      bytes.push(...Buffer.from(body[i], "utf8"));
      continue;
    }
    const next = body[++i];
    if (/[0-7]/.test(next)) {
      bytes.push(Number.parseInt(body.slice(i, i + 3).join(""), 8));
      i += 2;
    } else {
      bytes.push(...Buffer.from(named[next] ?? next, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * The lines each file gained, from `git diff -U0` output: `Map<path, Set<line>>`.
 * A `+++ ` line is a file header only between a file's `diff --git` line and
 * its first hunk; inside a hunk it is an added line whose text starts `++ `.
 */
export function addedLines(diff) {
  const added = new Map();
  let path;
  let inHeader = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      inHeader = true;
      path = undefined;
      continue;
    }
    if (inHeader && line.startsWith("+++ ")) {
      const target = headerPath(line.slice(4));
      path = target === "/dev/null" ? undefined : target.replace(/^b\//, "");
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) inHeader = false;
    if (hunk && path) {
      const start = Number(hunk[1]);
      const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
      const lines = added.get(path) ?? new Set();
      for (let n = start; n < start + count; n++) lines.add(n);
      if (lines.size > 0) added.set(path, lines);
    }
  }
  return added;
}

/**
 * The changed lines no test ran: for every statement with no hits whose range
 * holds an added line, one finding at the first added line in that range.
 */
export function unrunLines(entry, lines) {
  const found = new Set();
  for (const [id, loc] of Object.entries(entry.statementMap)) {
    if ((entry.s[id] ?? 0) > 0) continue;
    for (let n = loc.start.line; n <= loc.end.line; n++) {
      if (lines.has(n)) {
        found.add(n);
        break;
      }
    }
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * Judges the change: unrun added lines in measured files, measured packages
 * whose source changed without being measured, and the files not measured at all.
 */
export function checkChange(added, files, measuredPackages, floors, packageDirs) {
  const findings = [];
  const notMeasured = [];
  for (const [path, lines] of added) {
    if (!CODE.test(path) || TEST_FILE.test(path) || path.endsWith(".d.ts")) continue;
    const entry = files.get(path);
    if (entry) {
      const pkg = packageOf(path, packageDirs);
      for (const line of unrunLines(entry, lines)) {
        findings.push({ rule: "unrun", path: `${path}:${line}`, message: `is never run by a test (${pkg === "." ? "the root package" : pkg}'s own tests)` });
      }
      continue;
    }
    const pkg = packageOf(path, packageDirs);
    if (floors.packages[pkg] && !measuredPackages.has(pkg)) {
      findings.push({ rule: "unmeasured", path, message: `changed, but ${pkg}'s coverage was not collected in this run, so its new lines cannot be judged` });
      continue;
    }
    notMeasured.push(path);
  }
  return { findings, notMeasured };
}

/**
 * What is wrong with the ignore hint on one line of `path`, or undefined:
 * the line holds no hint, or a hint that says why and survives to the
 * provider (see the header).
 */
export function hintProblem(path, text) {
  const match = IGNORE_HINT.exec(text);
  if (!match) return undefined;
  const directive = match[1];
  if (directive === "file") return "`ignore file` takes a whole module out of its package's figures; exclude it in the package's vitest config instead";
  // The hint's own text: up to the close of its block comment when the line has one, else the rest of the line.
  const comment = text.slice(match.index + match[0].length).split("*/")[0];
  const reason = (REASON.exec(comment)?.[1] ?? "").replace(/@preserve\s*:?/g, "").trim();
  // A legal comment is one the line marks `@preserve`; a hint whose marker sits on another line of its comment is asked to carry it on its own.
  const legal = /@preserve\b/.test(text);
  if (directive !== "stop" && !/\w/.test(reason)) return `\`ignore ${directive}\` says no reason; write it after \`--\`, as \`/* v8 ignore next -- @preserve: <why no test can reach it> */\``;
  if (TRANSFORMED.test(path) && AST_HINTS.has(directive) && !legal) return `\`ignore ${directive}\` without \`@preserve\` is stripped by the TypeScript transform, so it ignores nothing; write \`/* v8 ignore ${directive} -- @preserve: <reason> */\``;
  return undefined;
}

/**
 * The ignore hints the change adds without a reason (`ignore-reason`), in
 * every code file outside the tests, measured or not. `readLines(path)` is the
 * head file's lines.
 */
export function checkIgnoreHints(added, readLines) {
  const findings = [];
  for (const [path, lines] of added) {
    if (!CODE.test(path) || TEST_FILE.test(path) || path.endsWith(".d.ts")) continue;
    const text = readLines(path);
    for (const line of [...lines].sort((a, b) => a - b)) {
      const problem = hintProblem(path, text[line - 1] ?? "");
      if (problem) findings.push({ rule: "ignore-reason", path: `${path}:${line}`, message: problem });
    }
  }
  return findings;
}

/**
 * The floors the change added or moved for a package this run did not
 * measure (`floor-unmeasured`). `baseFloors` is the merge base's file, read
 * like `floors`, or undefined when the base had none (every entry is new).
 */
export function checkFloorChange(baseFloors, floors, measuredPackages) {
  const findings = [];
  for (const [pkg, floor] of Object.entries(floors.packages)) {
    const was = baseFloors?.packages[pkg];
    const moved = !was || FIGURES.some((figure) => was[figure] !== floor[figure]);
    if (moved && !measuredPackages.has(pkg)) {
      findings.push({ rule: "floor-unmeasured", path: pkg, message: "its floor changed, but its coverage was not collected in this run, so the new floor cannot be judged" });
    }
  }
  return findings;
}

// ─── Report ─────────────────────────────────────────────────────────────

export function formatReport({ findings, measured, floors, notMeasured, base, changedFiles, unmatched = [] }) {
  const lines = [];
  for (const f of findings) lines.push(`✗ ${f.rule}  ${f.path}  ${f.message}`);
  if (unmatched.length > 0) {
    const shown = unmatched.slice(0, 3).join(", ");
    lines.push(`• unmatched  ${unmatched.length} measured file(s) match no tracked file and were left out (${shown}${unmatched.length > 3 ? ", …" : ""})`);
  }
  for (const [pkg, m] of [...measured].sort(([a], [b]) => a.localeCompare(b))) {
    const floor = floors.packages[pkg];
    const against = floor ? ` (floor ${floor.lines}%, ${floor.branches}%, ${floor.cases})` : "";
    const cases = m.cases === undefined ? "cases not reported" : `${m.cases} cases`;
    lines.push(`• measured  ${pkg}  lines ${m.lines.toFixed(1)}%, branches ${m.branches.toFixed(1)}%, ${cases}${against}`);
  }
  for (const path of notMeasured) lines.push(`• not measured  ${path}`);
  const verdict = findings.length === 0 ? "clean" : `${findings.length} finding(s)`;
  const change = base ? `, ${changedFiles} changed file(s) checked against ${base}` : "";
  lines.push(`test-coverage: ${measured.size} package(s) measured${change}; ${verdict}`);
  return lines.join("\n");
}

// ─── The command ────────────────────────────────────────────────────────

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function parseArgs(argv) {
  const opts = { floors: undefined, inputs: [], base: undefined, raise: false, fromRun: undefined, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--floors") opts.floors = argv[++i];
    else if (arg === "--input") opts.inputs.push(argv[++i]);
    else if (arg === "--base") opts.base = argv[++i];
    else if (arg === "--raise") opts.raise = true;
    else if (arg === "--from-run") opts.fromRun = argv[++i];
    else if (arg === "--json") opts.json = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.floors) throw new Error("--floors <file> is required");
  if (opts.fromRun && !opts.raise) throw new Error("--from-run is for --raise only: a gate judges its own run's inputs");
  if (opts.fromRun && opts.inputs.length > 0) throw new Error("give --from-run or --input, not both: a raise reads one run");
  if (opts.inputs.length === 0 && !opts.fromRun) throw new Error("give at least one --input <dir>, or --from-run <id> with --raise");
  return opts;
}

/** Downloads a workflow run's coverage artifacts into a temporary directory (the caller removes it; a failed download removes it here). */
function downloadRun(root, runId) {
  const dir = mkdtempSync(join(tmpdir(), "test-coverage-run-"));
  try {
    execFileSync("gh", ["run", "download", String(runId), "--pattern", "coverage-*", "--dir", dir], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`could not download run ${runId}'s coverage artifacts with gh: ${error instanceof Error ? error.message : String(error)}`);
  }
  return dir;
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const floorsPath = resolve(opts.floors);
  const floors = readFloors(readFileSync(floorsPath, "utf8"));
  if (floors.problems.length > 0) {
    for (const p of floors.problems) console.error(`test-coverage: ${opts.floors}: ${p}`);
    return 2;
  }

  const downloaded = opts.fromRun ? downloadRun(root, opts.fromRun) : undefined;
  try {
    const inputs = readInputs(downloaded ? [downloaded] : opts.inputs.map((d) => resolve(d)));
    // A change that ran no package's tests is still judged against its base; anything else with no coverage measured nothing.
    const changeOnly = inputs.coverage.length === 0 && opts.base !== undefined && !opts.raise;
    if (inputs.coverage.length === 0 && !changeOnly) {
      console.error("test-coverage: no coverage-final.json under the inputs; the run measured nothing, so nothing can be judged");
      return 2;
    }
    const tracked = git(root, ["ls-files"]).split("\n").filter(Boolean);
    const packageDirs = new Set(tracked.filter((p) => posix.basename(p) === "package.json").map((p) => posix.dirname(p)));
    const relativize = makeRelativizer(tracked);
    const merged = mergeCoverage(inputs.coverage, relativize);
    const measured = measure(merged.files, casesByPackage(inputs.reports, relativize, packageDirs), packageDirs);
    if (measured.size === 0 && !changeOnly) {
      console.error(`test-coverage: none of the ${merged.unmatched.length} measured file(s) matches a tracked file (first: ${merged.unmatched[0] ?? "none"}); nothing can be judged`);
      return 2;
    }

    if (opts.raise) {
      if (merged.mismatched.length > 0) {
        console.error(`test-coverage: the run measured ${merged.mismatched.join(", ")} twice with different statements or branches; its figures cannot be trusted to raise a floor`);
        return 2;
      }
      const raised = raiseFloors(measured, floors);
      if (raised.missing.length > 0) {
        console.error(`test-coverage: not a full run; these packages have floors and were not measured: ${raised.missing.join(", ")}`);
        return 2;
      }
      writeFileSync(floorsPath, `${JSON.stringify(raised.floors, null, 2)}\n`);
      for (const [pkg, floor] of Object.entries(raised.floors.packages)) {
        const old = floors.packages[pkg];
        const moved = !old || FIGURES.some((f) => old[f] !== floor[f]);
        if (moved) console.log(`• raised  ${pkg}  ${old ? `${old.lines}%, ${old.branches}%, ${old.cases}` : "new"} -> ${floor.lines}%, ${floor.branches}%, ${floor.cases}`);
      }
      console.log(`test-coverage: floors written to ${opts.floors} from ${measured.size} measured package(s)`);
      return 0;
    }

    const findings = [];
    for (const path of merged.mismatched) findings.push({ rule: "mismatch", path, message: "was measured twice with different statements or branches (different source or config); the runs cannot be merged" });
    findings.push(...checkFloors(measured, floors));
    let notMeasured = [];
    let baseLabel;
    let changedFiles = 0;
    if (opts.base) {
      const mergeBase = git(root, ["merge-base", opts.base, "HEAD"]).trim();
      baseLabel = `${opts.base} (${mergeBase.slice(0, 9)})`;
      // Fixed prefixes and unquoted paths, so the parse never depends on the user's diff configuration.
      const added = addedLines(git(root, ["-c", "core.quotePath=false", "diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", mergeBase, "--"]));
      changedFiles = added.size;
      const change = checkChange(added, merged.files, new Set(measured.keys()), floors, packageDirs);
      findings.push(...change.findings);
      notMeasured = change.notMeasured;
      findings.push(...checkIgnoreHints(added, (path) => readFileSync(join(root, path), "utf8").split("\n")));
      // The base's floors at the same path; a file outside the repository, a base without it, or one the tool cannot read makes every entry new.
      const floorsAt = relative(root, realpathSync(floorsPath)).split(sep).join("/");
      const floorsAtBase = !floorsAt.startsWith("..") && git(root, ["ls-tree", "--name-only", mergeBase, "--", floorsAt]).trim() !== "";
      const atBase = floorsAtBase ? readFloors(git(root, ["show", `${mergeBase}:${floorsAt}`])) : undefined;
      findings.push(...checkFloorChange(atBase?.problems.length === 0 ? atBase : undefined, floors, new Set(measured.keys())));
    }

    const result = { findings, measured, floors, notMeasured, base: baseLabel, changedFiles, unmatched: merged.unmatched };
    if (opts.json) console.log(JSON.stringify({ ...result, measured: Object.fromEntries(measured) }, null, 2));
    else console.log(formatReport(result));
    return findings.length === 0 ? 0 : 1;
  } finally {
    if (downloaded) rmSync(downloaded, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`test-coverage: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
