// No file this repository publishes cites a private planning record.
// Run via `node --test scripts/planning-references.test.mjs` (wired into root
// `npm test`).
//
// The maintainers plan in a private repository, and its identifiers used to
// leak into this one: a decision number in a comment, a record's folder id in
// a test title, a private issue in an error message, an internal entry name in
// the Helm chart's refusal. A reader of this repository cannot open any of
// them, so each was a dead reference where the reason should have been. The
// root AGENTS.md forbids them; this guard is what holds the rule for every
// file the guidance gate never reads (code, protos, tests, docs, workflows,
// the chart), across the whole repository.
//
// The shapes come from the guidance gate itself, scripts/agents-check.mjs:
// every entry of LEAK_PATTERNS (its `privateOk` flag does not apply, since
// this repository is public) and the `entry name` and `record section`
// entries of RECORD_CODE_PATTERNS, looked up by name so a renamed entry fails
// here instead of silently dropping out. Importing them means the gate and
// this guard can never disagree about what a planning reference looks like.
// RECORD_CODE_PATTERNS' bare short code (`Z9`) and bare stage label
// (`Stage 3`) are not used: they collide with ordinary names (Amazon S3, a
// build's own steps), so they are left to review.
//
// It reads the working tree's copy of every tracked file, generated trees
// included, so it judges what is about to be committed and proves the
// generators were re-run after a source comment changed. It skips files that
// hold hashes rather than prose (a lockfile's `sha512-` digests contain any
// short shape by chance), and the vendored plugin folders that
// plugins/vendor.json declares: their bytes are a vendor's, pinned by digest
// and never edited here (plugins/README.md), so a vendor's own "Finding 1" is
// not this repository's planning. A file that must name the shapes, such as
// the gate that defines them, goes in ALLOWED with its reason. An allowance
// that no longer names a tracked file carrying a reference fails, so the list
// cannot outlive its reasons.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { LEAK_PATTERNS, RECORD_CODE_PATTERNS } from "./agents-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Files that hold hashes, not prose. */
const SKIPPED_FILE_NAMES = new Set(["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "go.sum", "go.work.sum", "Cargo.lock"]);

/** Files that must name the shapes, each with the reason. */
export const ALLOWED = new Map([
  ["scripts/agents-check.mjs", "defines the shapes, with an example of each"],
  ["scripts/agents-check.test.mjs", "holds the guidance gate's fixtures for every shape"],
  ["scripts/planning-references.test.mjs", "holds this guard's own fixtures"],
  [".gitignore", "ignores the planning tree by name, so it is never committed"],
]);

const RECORD_CODE_ENTRIES = ["entry name", "record section"];

/** The shapes this guard refuses: the gate's LEAK_PATTERNS and two of its RECORD_CODE_PATTERNS, by name. */
export function guardPatterns(leaks = LEAK_PATTERNS, codes = RECORD_CODE_PATTERNS) {
  const picked = RECORD_CODE_ENTRIES.map((name) => {
    const entry = codes.find((c) => c.name === name);
    if (entry === undefined) {
      throw new Error(`scripts/agents-check.mjs exports no RECORD_CODE_PATTERNS entry named "${name}"`);
    }
    return entry;
  });
  return [...leaks, ...picked].map(({ name, re }) => ({ name, re }));
}

/** Every planning reference in a text: one finding per shape per line, with its 1-based line. */
export function planningReferences(text, patterns) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const { name, re } of patterns) {
      const m = line.match(re);
      if (m) found.push({ line: i + 1, name, match: m[0] });
    }
  });
  return found;
}

/** The folder of every vendored plugin, from the catalogue's own declaration of what it copied. */
export function vendoredPluginDirs(vendorJson) {
  const plugins = JSON.parse(vendorJson).plugins;
  if (!Array.isArray(plugins) || plugins.length === 0) {
    throw new Error("plugins/vendor.json declares no `plugins` array; the guard cannot tell vendored text from ours");
  }
  return plugins.map(({ name }) => `plugins/${name}/`);
}

/** The tracked files the guard reads: all of them, less the hash-holding files and the vendored folders. */
export function guardedFiles(tracked, vendored) {
  return tracked.filter((p) => !SKIPPED_FILE_NAMES.has(basename(p)) && !vendored.some((d) => p.startsWith(d)));
}

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
    .split("\0")
    .filter(Boolean);
}

/** The working tree's text of a tracked file, or null for a missing, non-regular or binary one. */
function readText(rel) {
  const abs = join(root, rel);
  let stats;
  try {
    stats = statSync(abs);
  } catch {
    return null;
  }
  if (!stats.isFile()) return null;
  const bytes = readFileSync(abs);
  if (bytes.subarray(0, 8192).includes(0)) return null;
  return bytes.toString("utf8");
}

