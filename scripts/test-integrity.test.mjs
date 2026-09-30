// Tests for scripts/test-integrity.mjs: the static reading of test files and
// the comparison of a change against its base.
// Run via `node --test scripts/test-integrity.test.mjs` (wired into root `npm test`).
//
// What these guard: which calls register a case, a suite or a skip; the one
// return shape that is a pass without running (valueless, before anything was
// asserted) and the shapes that are not; the vitest options that let a suite
// pass without passing; how a deletion is told from a retitle and a move; which
// skips carry their reason by construction; the PR-body declarations; and,
// through a throwaway git repository, the command's exit codes end to end.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyDeclarations,
  byConstruction,
  CONFIG_PATHSPECS,
  checkConfig,
  compareInventories,
  formatReport,
  inventoryFile,
  loadTypeScript,
  packageOf,
  parseDeclarations,
  typeScriptCandidates,
} from "./test-integrity.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts", "test-integrity.mjs");
const ts = loadTypeScript(ROOT);

// A checkout whose dependencies are not installed yet (the cloud repository
// runs these tests in its lint, before its build installs the composition)
// has no parser: every case skips by name. Inside a test gate they run and
// fail instead, because the gate installs everything first.
const NEEDS_TS = ts || process.env.STIGMER_TEST_GATE === "1" ? {} : { skip: "no `typescript` installed to parse with (run the build first)" };
const it = (name, fn) => test(name, NEEDS_TS, fn);

const inv = (text, path = "pkg/src/__tests__/a.test.ts") => inventoryFile(ts, path, text);
const rules = (text) => inv(text).findings.map((f) => f.rule);

it("the compiler loads from the repository", () => {
  assert.ok(ts?.createSourceFile, "typescript must be installed at the repository root");
});

// ─── Registration ───────────────────────────────────────────────────────

it("cases are keyed by their describe chain and title; suites are not cases", () => {
  const { cases } = inv(`
    describe("outer", () => {
      describe("inner", () => {
        it("one", () => {});
        test("two", async () => {});
      });
      it.each([1, 2])("each %s", () => {});
      it.todo("later");
    });
    it("top", () => {});
  `);
  assert.deepEqual(cases.map((c) => c.key), ["outer > inner > one", "outer > inner > two", "outer > each %s", "outer > later", "top"]);
});

it("Playwright's test.describe nests; test.extend, test.step and hooks register nothing", () => {
  const { cases } = inv(`
    const t = test.extend({});
    test.describe("suite", () => {
      test.beforeEach(async () => {});
      test("case", async () => { await test.step("step", async () => {}); });
    });
  `, "test/e2e/tests/x.spec.ts");
  assert.deepEqual(cases.map((c) => c.key), ["suite > case"]);
});

it("skip sites carry their kind and condition, registration and runtime alike", () => {
  const { skips } = inv(`
    it.skipIf(!ready)("a", () => {});
    describe.runIf(process.platform === "linux")("b", () => {});
    it.skip("c", () => {});
    it("d", (ctx) => { if (!env) return ctx.skip("no env"); expect(1).toBe(1); });
    test("e", async () => { test.skip(await gate(), "why"); });
  `);
  assert.deepEqual(skips.map((s) => [s.kind, s.condition]), [
    ["skipIf", "!ready"],
    ["runIf", 'process.platform === "linux"'],
    ["skip", ""],
    ["runtime-skip", "!env"],
    ["runtime-skip", "await gate()"],
  ]);
});

it("a quarantine comment on the line above names its issue", () => {
  const { skips } = inv(`
    // quarantined: stigmer#1322 -- run.workflow has no target
    it.skip("golden 18", () => {});
  `);
  assert.deepEqual(skips[0].quarantine, { repo: "stigmer", issue: 1322 });
});

// ─── Rules on the tree ──────────────────────────────────────────────────

it(".only on a case or a suite is refused", () => {
  assert.deepEqual(rules(`it.only("a", () => {});`), ["only"]);
  assert.deepEqual(rules(`describe.only("s", () => { it("a", () => {}); });`), ["only"]);
  assert.deepEqual(rules(`test.describe.only("s", () => {});`), ["only"]);
});

it("a valueless return before anything was asserted is a pass that never ran", () => {
  assert.deepEqual(rules(`it("a", () => { if (!ready) return; expect(x).toBe(1); });`), ["valueless-return"]);
  assert.deepEqual(rules(`it("a", () => { for (const x of xs) { if (x) { return; } } });`), ["valueless-return"]);
});

it("the returns that are not silent passes are left alone", () => {
  // Type narrowing after the assertion that already failed the test.
  assert.deepEqual(rules(`it("a", () => { expect(r.ok).toBe(true); if (!r.ok) return; expect(r.v).toBe(1); });`), []);
  // An assertion helper counts as asserting.
  assert.deepEqual(rules(`it("a", async () => { await expectGrpcCode(() => f(), 5, "x"); return; });`), []);
  // Playwright's runtime skip, then return.
  assert.deepEqual(rules(`test("a", async () => { if (!(await visible())) { test.skip(); return; } });`), []);
  // Returning a value, and returns inside nested functions.
  assert.deepEqual(rules(`it("a", (ctx) => { if (!env) return ctx.skip("why"); });`), []);
  assert.deepEqual(rules(`it("a", () => { const f = () => { return; }; expect(f()).toBe(undefined); });`), []);
  assert.deepEqual(rules(`it("a", () => { return promise.then(() => expect(1).toBe(1)); });`), []);
});

