// No file this repository publishes cites a private planning record.
// Run via `node --test scripts/planning-references.test.mjs` (wired into root
// `npm test`).
//
// The maintainers plan in a private repository, and its identifiers used to
// leak into this one: a decision number in a comment, a record's folder id in
// a test title, a private issue in an error message, an internal entry name in
// the Helm chart's refusal. A reader of this repository cannot open any of
// them, so each was a dead reference where the reason should have been. The
// root AGENTS.md forbids them; this guard is what holds the rule for the files
// the guidance gate never reads (code, protos, tests, workflows, the chart).
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
// ROOTS lists the trees already swept, together with every tree generated
// from them. Reading the generated trees proves the generators were re-run
// after a proto or schema comment changed. The rest of the repository joins
// when it is swept, and then ROOTS goes away.
//
// The guard reads the working tree's copy of each tracked file, so it judges
// what is about to be committed, and it skips files that hold hashes rather
// than prose (a lockfile's `sha512-` digests contain any short shape by
// chance). A file that must name the shapes, such as the gate that defines
// them, goes in ALLOWED with its reason. An allowance that no longer names a
// tracked file carrying a reference fails, so the list cannot outlive its
// reasons.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { LEAK_PATTERNS, RECORD_CODE_PATTERNS } from "./agents-check.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The trees this guard walks: path prefixes, and "" for the files at the repository root. */
export const ROOTS = [
  "",
  ".github/",
  "apis/ai/",
  "apis/stubs/",
  "backend/",
  "deploy/",
  "docs/guides/workflows/task-types/",
  "docs/sdk/resources/",
  "mcp-server/",
  "scripts/",
  "sdk/go/proto/",
  "sdk/typescript/src/gen/",
  "test/extension-consumer/",
  "tools/",
];

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

/** Whether a repository path sits under one of the roots ("" is a file at the repository root). */
export function isUnder(path, roots) {
  return roots.some((r) => (r === "" ? !path.includes("/") : path.startsWith(r)));
}

/** The tracked files under the roots, less the hash-holding files. */
export function filesUnder(roots, tracked) {
  return tracked.filter((p) => isUnder(p, roots) && !SKIPPED_FILE_NAMES.has(basename(p)));
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

test("the readers find files under every root, so a pass is not vacuous", () => {
  for (const r of ROOTS) {
    assert.ok(filesUnder([r], tracked).length > 0, `no tracked file under ${r || "the repository root"}`);
  }
  assert.ok(!filesUnder([""], tracked).includes("package-lock.json"), "lockfiles are skipped");
});

test("every shape the guard uses matches its fixture, and none matches a near-miss", () => {
  const fixtures = new Map([
    ["planning-record path", "see _projects/2026-01/some-record"],
    ["planning-record id", "record 20260101.07 chose it"],
    ["task file id", "per T09_9_plan.md"],
    ["decision id", "the DD-98 posture"],
    ["ruling id", "ruled at Q-ZZ-9"],
    ["finding id", "closes F-98"],
    ["task id", "// @since T19z"],
    ["decision number", "chose it in decision 998"],
    ["design document number", "per design doc 98"],
    ["finding number", "as finding 98 showed"],
    ["record stage", "landed in Z9 Stage 7"],
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

test("no file under the guarded roots names a private planning record", () => {
  const findings = [];
  for (const rel of filesUnder(ROOTS, tracked)) {
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
