// Tests for scripts/ux-bar.mjs, the rule that every promise on the UX bar is
// held by a test or tracked by an open issue.
// Run via `node --test scripts/ux-bar.test.mjs` (wired into root `npm test`).
//
// What these guard: how the bar file is read and every shape it refuses
// (not JSON, unknown keys, a malformed or duplicate id, a prefix no surface
// names, a pending entry that is not `stigmer#N`); which title segments claim
// a promise (a known prefix, two digits and a space, in the describe chain or
// the title); a promise held, held in part, pending, or neither; a claim on an
// id the bar lacks; GitHub's closing keywords in a body, in every form they
// take; a pending issue that is not open, looked up once however many
// promises name it; and, through a throwaway git repository, the command's
// exit codes end to end.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { inventoryFile, loadTypeScript, typeScriptCandidates } from "./test-integrity.mjs";
import {
  BAR,
  checkBar,
  checkBody,
  checkIssues,
  claimsOf,
  closedByBody,
  formatReport,
  holdersOf,
  readBar,
} from "./ux-bar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const ts = loadTypeScript(ROOT);

const SURFACES = { CLI: "the stigmer CLI", INK: "the terminal kit" };

function bar(promises, surfaces = SURFACES) {
  return readBar(JSON.stringify({ surfaces, promises }, null, 2));
}

function inventory(path, text) {
  return inventoryFile(ts, path, text);
}

test("reads surfaces and promises, with each promise's line and its pending issues as numbers", () => {
  const read = bar([
    { id: "CLI-01", promise: "Data goes to stdout." },
    { id: "INK-05", promise: "A load failure says what to do.", pending: ["stigmer#2618"] },
  ]);
  assert.deepEqual(read.problems, []);
  assert.deepEqual([...read.surfaces.keys()], ["CLI", "INK"]);
  assert.deepEqual(read.promises.map((p) => [p.id, p.pending]), [["CLI-01", []], ["INK-05", [2618]]]);
  assert.ok(read.promises[1].line > read.promises[0].line);
});

test("refuses a bar that is not JSON, not an object, or carries keys it does not know", () => {
  assert.equal(readBar("{").problems[0].rule, "bar-shape");
  assert.equal(readBar("[]").problems[0].rule, "bar-shape");
  const extra = readBar(JSON.stringify({ surfaces: SURFACES, promises: [], owner: "x" }));
  assert.match(extra.problems[0].message, /unknown key\(s\) owner/);
  const noList = readBar(JSON.stringify({ surfaces: SURFACES, promises: {} }));
  assert.match(noList.problems[0].message, /`promises` is a list/);
  const badSurfaces = readBar(JSON.stringify({ surfaces: ["CLI"], promises: [] }));
  assert.match(badSurfaces.problems[0].message, /`surfaces` is an object/);
});

test("refuses a surface without a three-capital prefix and a description", () => {
  const read = bar([], { CLI: "the CLI", Ink: "kit", WEB: "" });
  assert.deepEqual(read.problems.map((p) => p.message), [
    'surface "Ink" needs a three-capital prefix and a description',
    'surface "WEB" needs a three-capital prefix and a description',
  ]);
});

test("refuses a promise with no sentence, an unknown key, a malformed or duplicate id, or a prefix no surface names", () => {
  const read = bar([
    { id: "CLI-1", promise: "short number" },
    { id: "CLI-02", promise: "" },
    { id: "CLI-03", promise: "fine", owner: "me" },
    { id: "CLI-03", promise: "twice" },
    { id: "WEB-01", promise: "no such surface" },
    "not an object",
  ]);
  assert.deepEqual(read.problems.map((p) => `${p.rule}: ${p.message}`), [
    'bar-id: "CLI-1" is not an id: three capitals, a hyphen and two digits (INK-05)',
    "bar-shape: CLI-02 needs a `promise` sentence",
    "bar-shape: CLI-03 has unknown key(s) owner",
    "bar-id: CLI-03 is listed twice",
    "bar-id: WEB-01's prefix is not one of the surfaces (CLI, INK)",
    "bar-shape: promise 6 is not an object",
  ]);
});

test("refuses a pending entry that is not a list of stigmer#N", () => {
  const read = bar([
    { id: "CLI-01", promise: "a", pending: "stigmer#1" },
    { id: "CLI-02", promise: "b", pending: ["#12", "other-repo#3", "stigmer#0", "stigmer#44"] },
  ]);
  assert.deepEqual(read.problems.map((p) => p.message), [
    'CLI-01\'s `pending` is a list of "stigmer#N"',
    'CLI-02\'s pending "#12" is not "stigmer#N", an issue of this repository',
    'CLI-02\'s pending "other-repo#3" is not "stigmer#N", an issue of this repository',
    'CLI-02\'s pending "stigmer#0" is not "stigmer#N", an issue of this repository',
  ]);
  assert.deepEqual(read.promises[1].pending, [44]);
});