it("vitest options that pass a suite without passing are refused; their off values are not", () => {
  const on = checkConfig(ts, "vitest.config.ts", `export default { test: { passWithNoTests: true, retry: 2, allowOnly: true } };`);
  assert.deepEqual(on.map((f) => f.message.split("`")[1]), ["passWithNoTests: true", "retry: 2", "allowOnly: true"]);
  const off = checkConfig(ts, "vitest.config.ts", `export default { test: { passWithNoTests: false, retry: 0, allowOnly: false } };`);
  assert.deepEqual(off, []);
});

it("a Playwright config that retries a failure into green is refused; zero retries is not", () => {
  const on = checkConfig(ts, "test/e2e/playwright.config.ts", `export default defineConfig({ retries: process.env.CI ? 2 : 0, forbidOnly: !!process.env.CI });`);
  assert.deepEqual(on.map((f) => f.message.split("`")[1]), ["retries: process.env.CI ? 2 : 0"]);
  assert.deepEqual(checkConfig(ts, "site/playwright.config.ts", `export default defineConfig({ retries: 0 });`), []);
  assert.ok(CONFIG_PATHSPECS.includes("**/playwright.config.*"), "the tool reads Playwright configs");
});

// ─── Comparing base and head ────────────────────────────────────────────

const PKGS = new Set(["pkg", "other"]);
const file = (path, body) => inv(body, path);

it("a vanished case paired with a gained one in the same file is a retitle, not a deletion", () => {
  const result = compareInventories(
    [{ base: file("pkg/a.test.ts", `it("old name", () => {});`), head: file("pkg/a.test.ts", `it("new name", () => {});`) }],
    PKGS,
  );
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.retitled.map((r) => [r.from, r.to]), [["old name", "new name"]]);
});

it("a case that left one file for another in the same package is a move", () => {
  const result = compareInventories(
    [
      { base: file("pkg/a.test.ts", `it("kept", () => {}); it("moves", () => {});`), head: file("pkg/a.test.ts", `it("kept", () => {});`) },
      { base: undefined, head: file("pkg/b.test.ts", `it("moves", () => {});`) },
    ],
    PKGS,
  );
  assert.deepEqual(result.deleted, []);
  assert.deepEqual(result.moved.map((m) => m.key), ["moves"]);
});

it("a deleted case, a deleted file and a case moved to another package are deletions", () => {
  const result = compareInventories(
    [
      { base: file("pkg/a.test.ts", `it("gone", () => {}); it("stays", () => {});`), head: file("pkg/a.test.ts", `it("stays", () => {});`) },
      { base: file("pkg/b.test.ts", `it("whole file", () => {});`), head: undefined },
      { base: file("pkg/c.test.ts", `it("crosses", () => {});`), head: undefined },
      { base: undefined, head: file("other/c.test.ts", `it("crosses", () => {});`) },
    ],
    PKGS,
  );
  assert.deepEqual(result.deleted.map((c) => c.key).sort(), ["crosses", "gone", "whole file"]);
});

it("a delete plus an unrelated add in another file of the package is still a deletion", () => {
  const result = compareInventories(
    [
      { base: file("pkg/a.test.ts", `it("real", () => {});`), head: file("pkg/a.test.ts", ``) },
      { base: undefined, head: file("pkg/b.test.ts", `it("trivial", () => {});`) },
    ],
    PKGS,
  );
  assert.deepEqual(result.deleted.map((c) => c.key), ["real"]);
});

it("a renamed file keeps its cases", () => {
  const result = compareInventories(
    [{ base: file("pkg/old.test.ts", `it("a", () => {});`), head: file("pkg/new.test.ts", `it("a", () => {});`) }],
    PKGS,
  );
  assert.deepEqual(result, { deleted: [], retitled: [], moved: [], newSkips: [] });
});

it("a new skip is one beyond what the file carried; by-construction and quarantined skips are never new", () => {
  const base = file("pkg/a.test.ts", `it.skipIf(!x)("a", () => {});`);
  const head = file("pkg/a.test.ts", `
    it.skipIf(!x)("a", () => {});
    it.skipIf(!x)("b", () => {});
    it.skipIf(capabilities.multiTenant)("c", () => {});
    it.skipIf(process.platform === "win32")("d", () => {});
    describe.skipIf(!TEST_DATABASE_URL)("e", () => {});
    // quarantined: stigmer#1 -- flaky
    it.skip("f", () => {});
    it("g", (ctx) => { if (!hasBash) return ctx.skip("no bash"); });
  `);
  const { newSkips } = compareInventories([{ base, head }], PKGS);
  assert.deepEqual(newSkips.map((s) => s.title), ["b", "g"]);
});