const patterns = guardPatterns();
const tracked = trackedFiles();
const vendored = vendoredPluginDirs(readFileSync(join(root, "plugins/vendor.json"), "utf8"));
const guarded = guardedFiles(tracked, vendored);

test("the guard reads every tree, skips only hashes and vendored plugins, so a pass is not vacuous", () => {
  for (const known of [
    "AGENTS.md",
    "backend/services/stigmer-server/package.json",
    "sdk/react/src/index.ts",
    "client-apps/cli/package.json",
    "test/conformance/README.md",
    "site/package.json",
    "plugins/linear/plugin.json",
  ]) {
    assert.ok(guarded.includes(known), `${known} is read`);
  }
  assert.ok(!guarded.includes("package-lock.json"), "lockfiles are skipped");
  assert.ok(vendored.includes("plugins/superpowers/"), "a vendored plugin is declared");
  assert.ok(!guarded.some((p) => p.startsWith("plugins/superpowers/")), "a vendored plugin's files are skipped");
  assert.throws(() => vendoredPluginDirs('{"sources":{}}'), /declares no `plugins` array/);
});

test("every shape the guard uses matches its fixture, and none matches a near-miss", () => {
  const fixtures = new Map([
    ["planning-record path", "see _projects/2026-01/some-record"],
    ["planning-record id", "record 20260101.07 chose it"],
    ["task file id", "per T09_9_plan.md"],
    ["decision id", "the DD-9 posture"],
    ["ruling id", "ruled at Q-ZZ-9"],
    ["finding id", "closes F-98"],
    ["task id", "// @since T19z"],
    ["decision number", "chose it in decision 998"],
    ["design document number", "per design doc 98"],
    ["finding number", "as finding 98 showed"],
    ["record stage", "landed in Z9 Stage 7"],
    ["lettered record code", "ruled in ZQ-9"],
    ["wave label", "shipped in Wave 9"],
    ["lettered slice", "carried by Slice Z"],
    ["private repository reference", "tracked as stigmer-cloud#0"],
    ["entry name", "decided in sp.example-entry"],
    ["record section", "the §9z lane"],
  ]);
  for (const { name } of patterns) {
    const text = fixtures.get(name);
    assert.ok(text !== undefined, `the shape "${name}" has no fixture here; add one with its near-misses`);
    assert.deepEqual(
      planningReferences(text, patterns).map((f) => f.name),
      [name],
      `the fixture for "${name}" matches exactly that shape`,
    );
  }
  for (const nearMiss of [
    "At 2026-09-30T12:00 the job ran.",
    "Dates read DD-MM-YYYY, DD-MMM-YYYY or DD-MON-YY; stamps DD-HHmmss.",
    "The model's F-1 score; see stigmer/stigmer#778 finding 3.",
    "return Date.parse(`${day}T00:00:00Z`);",
    "# Stage 1 — sequential prep (tree mutations + shared artifact builds).",
    "RFC 6749 §2.3.1 requires it.",
    "Fixed in #1249 and stigmer#1249.",
    "Stored in an S3 bucket behind HTTP/2.",
    "Turn N-1 signs with P-256 or ES-256 under CC-BY-4.0 over UTF-8, dated ISO-8601 or MM-DD-YYYY.",
    "const head = text.slice(1); // a microwave 3 times",
  ]) {
    assert.deepEqual(planningReferences(nearMiss, patterns), [], nearMiss);
  }
});

test("a planted reference is reported with its line and shape", () => {
  assert.deepEqual(planningReferences("const a = 1;\n// see DD-97 for why\n", patterns), [
    { line: 2, name: "decision id", match: "DD-97" },
  ]);
  assert.throws(() => guardPatterns(LEAK_PATTERNS, []), /no RECORD_CODE_PATTERNS entry named "entry name"/);
});

test("every allowance names a tracked file that still carries a reference", () => {
  for (const [path, reason] of ALLOWED) {
    assert.ok(tracked.includes(path), `ALLOWED names ${path} (${reason}), which is not tracked`);
    const text = readText(path);
    assert.ok(
      text !== null && planningReferences(text, patterns).length > 0,
      `ALLOWED names ${path} (${reason}), which no longer carries a reference; remove the allowance`,
    );
  }
});

test("no file in the repository names a private planning record", () => {
  const findings = [];
  for (const rel of guarded) {
    if (ALLOWED.has(rel)) continue;
    const text = readText(rel);
    if (text === null) continue;
    for (const { line, name, match } of planningReferences(text, patterns)) {
      findings.push(`${rel}:${line}: ${name}: ${match}`);
    }
  }
  assert.deepEqual(
    findings,
    [],
    "Write the reason in plain words, or cite something a reader of this repository can open " +
      "(a PR, an issue, a SHA, a file). Generated files are fixed at their source and regenerated.",
  );
});