test("a segment claims a promise only with a known prefix, two digits and a space", () => {
  const prefixes = new Set(["CLI", "INK"]);
  assert.deepEqual(claimsOf("CLI-07 a destructive command confirms > refuses off a TTY", prefixes), ["CLI-07"]);
  assert.deepEqual(claimsOf("confirm > CLI-07 refuses off a TTY", prefixes), ["CLI-07"]);
  assert.deepEqual(claimsOf("INK-01 frames > INK-13 markdown", prefixes), ["INK-01", "INK-13"]);
  assert.deepEqual(claimsOf("CLI-07: no space", prefixes), []);
  assert.deepEqual(claimsOf("CLI-7 one digit", prefixes), []);
  assert.deepEqual(claimsOf("WEB-01 not a surface", prefixes), []);
  assert.deepEqual(claimsOf("mentions CLI-07 later", prefixes), []);
});

test("holds a promise by a case's title or a suite around it, and records where", () => {
  const read = bar([{ id: "CLI-07", promise: "confirms" }, { id: "INK-02", promise: "approval" }]);
  const files = [
    inventory("cli/src/__tests__/confirm.test.ts", `describe("CLI-07 a destructive command confirms", () => { it("forced", () => {}); it("off a TTY", () => {}); });`),
    inventory("ink/src/__tests__/frames.test.tsx", `describe("frames", () => { it("INK-02 waits forever", () => {}); });`),
  ];
  const { holders } = holdersOf(read, files);
  assert.deepEqual(holders.get("CLI-07").map((h) => h.key), [
    "CLI-07 a destructive command confirms > forced",
    "CLI-07 a destructive command confirms > off a TTY",
  ]);
  assert.deepEqual(holders.get("INK-02"), [{ path: "ink/src/__tests__/frames.test.tsx", key: "frames > INK-02 waits forever", line: 1 }]);
});

test("refuses a promise held by nothing and pending on nothing, and passes one that is either or both", () => {
  const read = bar([
    { id: "CLI-01", promise: "held" },
    { id: "CLI-02", promise: "held in part", pending: ["stigmer#2620"] },
    { id: "CLI-03", promise: "pending", pending: ["stigmer#2620"] },
    { id: "CLI-04", promise: "neither" },
  ]);
  const files = [inventory("a.test.ts", `it("CLI-01 x", () => {}); it("CLI-02 y", () => {});`)];
  const { findings } = checkBar(read, files);
  assert.deepEqual(findings.map((f) => `${f.rule} ${f.path}`), [`unheld ${BAR}`]);
  assert.match(findings[0].message, /^CLI-04 has no test holding it and no pending issue/);
});

test("refuses a case that claims an id the bar lacks, so a mistyped number cannot pass", () => {
  const read = bar([{ id: "CLI-01", promise: "held" }]);
  const files = [inventory("pkg/a.test.ts", `it("CLI-01 x", () => {});\n\nit("CLI-10 typo", () => {});`)];
  const { findings } = checkBar(read, files);
  assert.deepEqual(findings, [
    { rule: "unknown-promise", path: "pkg/a.test.ts", line: 3, message: `"CLI-10 typo" claims CLI-10, which ${BAR} does not list` },
  ]);
});

test("reports the bar's own problems against the bar file, before the holders are judged", () => {
  const read = bar([{ id: "CLI-1", promise: "bad id" }]);
  const { findings } = checkBar(read, []);
  assert.deepEqual(findings.map((f) => [f.rule, f.path]), [["bar-id", BAR]]);
});