it("the by-construction classes are capability, platform and a gate-provided dependency", () => {
  assert.equal(byConstruction("!capabilities.versionTagging"), "target capability");
  assert.equal(byConstruction('process.platform === "win32"'), "platform");
  assert.equal(byConstruction("!TEST_FGA_API_URL"), "gate-provided dependency");
  assert.equal(byConstruction("!testDatabaseAdminUrl()"), "gate-provided dependency");
  assert.equal(byConstruction("!hasBash"), undefined);
});

it("packageOf finds the nearest manifest directory", () => {
  assert.equal(packageOf("pkg/src/__tests__/a.test.ts", PKGS), "pkg");
  assert.equal(packageOf("loose/a.test.ts", PKGS), ".");
});

// ─── Declarations ───────────────────────────────────────────────────────

it("declarations parse with either dash, and cover a case by title, key or file", () => {
  const declarations = parseDeclarations([
    "Some prose.",
    "Test-removal: gone -- the feature was deleted in this PR",
    "Quarantine: pkg/a.test.ts — stigmer#42",
  ].join("\n"));
  assert.deepEqual(declarations.removals, [{ subject: "gone", reason: "the feature was deleted in this PR" }]);
  assert.deepEqual(declarations.quarantines, [{ subject: "pkg/a.test.ts", repo: "stigmer", issue: 42 }]);
  assert.deepEqual(declarations.skips, []);

  const comparison = {
    deleted: [{ key: "gone", title: "gone", path: "pkg/a.test.ts", line: 1 }, { key: "other", title: "other", path: "pkg/b.test.ts", line: 1 }],
    newSkips: [{ kind: "skip", condition: "", title: "s", path: "pkg/a.test.ts", line: 3 }],
    retitled: [],
    moved: [],
  };
  const { refused, declared } = applyDeclarations(comparison, declarations);
  assert.deepEqual(refused.map((r) => r.message.split('"')[1]), ["other"]);
  assert.deepEqual(declared.map((d) => d.rule), ["deleted-case", "new-skip"]);
});

it("a skip declaration names why the case does not apply, and covers a new skip", () => {
  const declarations = parseDeclarations("Skip: s -- deployed endpoints carry no operator credential");
  assert.deepEqual(declarations.skips, [{ subject: "s", reason: "deployed endpoints carry no operator credential" }]);
  const { refused, declared } = applyDeclarations(
    { deleted: [], retitled: [], moved: [], newSkips: [{ kind: "skipIf", condition: "!scope", title: "s", path: "p", line: 1 }] },
    declarations,
  );
  assert.deepEqual(refused, []);
  assert.match(declared[0].message, /"s" skips when !scope: deployed endpoints/);
});

it("a quarantine declaration without an issue does not count", () => {
  const { refused } = applyDeclarations(
    { deleted: [], retitled: [], moved: [], newSkips: [{ kind: "skip", condition: "", title: "s", path: "p", line: 1 }] },
    parseDeclarations("Quarantine: s -- flaky, will look later"),
  );
  assert.equal(refused.length, 1);
});

it("the report's last line is the verdict", () => {
  assert.match(formatReport({ findings: [], filesRead: 3 }), /test-integrity: 3 test file\(s\) read; clean$/);
});

// ─── The command, end to end ────────────────────────────────────────────

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "test-integrity-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("remote", "add", "origin", "https://github.com/stigmer/stigmer.git");
  const write = (path, text) => {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  // The throwaway repository has no compiler of its own: point it at every place this one looks.
  const typescript = typeScriptCandidates(ROOT).flatMap((d) => ["--typescript", d]);
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...typescript, ...args], { cwd: dir, encoding: "utf8" });
  return { dir, git, write, run };
}

it("the command: clean, a deleted case refused, then declared", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/__tests__/a.test.ts", `it("kept", () => {}); it("dropped", () => {});`);
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    r.git("checkout", "-q", "-b", "change");

    assert.equal(r.run("--base", "main").status, 0);

    r.write("pkg/src/__tests__/a.test.ts", `it("kept", () => {});`);
    r.git("commit", "-qam", "drop");
    const refused = r.run("--base", "main");
    assert.equal(refused.status, 1);
    assert.match(refused.stdout, /deleted-case .*"dropped" was deleted/);

    r.write("body.md", "Test-removal: dropped -- covered by kept");
    const declared = r.run("--base", "main", "--pr-body-file", join(r.dir, "body.md"));
    assert.equal(declared.status, 0, declared.stdout);
    assert.match(declared.stdout, /declared .*"dropped" removed: covered by kept/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: a silent return on the tree fails without a base", () => {
  const r = repo();
  try {
    r.write("a.test.ts", `it("a", () => { if (!ready) return; });`);
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    const result = r.run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /valueless-return +a\.test\.ts:1/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: an unknown argument is a usage error, exit 2", () => {
  const r = repo();
  try {
    assert.equal(r.run("--nope").status, 2);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});
