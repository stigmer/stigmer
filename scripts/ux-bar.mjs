#!/usr/bin/env node

/**
 * Holds the UX bar: every promise the clients make is held by a test or
 * tracked by an open issue, and no test claims a promise the bar does not
 * make.
 *
 * The bar is test/ux-bar.json: a list of short promises a user would say
 * ("a load failure says what was tried and what to do"), each with an id of a
 * three-letter surface prefix and two digits (`INK-05`). A test holds a
 * promise by starting its title, or the title of a suite around it, with the
 * id and a space: `describe("CLI-07 a destructive command confirms", ...)`.
 * There is no second list of which test holds which promise: the title is
 * already in every reporter's output, so the scorecard (scripts/ux-scorecard.mjs)
 * joins on it. A promise nothing holds yet names the open issue that tracks
 * the gap in `pending` (`"stigmer#2618"`); a promise may carry both, which
 * reads "held in part" (a sweep refuses new commands without a flag while an
 * issue tracks the commands that still lack it).
 *
 * The prefix has three letters, not two: the planning-reference guard
 * (scripts/agents-check.mjs, LEAK_PATTERNS' lettered record code) refuses a
 * two-capital code before a hyphen and digits in every tracked file.
 *
 * Rules on the tree (always):
 *   - the file is a `surfaces` object of prefix to description and a
 *     `promises` list; anything else is refused (`bar-shape`), never read past;
 *   - an id of the wrong shape, a duplicate id, or a prefix the surfaces do
 *     not name (`bar-id`);
 *   - a `pending` entry that is not `stigmer#N` (`bar-pending`);
 *   - a promise with no case holding it and no pending issue (`unheld`);
 *   - a case or suite title that starts with a known prefix and an id the bar
 *     lacks (`unknown-promise`), so a mistyped number cannot pass as held.
 *
 * With --check-issues, each distinct pending issue's state is read once with
 * `gh issue view`; one that is not open is refused (`pending-closed`), on
 * every pull request, until the bar says what happened: an issue closed as
 * won't-fix is as stale as one fixed. This is the rule quarantine issues
 * keep (test/README.md, rule 3).
 *
 * With --pr-body-file, a body that closes an issue the bar still lists as
 * pending is refused (`closes-pending`), so the pull request that fixes the
 * gap updates the bar before its merge closes the issue. Every keyword
 * GitHub reads is matched, in any case: close, closes, closed, fix, fixes,
 * fixed, resolve, resolves, resolved, before `#N`, `stigmer/stigmer#N` or
 * the issue's URL.
 *
 * The test files are read with scripts/test-integrity.mjs's own inventory
 * (`inventoryFile`), imported rather than parsed again, so the two tools agree
 * on what a case and its title are. That file is copied byte for byte into
 * another repository and names neither repository's layout, which is why
 * this rule lives here and not there. The files read are its test pathspecs,
 * the tooling tests (`*.test.mjs`) and the install smokes
 * (`test/install/smoke-*.mjs`), whose `node:test` cases may hold a promise.
 *
 * In CI this runs as a step of ci.integrity.yaml, from the base branch's copy
 * of this file and of test-integrity.mjs, against the pull request's tree,
 * like the integrity step itself: a change to this file's command line and to
 * that workflow therefore lands in two pull requests.
 *
 * Usage:
 *   node scripts/ux-bar.mjs [--check-issues] [--pr-body-file <path>]
 *       [--typescript <dir>] [--json]
 * Exit: 0 clean, 1 findings, 2 the script could not judge (a usage or git
 * error, no `typescript` to parse with, no bar file).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { inventoryFile, loadTypeScript, TEST_PATHSPECS } from "./test-integrity.mjs";

/** The bar, from the repository root. */
export const BAR = "test/ux-bar.json";
/** The tracked files whose cases may hold a promise. */
export const BAR_PATHSPECS = [...TEST_PATHSPECS, "*.test.mjs", "test/install/smoke-*.mjs"];