test("reads every closing keyword GitHub reads, in any case and every reference form", () => {
  const body = [
    "Closes #1",
    "closes: #2",
    "CLOSED #3",
    "Fix #4, fixes #5 and fixed stigmer/stigmer#6",
    "Resolve https://github.com/stigmer/stigmer/issues/7",
    "resolves #8 and Resolved #9",
    "Refs #10, mentions #11, closes stigmer/other#12, unclosed#13",
  ].join("\n");
  assert.deepEqual(closedByBody(body).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("refuses a body that closes an issue the bar still lists as pending", () => {
  const read = bar([
    { id: "INK-03", promise: "starts with Node", pending: ["stigmer#2617"] },
    { id: "INK-04", promise: "off a terminal", pending: ["stigmer#2618"] },
  ]);
  assert.deepEqual(checkBody(read, "Fixes the bin.\n\nCloses #2617"), [
    {
      rule: "closes-pending",
      path: BAR,
      line: read.promises[0].line,
      message: "this pull request closes stigmer#2617, which INK-03 still lists as pending: hold INK-03 with the test that proves the fix, and drop the issue from its `pending`",
    },
  ]);
  assert.deepEqual(checkBody(read, "Refs #2618"), []);
});

test("refuses a pending issue that is not open, looking each issue up once", () => {
  const read = bar([
    { id: "CLI-02", promise: "a", pending: ["stigmer#2620"] },
    { id: "CLI-03", promise: "b", pending: ["stigmer#2620", "stigmer#99"] },
  ]);
  const asked = [];
  const { findings, looked } = checkIssues(read, (issue) => {
    asked.push(issue);
    return issue === 99 ? "CLOSED" : "OPEN";
  });
  assert.deepEqual(asked, [2620, 99]);
  assert.equal(looked, 2);
  assert.deepEqual(findings.map((f) => f.message), [
    "CLI-03 is pending on stigmer#99, which is closed: hold CLI-03 with a test, or name the open issue that tracks what is left",
  ]);
  const unknown = checkIssues(read, () => "UNKNOWN");
  assert.equal(unknown.findings.length, 3);
});

test("summarizes the promises, held and pending, the issues looked up, and the verdict", () => {
  const read = bar([
    { id: "CLI-01", promise: "held" },
    { id: "CLI-02", promise: "both", pending: ["stigmer#1"] },
  ]);
  const { holders } = holdersOf(read, [inventory("a.test.ts", `it("CLI-01 x", () => {}); it("CLI-02 y", () => {});`)]);
  assert.equal(
    formatReport({ bar: read, holders, findings: [], looked: 1 }),
    "ux-bar: 2 promise(s), 2 held by a test, 1 pending on an issue, 1 pending issue(s) looked up; ok",
  );
  const finding = { rule: "unheld", path: BAR, line: 3, message: "m" };
  assert.equal(
    formatReport({ bar: read, holders, findings: [finding] }),
    `unheld  ${BAR}:3  m\nux-bar: 2 promise(s), 2 held by a test, 1 pending on an issue; 1 finding(s)`,
  );
});

// ─── The command, end to end ────────────────────────────────────────────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "ux-bar-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  const write = (path, text) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  // The scripts run from a folder of their own, as the workflow runs the base branch's copies.
  const scripts = mkdtempSync(join(tmpdir(), "ux-bar-scripts-"));
  copyFileSync(join(HERE, "ux-bar.mjs"), join(scripts, "ux-bar.mjs"));
  copyFileSync(join(HERE, "test-integrity.mjs"), join(scripts, "test-integrity.mjs"));
  const typescript = typeScriptCandidates(ROOT).flatMap((d) => ["--typescript", d]);
  const run = (...args) => spawnSync(process.execPath, [join(scripts, "ux-bar.mjs"), ...typescript, ...args], { cwd: dir, encoding: "utf8" });
  const remove = () => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(scripts, { recursive: true, force: true });
  };
  return { dir, git, write, run, remove };
}

test("the command: clean, a promise left unheld refused, a closing body refused, and no bar is no verdict", () => {
  const r = repo();
  try {
    assert.equal(r.run().status, 2, "a tree with no bar cannot be judged");
    r.write(BAR, JSON.stringify({ surfaces: SURFACES, promises: [{ id: "CLI-01", promise: "held" }, { id: "INK-03", promise: "pending", pending: ["stigmer#2617"] }] }));
    r.write("pkg/src/__tests__/a.test.ts", `it("CLI-01 holds it", () => {});`);
    r.write("scripts/b.test.mjs", `test("a tooling case", () => {});`);
    r.git("add", ".");

    const clean = r.run();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /ux-bar: 2 promise\(s\), 1 held by a test, 1 pending on an issue; ok/);

    r.write("pkg/src/__tests__/a.test.ts", `it("holds nothing now", () => {});`);
    const unheld = r.run();
    assert.equal(unheld.status, 1);
    assert.match(unheld.stdout, /^unheld {2}test\/ux-bar\.json:\d+ {2}CLI-01 has no test holding it/m);

    r.write("pkg/src/__tests__/a.test.ts", `it("CLI-01 holds it", () => {});`);
    r.write("body.md", "Fixes #2617");
    const closing = r.run("--pr-body-file", join(r.dir, "body.md"));
    assert.equal(closing.status, 1);
    assert.match(closing.stdout, /closes-pending .*stigmer#2617, which INK-03 still lists as pending/);

    const json = JSON.parse(r.run("--json").stdout);
    assert.deepEqual(json.promises.map((p) => [p.id, p.holders.length]), [["CLI-01", 1], ["INK-03", 0]]);

    assert.equal(r.run("--nope").status, 2);
  } finally {
    r.remove();
  }
});
