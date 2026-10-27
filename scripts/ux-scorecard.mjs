#!/usr/bin/env node

/**
 * Prints the UX scorecard: every promise on the bar (test/ux-bar.json) with
 * the tests that hold it and how they did, or the open issue that tracks it.
 *
 * The bar check (scripts/ux-bar.mjs) proves each promise has a test or an
 * issue; this answers whether those tests pass now. It takes each promise's
 * cases from the same static inventory the bar check reads (a case holds a
 * promise when a segment of its title starts with the id), runs only the
 * files those cases are in, and looks each case up in the run's report by
 * the key the inventory and the reporters share: the describe chain and the
 * title joined with ` > `. A case the report does not carry reads "not run",
 * never a pass, so a suite that was skipped or crashed cannot read green.
 *
 * A promise reads ✓ when every case that names it passed, ✗ when any failed,
 * "not run" when this run did not reach its cases, and "open stigmer#N" for
 * each pending issue; a promise with both reads "held in part". The Gate
 * already refuses a failing test, so the scorecard adds the mapping, not a
 * second verdict: it exits 0 whatever the results, and 2 only when it cannot
 * judge.
 *
 * Runs (with --run): each package's holding files in one `vitest run <files>`
 * with vitest's JSON reporter, so the scorecard never waits on a whole
 * package's suite for a handful of cases; the tooling tests (`*.test.mjs`) in
 * one `node --test` through test/install/lib/json-reporter.mjs, which writes
 * the same report shape; and with --smoke the install smokes the same way
 * (they pack and install the libraries, minutes rather than seconds, from
 * the dist/ `make ux-scorecard SMOKE=1` builds first); and with --visual the
 * visual suite's spec (test/visual/tests), through the pinned browser image
 * as `make test-visual` runs it, its results written in the same shape by
 * test/visual/reporter/vitest-shape.ts. The
 * reports land in --input, emptied of earlier reports first, which a later
 * run without --run reads again.
 *
 * A case titled from a template (`it.each`, a `${}` title) is matched by its
 * shape: each placeholder stands for any text.
 *
 * With --mutation <dir> (repeatable), the planted-bug line comes from the
 * sweep's own reports, read through scripts/mutation-sweep.mjs's `readRuns`
 * and `summarize`, so the two tools never count differently.
 *
 * Usage:
 *   node scripts/ux-scorecard.mjs --input <dir> [--run] [--smoke] [--visual]
 *       [--mutation <dir>]... [--format text|markdown] [--typescript <dir>]
 * Exit: 0 printed, 2 the script could not judge.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readRuns, summarize } from "./mutation-sweep.mjs";
import { loadTypeScript } from "./test-integrity.mjs";
import { holdersOf, readTree } from "./ux-bar.mjs";

/** The node:test reporter that writes vitest's report shape. */
export const NODE_REPORTER = "test/install/lib/json-reporter.mjs";
/** The Playwright reporter that writes the same shape, for the visual suite. */
export const VISUAL_REPORTER = "test/visual/reporter/vitest-shape.ts";
/** What runs the visual suite with every picture drawn by the pinned image's browser. */
export const VISUAL_RUNNER = "test/visual/run-in-image.mjs";
const SMOKE = /^test\/install\/smoke-[^/]+\.mjs$/;
const VISUAL = /^test\/visual\/tests\/.+\.spec\.ts$/;
const TOOLING = /\.test\.mjs$/;
const PROMISE_WIDTH = 60;

/** How a holding file is run: by vitest in its package, by node's runner, as an install smoke, or as the visual suite. */
export function runnerOf(path) {
  if (SMOKE.test(path)) return "smoke";
  if (VISUAL.test(path)) return "visual";
  if (TOOLING.test(path)) return "node";
  return "vitest";
}

/** The nearest directory above `path` (repository-relative) that `hasManifest` says holds a package.json. */
export function packageOf(path, hasManifest) {
  for (let dir = posix.dirname(path); dir !== "."; dir = posix.dirname(dir)) {
    if (hasManifest(dir)) return dir;
  }
  return ".";
}