const ID = /^[A-Z]{3}-[0-9]{2}$/;
const PREFIX = /^[A-Z]{3}$/;
const PENDING = /^stigmer#([1-9][0-9]*)$/;
/** A title segment that claims a promise: a prefix, two digits and a space. */
const CLAIM = /^([A-Z]{3})-([0-9]{2}) /;
/** GitHub's closing keywords before a reference to an issue of this repository. */
const CLOSES = /\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\b:?\s+(?:(?:https:\/\/github\.com\/)?stigmer\/stigmer(?:#|\/issues\/)|#)([0-9]+)\b/gi;

/** The line of `needle`'s first appearance in `text`, 1-based, or 1. */
function lineOf(text, needle) {
  const at = text.indexOf(needle);
  return at < 0 ? 1 : text.slice(0, at).split("\n").length;
}

/**
 * Reads the bar. Returns its surfaces, its promises (each with the line it
 * starts on and its pending issues as numbers) and the problems that make it
 * unreadable or malformed. Pure.
 */
export function readBar(text) {
  const problems = [];
  const surfaces = new Map();
  const promises = [];
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { surfaces, promises, problems: [{ rule: "bar-shape", line: 1, message: `not JSON: ${error.message}` }] };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    return { surfaces, promises, problems: [{ rule: "bar-shape", line: 1, message: "the bar is an object with `surfaces` and `promises`" }] };
  }
  const extra = Object.keys(data).filter((key) => key !== "surfaces" && key !== "promises");
  if (extra.length > 0) problems.push({ rule: "bar-shape", line: 1, message: `unknown key(s) ${extra.join(", ")}; the bar holds only \`surfaces\` and \`promises\`` });
  if (data.surfaces === null || typeof data.surfaces !== "object" || Array.isArray(data.surfaces)) {
    problems.push({ rule: "bar-shape", line: 1, message: "`surfaces` is an object of prefix to description" });
  } else {
    for (const [prefix, description] of Object.entries(data.surfaces)) {
      if (!PREFIX.test(prefix) || typeof description !== "string" || description === "") {
        problems.push({ rule: "bar-shape", line: lineOf(text, `"${prefix}"`), message: `surface "${prefix}" needs a three-capital prefix and a description` });
        continue;
      }
      surfaces.set(prefix, description);
    }
  }
  if (!Array.isArray(data.promises)) {
    problems.push({ rule: "bar-shape", line: 1, message: "`promises` is a list" });
    return { surfaces, promises, problems };
  }
  const seen = new Set();
  for (const [index, entry] of data.promises.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      problems.push({ rule: "bar-shape", line: 1, message: `promise ${index + 1} is not an object` });
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    const line = id === "" ? 1 : lineOf(text, `"${id}"`);
    const unknown = Object.keys(entry).filter((key) => key !== "id" && key !== "promise" && key !== "pending");
    if (unknown.length > 0) problems.push({ rule: "bar-shape", line, message: `${id || `promise ${index + 1}`} has unknown key(s) ${unknown.join(", ")}` });
    if (typeof entry.promise !== "string" || entry.promise.trim() === "") {
      problems.push({ rule: "bar-shape", line, message: `${id || `promise ${index + 1}`} needs a \`promise\` sentence` });
    }
    if (!ID.test(id)) {
      problems.push({ rule: "bar-id", line, message: `"${id}" is not an id: three capitals, a hyphen and two digits (INK-05)` });
      continue;
    }
    if (seen.has(id)) {
      problems.push({ rule: "bar-id", line, message: `${id} is listed twice` });
      continue;
    }
    seen.add(id);
    if (surfaces.size > 0 && !surfaces.has(id.slice(0, 3))) {
      problems.push({ rule: "bar-id", line, message: `${id}'s prefix is not one of the surfaces (${[...surfaces.keys()].join(", ")})` });
    }
    const pending = [];
    if (entry.pending !== undefined && !Array.isArray(entry.pending)) {
      problems.push({ rule: "bar-pending", line, message: `${id}'s \`pending\` is a list of "stigmer#N"` });
    }
    for (const ref of Array.isArray(entry.pending) ? entry.pending : []) {
      const match = typeof ref === "string" ? PENDING.exec(ref) : null;
      if (match === null) {
        problems.push({ rule: "bar-pending", line, message: `${id}'s pending "${ref}" is not "stigmer#N", an issue of this repository` });
        continue;
      }
      pending.push(Number(match[1]));
    }
    promises.push({ id, promise: typeof entry.promise === "string" ? entry.promise : "", pending, line });
  }
  return { surfaces, promises, problems };
}

/** The promise ids a case claims: each segment of its describe chain and title that starts with one. */
export function claimsOf(key, prefixes) {
  const ids = [];
  for (const segment of key.split(" > ")) {
    const match = CLAIM.exec(segment);
    if (match && prefixes.has(match[1])) ids.push(`${match[1]}-${match[2]}`);
  }
  return ids;
}

/**
 * Which cases hold each promise, and which claim one the bar lacks.
 * `inventories` are test-integrity's (`{ path, cases: [{ key, title, line }] }`).
 * Returns `holders` (id to `[{ path, key, line }]`) and `unknown` findings. Pure.
 */
export function holdersOf(bar, inventories) {
  const known = new Set(bar.promises.map((p) => p.id));
  const prefixes = new Set(bar.surfaces.keys());
  const holders = new Map(bar.promises.map((p) => [p.id, []]));
  const unknown = [];
  for (const inventory of inventories) {
    for (const c of inventory.cases) {
      for (const id of claimsOf(c.key, prefixes)) {
        if (known.has(id)) holders.get(id).push({ path: inventory.path, key: c.key, line: c.line });
        else unknown.push({ rule: "unknown-promise", path: inventory.path, line: c.line, message: `"${c.key}" claims ${id}, which ${BAR} does not list` });
      }
    }
  }
  return { holders, unknown };
}

/** The tree's findings: the bar's own problems, the unheld promises and the unknown claims. Pure. */
export function checkBar(bar, inventories) {
  const findings = bar.problems.map((p) => ({ ...p, path: BAR }));
  const { holders, unknown } = holdersOf(bar, inventories);
  for (const p of bar.promises) {
    if (holders.get(p.id).length === 0 && p.pending.length === 0) {
      findings.push({ rule: "unheld", path: BAR, line: p.line, message: `${p.id} has no test holding it and no pending issue: title a test "${p.id} …", or name the open issue that tracks the gap` });
    }
  }
  findings.push(...unknown);
  return { findings, holders };
}

/** The issue numbers a pull request body closes, by GitHub's keywords. Pure. */
export function closedByBody(body) {
  return [...new Set([...body.matchAll(CLOSES)].map((m) => Number(m[1])))];
}

/** A body that closes an issue the bar lists as pending. Pure. */
export function checkBody(bar, body) {
  const closing = new Set(closedByBody(body));
  const findings = [];
  for (const p of bar.promises) {
    for (const issue of p.pending) {
      if (closing.has(issue)) {
        findings.push({ rule: "closes-pending", path: BAR, line: p.line, message: `this pull request closes stigmer#${issue}, which ${p.id} still lists as pending: hold ${p.id} with the test that proves the fix, and drop the issue from its \`pending\`` });
      }
    }
  }
  return findings;
}

/** Pending issues whose state is not open. `stateOf(issue)` answers "OPEN", "CLOSED" or "UNKNOWN". */
export function checkIssues(bar, stateOf) {
  const states = new Map();
  const findings = [];
  for (const p of bar.promises) {
    for (const issue of p.pending) {
      if (!states.has(issue)) states.set(issue, stateOf(issue));
      const state = states.get(issue);
      if (state !== "OPEN") {
        findings.push({ rule: "pending-closed", path: BAR, line: p.line, message: `${p.id} is pending on stigmer#${issue}, which is ${state.toLowerCase()}: hold ${p.id} with a test, or name the open issue that tracks what is left` });
      }
    }
  }
  return { findings, looked: states.size };
}

/** The report: one line per finding, then the summary line. Pure. */
export function formatReport({ bar, holders, findings, looked }) {
  const lines = findings.map((f) => `${f.rule}  ${f.path}:${f.line}  ${f.message}`);
  const held = bar.promises.filter((p) => holders.get(p.id)?.length > 0).length;
  const pending = bar.promises.filter((p) => p.pending.length > 0).length;
  const issues = looked === undefined ? "" : `, ${looked} pending issue(s) looked up`;
  const verdict = findings.length === 0 ? "ok" : `${findings.length} finding(s)`;
  lines.push(`ux-bar: ${bar.promises.length} promise(s), ${held} held by a test, ${pending} pending on an issue${issues}; ${verdict}`);
  return lines.join("\n");
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

/** The tracked files whose cases may hold a promise, outside node_modules. */
export function barFiles(root) {
  return git(root, ["ls-files", "--", ...BAR_PATHSPECS]).split("\n").filter((p) => p !== "" && !p.includes("node_modules/"));
}

/** The bar and every case that holds one of its promises, read from the tree at `root`. */
export function readTree(root, ts) {
  const bar = readBar(readFileSync(join(root, BAR), "utf8"));
  const inventories = barFiles(root).map((path) => inventoryFile(ts, path, readFileSync(join(root, path), "utf8")));
  return { bar, inventories };
}

function issueState(root, issue) {
  try {
    return execFileSync("gh", ["issue", "view", String(issue), "-R", "stigmer/stigmer", "--json", "state", "--jq", ".state"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

function parseArgs(argv) {
  const opts = { checkIssues: false, prBodyFile: undefined, json: false, typescriptDirs: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--check-issues") opts.checkIssues = true;
    else if (arg === "--pr-body-file") opts.prBodyFile = argv[++i];
    else if (arg === "--json") opts.json = true;
    else if (arg === "--typescript") opts.typescriptDirs.push(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  if (!existsSync(join(root, BAR))) {
    console.error(`ux-bar: no ${BAR} in ${root}`);
    return 2;
  }
  const ts = loadTypeScript(root, opts.typescriptDirs.map((d) => resolve(d)));
  if (!ts) {
    console.error("ux-bar: no `typescript` found to parse with; install the repository's dependencies, or pass --typescript <dir>");
    return 2;
  }
  const { bar, inventories } = readTree(root, ts);
  const { findings, holders } = checkBar(bar, inventories);
  if (opts.prBodyFile) findings.push(...checkBody(bar, readFileSync(opts.prBodyFile, "utf8")));
  let looked;
  if (opts.checkIssues) {
    const checked = checkIssues(bar, (issue) => issueState(root, issue));
    findings.push(...checked.findings);
    looked = checked.looked;
  }
  if (opts.json) {
    const promises = bar.promises.map((p) => ({ ...p, holders: holders.get(p.id) }));
    console.log(JSON.stringify({ promises, findings }, null, 2));
  } else {
    console.log(formatReport({ bar, holders, findings, looked }));
  }
  return findings.length === 0 ? 0 : 1;
}

// The entry check compares real paths: run from a temporary folder behind a
// symlink (macOS's /var), the two spellings of one file differ.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`ux-bar: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