/**
 * The runs a scorecard needs: one per vitest package, one for the tooling
 * tests, one per smoke (only with `smoke`), one for the visual suite (only
 * with `visual`). Each names its files relative to the directory it runs in.
 * Pure.
 */
export function planRuns(paths, hasManifest, { smoke = false, visual = false } = {}) {
  const vitest = new Map();
  const node = [];
  const smokes = [];
  const visuals = [];
  for (const path of [...new Set(paths)].sort()) {
    const runner = runnerOf(path);
    if (runner === "node") node.push(path);
    else if (runner === "smoke") smokes.push(path);
    else if (runner === "visual") visuals.push(posix.relative("test/visual", path));
    else {
      const pkg = packageOf(path, hasManifest);
      if (!vitest.has(pkg)) vitest.set(pkg, []);
      vitest.get(pkg).push(pkg === "." ? path : posix.relative(pkg, path));
    }
  }
  const runs = [...vitest].map(([cwd, files]) => ({ kind: "vitest", cwd, files, report: `vitest-${cwd.replaceAll("/", "-")}.json` }));
  if (node.length > 0) runs.push({ kind: "node", cwd: ".", files: node, report: "node-tooling.json" });
  if (smoke) for (const path of smokes) runs.push({ kind: "smoke", cwd: ".", files: [path], report: `${basename(path, ".mjs")}.json` });
  if (visual && visuals.length > 0) runs.push({ kind: "visual", cwd: ".", files: visuals, report: "visual.json" });
  return runs;
}

/**
 * The command line of one run, writing its report to `reportPath`, and the
 * variables it adds to the environment. Pure.
 */
export function commandOf(run, reportPath, root) {
  if (run.kind === "vitest") {
    return ["npx", ["vitest", "run", ...run.files, "--reporter=json", `--outputFile=${reportPath}`]];
  }
  if (run.kind === "visual") {
    // The reporter writes where STIGMER_VISUAL_REPORT says (its header).
    return [process.execPath, [join(root, VISUAL_RUNNER), ...run.files, `--reporter=list,${join(root, VISUAL_REPORTER)}`], { STIGMER_VISUAL_REPORT: reportPath }];
  }
  const reporter = ["--test-reporter", join(root, NODE_REPORTER), "--test-reporter-destination", reportPath];
  if (run.kind === "node") return [process.execPath, ["--test", ...reporter, ...run.files]];
  // A smoke packs the libraries' dist/, which `make ux-scorecard SMOKE=1` builds first.
  return [process.execPath, [...reporter, ...run.files, "--skip-build"]];
}

/** The matcher for one inventory key: exact, or by shape when its title is a template. */
export function keyMatcher(key) {
  const segments = key.split(" > ");
  const templated = segments.some((s) => /\$\{|\$[A-Za-z_]|%[sdifjo#%]|^`/.test(s));
  if (!templated) return (candidate) => candidate === key;
  const pattern = segments
    .map((segment) => {
      const text = segment.startsWith("`") && segment.endsWith("`") ? segment.slice(1, -1) : segment;
      const parts = text.split(/\$\{[^}]*\}|\$[A-Za-z_][\w.]*|%[sdifjo#]/);
      return parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll("%%", "%")).join(".+");
    })
    .join(" > ");
  const re = new RegExp(`^${pattern}$`);
  return (candidate) => re.test(candidate);
}

/**
 * Every result the reports carry, by repository-relative file: each case's
 * key and status. `realpath` maps a reporter's absolute path to the
 * repository's spelling of it.
 */
export function resultsByFile(reports, root, realpath = (p) => p) {
  const byFile = new Map();
  const realRoot = realpath(root);
  for (const report of reports) {
    for (const file of report.testResults ?? []) {
      if (typeof file.name !== "string") continue;
      const path = relative(realRoot, realpath(file.name)).split("\\").join("/");
      if (!byFile.has(path)) byFile.set(path, []);
      for (const result of file.assertionResults ?? []) {
        byFile.get(path).push({ key: [...(result.ancestorTitles ?? []), result.title].join(" > "), status: result.status });
      }
    }
  }
  return byFile;
}

/** The status of one holding case: passed, failed, skipped, or not run. Pure. */
export function caseStatus(holder, byFile) {
  const matches = keyMatcher(holder.key);
  const results = (byFile.get(holder.path) ?? []).filter((r) => matches(r.key));
  if (results.length === 0) return "not run";
  if (results.some((r) => r.status === "failed")) return "failed";
  if (results.every((r) => r.status === "passed")) return "passed";
  return "skipped";
}

/** Where a holding file sits, in a few words: its package's folder and its name. */
export function placeOf(path) {
  const name = basename(path).replace(/\.(test|spec)\.(ts|tsx|mts|mjs)$/, "").replace(/\.mjs$/, "");
  if (SMOKE.test(path)) return name;
  if (VISUAL.test(path)) return `visual/${name}`;
  const at = path.indexOf("/src/");
  return `${basename(at >= 0 ? path.slice(0, at) : posix.dirname(path))}/${name}`;
}

/**
 * One row per promise: its verdict and the cell that says it. A held
 * promise's verdict is the worst of its cases; a pending issue adds
 * "open stigmer#N". Pure.
 */
export function scoreRows(bar, holders, byFile) {
  return bar.promises.map((p) => {
    const cases = holders.get(p.id) ?? [];
    const statuses = cases.map((h) => caseStatus(h, byFile));
    let verdict = "open";
    if (cases.length > 0) {
      if (statuses.includes("failed")) verdict = "failed";
      else if (statuses.includes("not run")) verdict = "not run";
      else if (statuses.includes("skipped")) verdict = "skipped";
      else verdict = "passed";
    }
    const parts = [];
    if (cases.length > 0) {
      const places = [...new Set(cases.map((h) => placeOf(h.path)))];
      const where = places.length > 2 ? `${places.slice(0, 2).join(", ")} +${places.length - 2}` : places.join(", ");
      const count = `${cases.length} case${cases.length === 1 ? "" : "s"}`;
      const failed = statuses.filter((s) => s === "failed").length;
      if (verdict === "passed") parts.push(`✓ ${where} (${count})`);
      else if (verdict === "failed") parts.push(`✗ ${where} (${failed} of ${count} failed)`);
      else parts.push(`${verdict} ${where} (${count})`);
    }
    for (const issue of p.pending) parts.push(`open stigmer#${issue}`);
    return { id: p.id, promise: p.promise, verdict, held: cases.length > 0, pending: p.pending, cell: parts.join(" · ") };
  });
}

/** The planted-bug line from the sweep's reports, or undefined with none. */
export function mutationLine(runs) {
  if (runs.length === 0) return undefined;
  const totals = { caught: 0, judged: 0, survived: 0, noCoverage: 0, ignored: 0 };
  for (const run of runs) {
    const { counts } = summarize(run.report, run.package ?? "", { confirmed: run.confirmed });
    const caught = counts.killed + counts.timeout + counts.refuted;
    totals.caught += caught;
    totals.judged += caught + counts.survived + counts.noCoverage;
    totals.survived += counts.survived;
    totals.noCoverage += counts.noCoverage;
    totals.ignored += counts.ignored;
  }
  return `planted bugs caught: ${totals.caught} of ${totals.judged} (${totals.survived} not noticed, ${totals.noCoverage} never run; ${totals.ignored} disabled with a reason)`;
}

function truncate(text, width) {
  return text.length > width ? `${text.slice(0, width - 1).trimEnd()}…` : text;
}

/** The summary line: how many promises read each way. Pure. */
export function summaryLine(rows) {
  const count = (verdict) => rows.filter((r) => r.verdict === verdict).length;
  const partly = rows.filter((r) => r.held && r.pending.length > 0).length;
  return `ux-scorecard: ${rows.length} promise(s): ${count("passed")} held and passing (${partly} of them in part), ${count("failed")} failing, ${count("not run") + count("skipped")} not run, ${count("open")} open`;
}

/** The table, as text or as Markdown. Pure. */
export function formatScorecard(rows, { format = "text", mutation } = {}) {
  const lines = [];
  if (format === "markdown") {
    lines.push("| Promise | | Held by / open |", "| --- | --- | --- |");
    for (const r of rows) lines.push(`| ${r.id} | ${r.promise.replaceAll("|", "\\|")} | ${r.cell.replaceAll("|", "\\|")} |`);
    lines.push("");
  } else {
    for (const r of rows) lines.push(`${r.id}  ${truncate(r.promise, PROMISE_WIDTH).padEnd(PROMISE_WIDTH)}  ${r.cell}`);
  }
  if (mutation !== undefined) lines.push(mutation);
  lines.push(summaryLine(rows));
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { input: undefined, run: false, smoke: false, visual: false, mutation: [], format: "text", typescriptDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") opts.input = argv[++i];
    else if (arg === "--run") opts.run = true;
    else if (arg === "--smoke") opts.smoke = true;
    else if (arg === "--visual") opts.visual = true;
    else if (arg === "--mutation") opts.mutation.push(argv[++i]);
    else if (arg === "--format") opts.format = argv[++i];
    else if (arg === "--typescript") opts.typescriptDirs.push(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (opts.input === undefined) throw new Error("--input <dir> names where the run reports are (written with --run)");
  if (opts.format !== "text" && opts.format !== "markdown") throw new Error(`--format is text or markdown, not ${opts.format}`);
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const ts = loadTypeScript(root, opts.typescriptDirs.map((d) => resolve(d)));
  if (!ts) {
    console.error("ux-scorecard: no `typescript` found to parse with; install the repository's dependencies, or pass --typescript <dir>");
    return 2;
  }
  const { bar, inventories } = readTree(root, ts);
  if (bar.problems.length > 0) {
    console.error(`ux-scorecard: the bar is malformed; run \`node scripts/ux-bar.mjs\` for its findings`);
    return 2;
  }
  const { holders } = holdersOf(bar, inventories);
  const input = resolve(opts.input);
  if (opts.run) {
    // A report a run left behind would read as this run's: start empty.
    mkdirSync(input, { recursive: true });
    for (const file of readdirSync(input).filter((f) => f.endsWith(".json"))) rmSync(join(input, file));
    const paths = [...holders.values()].flat().map((h) => h.path);
    for (const run of planRuns(paths, (dir) => existsSync(join(root, dir, "package.json")), { smoke: opts.smoke, visual: opts.visual })) {
      const reportPath = join(input, run.report);
      const [command, args, extraEnv = {}] = commandOf(run, reportPath, root);
      console.error(`ux-scorecard: ${run.kind} in ${run.cwd}: ${run.files.length} file(s)`);
      // A run never inherits a parent test runner's context: node's runner
      // would report to that parent instead of through the reporter named.
      const env = { ...process.env, ...extraEnv };
      delete env.NODE_TEST_CONTEXT;
      const outcome = spawnSync(command, args, { cwd: join(root, run.cwd), env, stdio: ["ignore", "ignore", "inherit"] });
      if (!existsSync(reportPath)) console.error(`ux-scorecard: ${run.kind} in ${run.cwd} wrote no report (exit ${outcome.status}); its cases read "not run"`);
    }
  }
  const reports = existsSync(input)
    ? readdirSync(input).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(input, f), "utf8")))
    : [];
  const real = (p) => (existsSync(p) ? realpathSync(p) : p);
  const rows = scoreRows(bar, holders, resultsByFile(reports, root, real));
  const mutation = mutationLine(opts.mutation.length > 0 ? readRuns(opts.mutation.map((d) => resolve(d))) : []);
  console.log(formatScorecard(rows, { format: opts.format, mutation }));
  return 0;
}

// The entry check compares real paths, as scripts/ux-bar.mjs's does.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ux-scorecard: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
