// Tests for scripts/test-integrity.mjs: the static reading of test files and
// the comparison of a change against its base.
// Run via `node --test scripts/test-integrity.test.mjs` (wired into root `npm test`).
//
// What these guard: which calls register a case, a suite or a skip; the one
// return shape that is a pass without running (valueless, before anything was
// asserted) and the shapes that are not; the vitest options that let a suite
// pass without passing; how a deletion is told from a retitle and a move; which
// skips carry their reason by construction; the PR-body declarations; which
// of a run's skipped cases a skip site explains; how the RPC waiver file is
// read and which of its changes weaken the contract; the layout rules (which
// words a name may carry and when they are true, where a test may live, what
// test/support may import) and the baseline that lists what does not follow
// them yet; and, through a throwaway git repository, the command's exit codes
// end to end.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyDeclarations,
  applyLayoutBaseline,
  byConstruction,
  compareRpcWaivers,
  CONFIG_PATHSPECS,
  checkConfig,
  checkLayout,
  compareInventories,
  explainRunSkips,
  formatReport,
  inventoryFile,
  LAYOUT_BASELINE,
  layoutKey,
  loadTypeScript,
  nameWords,
  packageOf,
  parseDeclarations,
  readLayoutBaseline,
  readRpcWaivers,
  resolveRelative,
  RPC_WAIVERS,
  scanModule,
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

// ─── RPC waivers ────────────────────────────────────────────────────────

const WAIVERS = `# The header comment shows the shape:
#   - rpc: <Service>.<method>
#     kind: gap
waivers:
  - rpc: AgentCommandController.create
    kind: gap
    issue: 1
    reason: >-
      Not pinned yet; its prose may say rpc and kind freely.
  - rpc: ApiKeyQueryController.getByKeyHash
    kind: proven-elsewhere
    proven_by: a/b.test.ts
    reason: >-
      Pinned by the server's own suite.
`;

it("the waiver file's block form reads as (rpc, kind) pairs, comments and other fields ignored", () => {
  const { entries, problems } = readRpcWaivers(WAIVERS);
  assert.deepEqual(problems, []);
  assert.deepEqual(entries.map((e) => [e.rpc, e.kind, e.line]), [
    ["AgentCommandController.create", "gap", 5],
    ["ApiKeyQueryController.getByKeyHash", "proven-elsewhere", 10],
  ]);
  assert.deepEqual(readRpcWaivers("waivers: []\n"), { entries: [], problems: [] });
});

it("any other shape of the waiver file is refused by line, never read past", () => {
  const shape = (text) => readRpcWaivers(text).problems.map((p) => p.line);
  assert.deepEqual(shape("waivers:\n  - { rpc: A.b, kind: gap }\n"), [2], "a flow-style entry");
  assert.deepEqual(shape("waivers:\n    - rpc: A.b\n      kind: gap\n"), [2, 3], "a re-indented entry");
  assert.deepEqual(shape("waivers:\n  -\n    rpc: A.b\n    kind: gap\n"), [2, 3, 4], "an entry whose rpc is not its first line");
  assert.deepEqual(shape("waivers:\n  - rpc: A.b\n    issue: 1\n"), [2], "an entry with no kind");
  assert.deepEqual(shape("waivers:\n  - rpc: A.b\n    kind: internal\n"), [3, 2], "a kind that does not exist");
  assert.deepEqual(shape("waivers:\n  - rpc: A.b\n    kind: gap\n    kind: gap\n"), [4], "a second kind");
  assert.deepEqual(shape("waivers:\n  - rpc: A.b\n    kind: gap\nextra: 1\n"), [4], "another top-level key");
});

it("a weakened waiver is a new one, or proven-elsewhere moved to gap; nothing else weakens", () => {
  const e = (rpc, kind, line = 1) => ({ rpc, kind, line });
  const weakened = (base, head) => compareRpcWaivers(base, head).map((w) => [w.rpc, w.was ?? null, w.kind]);
  assert.deepEqual(weakened([], [e("A.b", "gap")]), [["A.b", null, "gap"]], "a new gap");
  assert.deepEqual(weakened([], [e("A.b", "proven-elsewhere")]), [["A.b", null, "proven-elsewhere"]], "a new proven-elsewhere");
  assert.deepEqual(weakened([e("A.b", "proven-elsewhere")], [e("A.b", "gap")]), [["A.b", "proven-elsewhere", "gap"]], "a proof given up");
  assert.deepEqual(weakened([e("A.b", "gap")], []), [], "a waiver removed");
  assert.deepEqual(weakened([e("A.b", "gap")], [e("A.b", "proven-elsewhere")]), [], "a gap that found its proof");
  assert.deepEqual(weakened([e("A.b", "gap", 3)], [e("A.b", "gap", 9)]), [], "an entry edited or moved");
});

it("an RPC-waiver declaration names the RPC and why, and covers exactly that RPC", () => {
  const declarations = parseDeclarations("RPC-waiver: A.b -- served by the cloud only; #12 owns the test\nrpc-waiver: C.d — no client yet");
  assert.deepEqual(declarations.rpcWaivers, [
    { subject: "A.b", reason: "served by the cloud only; #12 owns the test" },
    { subject: "C.d", reason: "no client yet" },
  ]);
  const comparison = { deleted: [], newSkips: [], weakenedWaivers: [{ rpc: "A.b", kind: "gap", line: 4 }, { rpc: "E.f", kind: "gap", was: "proven-elsewhere", line: 8 }] };
  const { refused, declared } = applyDeclarations(comparison, declarations);
  assert.deepEqual(declared.map((d) => [d.rule, d.path, d.line]), [["new-rpc-waiver", RPC_WAIVERS, 4]]);
  assert.match(declared[0].message, /A\.b is waived as `gap` and was not waived at the base: served by the cloud only/);
  assert.deepEqual(refused.map((r) => [r.rule, r.line]), [["new-rpc-waiver", 8]]);
  assert.match(refused[0].message, /E\.f's waiver moved from `proven-elsewhere` to `gap`; declare it with `RPC-waiver: E\.f -- <why no conformance test pins it>`/);
});

it("the report's last line is the verdict", () => {
  assert.match(formatReport({ findings: [], filesRead: 3 }), /test-integrity: 3 test file\(s\) read; clean$/);
});

// ─── A run's skips ──────────────────────────────────────────────────────

/** A vitest JSON report of one file's cases, `[ancestorTitles, title, status]` each. */
const report = (path, results) => ({
  testResults: [{ name: `/repo/${path}`, assertionResults: results.map(([ancestorTitles, title, status]) => ({ ancestorTitles, title, status })) }],
});
const judge = (text, results, path = "pkg/src/__tests__/a.test.ts") =>
  explainRunSkips(report(path, results), new Map([[path, inv(text, path)]]), "/repo");

it("a run's skipped case with no reason is unexplained", () => {
  const { skipped, findings } = judge(`it.skip("a", () => {});`, [[[], "a", "skipped"]]);
  assert.equal(skipped, 1);
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [["unexplained-skip", 1]]);
  assert.match(findings[0].message, /"a" was skipped at run time and the skip that covers it carries no reason/);
});

it("a run-time ctx.skip() under a condition nobody explained is unexplained", () => {
  const { findings } = judge(`it("a", (ctx) => { if (!envReady) return ctx.skip(); expect(1).toBe(1); });`, [[[], "a", "skipped"]]);
  assert.deepEqual(findings.map((f) => f.rule), ["unexplained-skip"]);
});

it("a quarantined case, or a case inside a quarantined suite, is explained", () => {
  const text = `
    // quarantined: stigmer#1322 -- the dev server times out
    it.skip("golden 18", () => {});
    // quarantined: stigmer#1323 -- flaky on the queue
    describe.skip("sweeps", () => { describe("expiry", () => { it("reclaims", () => {}); }); });
  `;
  const { findings, explained } = judge(text, [[[], "golden 18", "skipped"], [["sweeps", "expiry"], "reclaims", "skipped"]]);
  assert.deepEqual(findings, []);
  assert.deepEqual(explained.map((e) => [e.name, e.reason]), [
    ["golden 18", "quarantined on stigmer#1322"],
    ["sweeps > expiry > reclaims", "quarantined on stigmer#1323"],
  ]);
});

it("a skip by construction (a capability, the platform, a gate-provided dependency) is explained", () => {
  const text = `
    describe.skipIf(!target.capabilities.memory)("memory", () => { it("recalls", () => {}); });
    it.skipIf(process.platform === "win32")("links", () => {});
    describe.skipIf(!TEST_DATABASE_URL)("store", () => { it("writes", () => {}); });
  `;
  const { findings, explained } = judge(text, [[["memory"], "recalls", "skipped"], [[], "links", "skipped"], [["store"], "writes", "skipped"]]);
  assert.deepEqual(findings, []);
  assert.deepEqual(explained.map((e) => e.reason), ["target capability", "platform", "gate-provided dependency"]);
});

it("a skip site covers only its own case and the cases under its own suite", () => {
  const text = `
    // quarantined: stigmer#1322 -- flaky
    it.skip("a", () => {});
    describe("s", () => { it.skip("a", () => {}); });
  `;
  const { findings } = judge(text, [[["s"], "a", "skipped"]]);
  assert.deepEqual(findings.map((f) => [f.rule, f.line]), [["unexplained-skip", 4]]);
});

it("a computed title the inventory cannot match fails closed; cases that ran are not judged", () => {
  const text = `for (const n of [1, 2]) { it.skipIf(!TEST_DATABASE_URL)(\`case \${n}\`, () => {}); }`;
  const { skipped, findings } = judge(text, [[[], "case 1", "skipped"], [[], "case 2", "passed"]]);
  assert.equal(skipped, 1);
  assert.match(findings[0].message, /"case 1" was skipped at run time and no skip site in its file covers it/);
});

it("todo and disabled count as not run; a file outside the inventory is unexplained", () => {
  assert.equal(judge(`it.todo("t");`, [[[], "t", "todo"]]).findings.length, 1);
  const { findings } = explainRunSkips(report("elsewhere.test.ts", [[[], "x", "disabled"]]), new Map(), "/repo");
  assert.match(findings[0].message, /its file is not a tracked test file/);
});

it("the report counts the run's skips and lists the explained ones", () => {
  const text = formatReport({ findings: [], filesRead: 2, runReport: { skipped: 1, explained: [{ path: "a.test.ts", line: 2, name: "a", reason: "platform" }] } });
  assert.match(text, /• skipped {2}a\.test\.ts:2 {2}"a" \(platform\)/);
  assert.match(text, /test-integrity: 2 test file\(s\) read, 1 case\(s\) skipped in the run; clean$/);
});

// ─── Layout: names and places ───────────────────────────────────────────

it("a name's words are its last segment and the service and layer words before it; the topic is never a word", () => {
  assert.deepEqual(nameWords("x/__tests__/team.openfga.postgres.test.ts"), { words: ["openfga", "postgres"], last: "postgres", before: undefined });
  assert.deepEqual(nameWords("x/__tests__/panel.a11y.browser.test.tsx"), { words: ["browser"], last: "browser", before: "a11y" });
  assert.deepEqual(nameWords("x/__tests__/postgres-kinds.postgres.test.ts"), { words: ["postgres"], last: "postgres", before: undefined });
  assert.deepEqual(nameWords("x/__tests__/postgres.test.ts"), { words: [], last: undefined, before: undefined });
  assert.deepEqual(nameWords("x/__tests__/scope.load-tenancy.test.ts"), { words: [], last: "load-tenancy", before: undefined });
  assert.deepEqual(nameWords("x/__tests__/lane.e2e.test.ts"), { words: [], last: "e2e", before: undefined });
  assert.deepEqual(nameWords("test/e2e/tests/login.spec.ts"), { words: [], last: undefined, before: undefined });
});

it("reaching a service is a value use of its entry point; types, strings and an in-process mock reach nothing", () => {
  const services = (text) => [...scanModule(ts, "p/__tests__/a.test.ts", text).services].sort();
  assert.deepEqual(services(`const url = gateDependency("TEST_FGA_API_URL", "OpenFGA");`), ["openfga"]);
  assert.deepEqual(services(`const a = gateDependency("TEST_VAULT_ADDR", "OpenBAO"); const b = gateDependency("CLOUD_SCHEMA_TEST_DATABASE_URL", "x");`), ["postgres", "vault"]);
  assert.deepEqual(services(`const db = await createTestDatabase();`), ["postgres"]);
  assert.deepEqual(services(`import { createTestDatabase as make } from "./support.js"; await make();`), ["postgres"]);
  assert.deepEqual(services(`import { gateDependency as needs } from "./test-gate.js"; needs("TEST_FGA_API_URL", "OpenFGA");`), ["openfga"]);
  assert.deepEqual(services(`const { TestWorkflowEnvironment: TWE } = await import("@temporalio/testing"); env = await TWE.createLocal();`), ["temporal"]);
  assert.deepEqual(services(`env = await TestWorkflowEnvironment.createTimeSkipping();`), ["temporal"]);
  assert.deepEqual(services(`import { TestWorkflowEnvironment as Env } from "@temporalio/testing"; await Env.createLocal();`), ["temporal"]);
  assert.deepEqual(services(`const store = open(); await store.createLocal(); await createLocal();`), []);
  assert.deepEqual(services(`import * as testing from "@temporalio/testing"; await testing.TestWorkflowEnvironment.createLocal();`), ["temporal"]);
  assert.deepEqual(services(`const env = await (await import("@temporalio/testing")).TestWorkflowEnvironment.createTimeSkipping();`), ["temporal"]);
  assert.deepEqual(services(`import { MockActivityEnvironment } from "@temporalio/testing"; new MockActivityEnvironment();`), []);
  assert.deepEqual(services(`import type { TestWorkflowEnvironment } from "@temporalio/testing"; type E = import("@temporalio/testing").TestWorkflowEnvironment;`), []);
  assert.deepEqual(services(`const why = "needs TEST_DATABASE_URL and createTestDatabase()"; gateDependency(name, "x");`), []);
});

it("a module's value imports are followed; a type-only import is not", () => {
  const { valueImports } = scanModule(ts, "p/__tests__/a.test.ts", `
    import { a } from "./value";
    import type { T } from "./types-only";
    import { type U } from "./type-specifiers";
    import { type V, w } from "./mixed";
    import "./side-effect";
    import fallback from "./default";
    import * as all from "./namespace";
    export type { X } from "./type-re-export";
    export * from "./re-export";
    const m = await import("./dynamic.js");
  `);
  assert.deepEqual(valueImports, ["./value", "./mixed", "./side-effect", "./default", "./namespace", "./re-export", "./dynamic.js"]);
  const files = new Set(["p/__tests__/support.ts", "p/src/index.ts"]);
  assert.equal(resolveRelative("p/__tests__/a.test.ts", "./support.js", files), "p/__tests__/support.ts");
  assert.equal(resolveRelative("p/__tests__/a.test.ts", "../src", files), "p/src/index.ts");
  assert.equal(resolveRelative("p/__tests__/a.test.ts", "./missing", files), undefined);
});

/** Runs the layout rules over an in-memory tree: `tree` maps a path to its text. */
function layout(tree, { packages = ["pkg"], configs = {} } = {}) {
  const files = new Set(Object.keys(tree).filter((p) => /\.(m?ts|tsx)$/.test(p)));
  const tests = [...files].filter((p) => /\.(test|spec)\.(m?ts|tsx)$/.test(p));
  return checkLayout(ts, {
    tests,
    files,
    read: (p) => tree[p],
    packageDirs: new Set(packages),
    configs: Object.entries(configs).map(([path, text]) => ({ path, text })),
  }).map(layoutKey);
}

it("a service reached through a test helper must be named, and a named service must be reached", () => {
  const support = { "pkg/src/store/__tests__/support.ts": `export async function db() { return createTestDatabase(); }` };
  const reaches = `import { db } from "./support.js"; it("a", async () => { await db(); });`;
  assert.deepEqual(layout({ ...support, "pkg/src/store/__tests__/repo.test.ts": reaches }), ["layout-service-unnamed pkg/src/store/__tests__/repo.test.ts postgres"]);
  assert.deepEqual(layout({ ...support, "pkg/src/store/__tests__/repo.postgres.test.ts": reaches }), []);
  assert.deepEqual(layout({ "pkg/src/store/__tests__/repo.postgres.test.ts": `it("a", () => {});` }), ["layout-service-unreached pkg/src/store/__tests__/repo.postgres.test.ts postgres"]);
});

it("composed, conformance, load and live files, and the suites' own trees, may use any service unnamed", () => {
  const body = `const db = await createTestDatabase(); it("a", () => {});`;
  assert.deepEqual(layout({ "pkg/src/__tests__/lane.composed.test.ts": body }), []);
  assert.deepEqual(layout({ "test/e2e/tests/flow/login.spec.ts": body }, { packages: ["test/e2e"] }), []);
  assert.deepEqual(layout({ "test/conformance/src/suites/agent.conformance.test.ts": body }, { packages: ["test/conformance"] }), []);
  // They may not name a service they never reach.
  assert.deepEqual(layout({ "pkg/src/__tests__/lane.postgres.composed.test.ts": `it("a", () => {});` }), ["layout-service-unreached pkg/src/__tests__/lane.postgres.composed.test.ts postgres"]);
});

it("helpers that import each other are walked once, and a cycle ends the walk", () => {
  const tree = {
    "pkg/src/__tests__/a-support.ts": `import { b } from "./b-support.js"; export const a = () => b;`,
    "pkg/src/__tests__/b-support.ts": `import { a } from "./a-support.js"; export const b = () => createTestDatabase();`,
    "pkg/src/__tests__/repo.test.ts": `import { a } from "./a-support.js"; it("x", () => { a; });`,
  };
  assert.deepEqual(layout(tree), ["layout-service-unnamed pkg/src/__tests__/repo.test.ts postgres"]);
  // Either way into the cycle, the service at its far end is found.
  const both = {
    "pkg/src/__tests__/a-support.ts": `import { b } from "./b-support.js"; export const a = () => createTestDatabase();`,
    "pkg/src/__tests__/b-support.ts": `import { a } from "./a-support.js"; export const b = () => a;`,
    "pkg/src/__tests__/first.test.ts": `import { a } from "./a-support.js"; it("x", () => { a; });`,
    "pkg/src/__tests__/second.test.ts": `import { b } from "./b-support.js"; it("x", () => { b; });`,
  };
  assert.deepEqual(layout(both).sort(), ["layout-service-unnamed pkg/src/__tests__/first.test.ts postgres", "layout-service-unnamed pkg/src/__tests__/second.test.ts postgres"]);
});

it("reaching is followed through test helpers only, never into the module under test", () => {
  const tree = {
    "pkg/src/store.ts": `export const open = () => createTestDatabase();`,
    "pkg/src/__tests__/store.test.ts": `import { open } from "../store.js"; it("a", () => { open; });`,
  };
  assert.deepEqual(layout(tree), []);
});

it("a retired word is refused as the last word or right before the words; a11y or layout before browser is a topic", () => {
  const configs = { "pkg/vitest.a11y.config.ts": `export default { test: { include: ["src/**/*.browser.test.tsx"] } };` };
  assert.deepEqual(layout({ "pkg/src/__tests__/lane.integration.test.ts": `it("a", () => {});` }), ["layout-retired-word pkg/src/__tests__/lane.integration.test.ts integration"]);
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.a11y.browser.test.tsx": `it("a", () => {});` }, { configs }), []);
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.layout.browser.test.tsx": `it("a", () => {});` }, { configs }), []);
  const db = `const db = await createTestDatabase(); it("a", () => {});`;
  assert.deepEqual(layout({ "pkg/src/__tests__/lane.integration.postgres.test.ts": db }), ["layout-retired-word pkg/src/__tests__/lane.integration.postgres.test.ts integration"]);
  assert.deepEqual(layout({ "pkg/src/__tests__/scope.measure.browser.test.tsx": `it("a", () => {});` }, { configs }), ["layout-retired-word pkg/src/__tests__/scope.measure.browser.test.tsx measure"]);
});

it("a layer word goes only where its layer lives", () => {
  const ok = `it("a", () => {});`;
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.browser.test.tsx": ok }), ["layout-word-place pkg/src/__tests__/panel.browser.test.tsx browser"]);
  // A config that only excludes the browser files, or names them in a comment, collects none of them.
  const excluding = { "pkg/vitest.config.ts": `// *.browser.test.tsx run elsewhere\nexport default { test: { exclude: ["**/*.browser.test.tsx"] } };` };
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.browser.test.tsx": ok }, { configs: excluding }), ["layout-word-place pkg/src/__tests__/panel.browser.test.tsx browser"]);
  // A nested package's config collects for that package, not for its parent.
  const nested = { "pkg/sub/vitest.config.ts": `export default { test: { include: ["src/**/*.browser.test.tsx"] } };` };
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.browser.test.tsx": ok }, { packages: ["pkg", "pkg/sub"], configs: nested }), ["layout-word-place pkg/src/__tests__/panel.browser.test.tsx browser"]);
  // An include given as a module-level const array is read.
  const named = { "pkg/vitest.a11y.config.ts": `const GLOBS = ["src/**/*.browser.test.tsx"];\nexport default { test: { include: GLOBS } };` };
  assert.deepEqual(layout({ "pkg/src/__tests__/panel.browser.test.tsx": ok }, { configs: named }), []);
  assert.deepEqual(layout({ "pkg/src/__tests__/scope.load.test.ts": ok }), ["layout-word-place pkg/src/__tests__/scope.load.test.ts load"]);
  assert.deepEqual(layout({ "pkg/src/__tests__/scope.load.test.ts": ok }, { configs: { "pkg/vitest.load.config.ts": "" } }), []);
  assert.deepEqual(layout({ "pkg/src/__tests__/agent.conformance.test.ts": ok }), ["layout-word-place pkg/src/__tests__/agent.conformance.test.ts conformance"]);
});

it("a TypeScript test lives in __tests__, a spec under the e2e homes; the suites' trees are placed by their suite", () => {
  const ok = `it("a", () => {});`;
  assert.deepEqual(layout({ "pkg/src/cmd/run.test.ts": ok }), ["layout-placement pkg/src/cmd/run.test.ts"]);
  assert.deepEqual(layout({ "pkg/src/cmd/__tests__/run.test.ts": ok }), []);
  assert.deepEqual(layout({ "pkg/e2e/flow.spec.ts": ok }), ["layout-placement pkg/e2e/flow.spec.ts"]);
  assert.deepEqual(layout({ "site/e2e/demos/demo.spec.ts": ok }, { packages: ["site"] }), []);
  assert.deepEqual(layout({ "test/conformance/src/suites-execution/agent.harness.test.ts": ok }, { packages: ["test/conformance"] }), []);
});

it("test/support imports only node:* and its own files by their .ts path; its own tests are free", () => {
  const tree = {
    "test/support/src/fake.ts": `import { createServer } from "node:http";\nimport { wire } from "./wire.ts";\nimport { x } from "./other";\nimport pg from "pg";\nimport { store } from "../../../backend/services/stigmer-server/src/store/store.ts";`,
    "test/support/src/wire.ts": `export const wire = 1;`,
    "test/support/src/__tests__/fake.test.ts": `import { describe } from "vitest"; it("a", () => {});`,
  };
  assert.deepEqual(layout(tree, { packages: ["test/support"] }), ["layout-support-import test/support/src/fake.ts ./other", "layout-support-import test/support/src/fake.ts pg", "layout-support-import test/support/src/fake.ts ../../../backend/services/stigmer-server/src/store/store.ts"]);
});

it("the baseline is read line by line: comments skipped, any other shape and a repeated line refused", () => {
  const { entries, problems } = readLayoutBaseline("# why\n\nlayout-placement a/b.test.ts\nnot a line\nlayout-placement a/b.test.ts\n");
  assert.deepEqual(entries.map((e) => [e.key, e.line]), [["layout-placement a/b.test.ts", 3], ["layout-placement a/b.test.ts", 5]]);
  assert.deepEqual(problems.map((p) => p.line), [4, 5]);
});

it("a listed finding is counted, an unlisted one refused, a stale line refused, and a line the base lacked refused", () => {
  const finding = (rule, path) => ({ rule, path, line: 1, message: "m" });
  const findings = [finding("layout-placement", "a.test.ts"), finding("layout-retired-word", "b.e2e.test.ts")];
  const head = readLayoutBaseline("layout-placement a.test.ts\nlayout-placement gone.test.ts\n").entries;
  const noBase = applyLayoutBaseline(findings, head, undefined);
  assert.equal(noBase.baselined, 1);
  assert.deepEqual(noBase.refused.map((f) => `${f.rule} ${f.path}:${f.line}`), ["layout-retired-word b.e2e.test.ts:1", `layout-baseline-stale ${LAYOUT_BASELINE}:2`]);
  const base = readLayoutBaseline("layout-placement gone.test.ts\n").entries;
  const grown = applyLayoutBaseline(findings, head, base);
  assert.deepEqual(grown.refused.map((f) => f.rule), ["layout-retired-word", "layout-baseline-grown", "layout-baseline-stale"]);
  assert.equal(applyLayoutBaseline(findings, undefined, undefined).refused.length, 2);
});

it("a line that follows its file through a rename is the base's line; a line for any other file is new", () => {
  const finding = { rule: "layout-placement", path: "pkg/src/new.test.ts", line: 1, message: "m" };
  const head = readLayoutBaseline("layout-placement pkg/src/new.test.ts\n").entries;
  const base = readLayoutBaseline("layout-placement pkg/src/old.test.ts\n").entries;
  assert.deepEqual(applyLayoutBaseline([finding], head, base, new Map([["pkg/src/new.test.ts", "pkg/src/old.test.ts"]])).refused, []);
  assert.deepEqual(applyLayoutBaseline([finding], head, base, new Map()).refused.map((f) => f.rule), ["layout-baseline-grown"]);
  assert.deepEqual(applyLayoutBaseline([finding], head, base, new Map([["pkg/src/new.test.ts", "pkg/src/other.test.ts"]])).refused.map((f) => f.rule), ["layout-baseline-grown"]);
});

it("a detailed line follows its rename only with the same detail", () => {
  const unnamed = { rule: "layout-service-unnamed", path: "pkg/src/__tests__/new.test.ts", line: 1, message: "m", detail: "postgres" };
  const renamed = new Map([["pkg/src/__tests__/new.test.ts", "pkg/src/__tests__/old.test.ts"]]);
  const base = readLayoutBaseline("layout-service-unnamed pkg/src/__tests__/old.test.ts postgres\n").entries;
  const same = readLayoutBaseline("layout-service-unnamed pkg/src/__tests__/new.test.ts postgres\n").entries;
  assert.deepEqual(applyLayoutBaseline([unnamed], same, base, renamed).refused, []);
  const other = { ...unnamed, detail: "temporal" };
  const changed = readLayoutBaseline("layout-service-unnamed pkg/src/__tests__/new.test.ts temporal\n").entries;
  assert.deepEqual(applyLayoutBaseline([other], changed, base, renamed).refused.map((f) => f.rule), ["layout-baseline-grown"]);
});

it("a listed finding covers only itself: a second service on a listed file is refused", () => {
  const unnamed = (service) => ({ rule: "layout-service-unnamed", path: "a.test.ts", line: 1, message: "m", detail: service });
  const head = readLayoutBaseline("layout-service-unnamed a.test.ts postgres\n").entries;
  const { refused, baselined } = applyLayoutBaseline([unnamed("postgres"), unnamed("temporal")], head, head);
  assert.equal(baselined, 1);
  assert.deepEqual(refused.map(layoutKey), ["layout-service-unnamed a.test.ts temporal"]);
});

// ─── The command, end to end ────────────────────────────────────────────

/** Where the end-to-end cases keep their test file: a `__tests__` directory, as the placement rule asks. */
const A_TEST = "pkg/src/__tests__/a.test.ts";

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
    r.write(A_TEST, `it("a", () => { if (!ready) return; });`);
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    const result = r.run();
    assert.equal(result.status, 1);
    assert.match(result.stdout, /valueless-return +pkg\/src\/__tests__\/a\.test\.ts:1/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: a run report's unexplained skip fails, a quarantined one passes, a missing report cannot be judged", () => {
  const r = repo();
  try {
    r.write(A_TEST, `it.skip("a", () => {});`);
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    const write = () => r.write("run.json", JSON.stringify({ testResults: [{ name: join(r.dir, A_TEST), assertionResults: [{ ancestorTitles: [], title: "a", status: "skipped" }] }] }));
    write();
    const refused = r.run("--run-report", join(r.dir, "run.json"));
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stdout, /unexplained-skip +pkg\/src\/__tests__\/a\.test\.ts:1/);

    r.write(A_TEST, `// quarantined: stigmer#1322 -- flaky\nit.skip("a", () => {});`);
    r.git("commit", "-qam", "quarantine");
    const passed = r.run("--run-report", join(r.dir, "run.json"));
    assert.equal(passed.status, 0, passed.stdout);
    assert.match(passed.stdout, /1 case\(s\) skipped in the run; clean$/m);

    assert.equal(r.run("--run-report", join(r.dir, "missing.json")).status, 2);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: a new RPC waiver is refused until declared; a tree without the file has no such rule", () => {
  const r = repo();
  try {
    const waivers = (...entries) => `waivers:\n${entries.map(([rpc, kind]) => `  - rpc: ${rpc}\n    kind: ${kind}\n    reason: >-\n      Why.\n`).join("")}`;
    r.write(A_TEST, `it("a", () => {});`);
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    r.git("checkout", "-q", "-b", "without");
    r.write(A_TEST, `it("a", () => {}); it("b", () => {});`);
    r.git("commit", "-qam", "no waiver file anywhere");
    assert.equal(r.run("--base", "main").status, 0);

    r.git("checkout", "-q", "main");
    r.git("checkout", "-q", "-b", "change");
    r.write(RPC_WAIVERS, waivers(["A.b", "proven-elsewhere"]));
    r.git("add", ".");
    r.git("commit", "-q", "-m", "add the file");
    const refused = r.run("--base", "main");
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stdout, /new-rpc-waiver +test\/conformance\/inventory\/rpc-waivers\.yaml:2 +A\.b is waived as `proven-elsewhere` and was not waived at the base/);

    r.write("body.md", "RPC-waiver: A.b -- pinned by the server's own suite");
    const declared = r.run("--base", "main", "--pr-body-file", join(r.dir, "body.md"));
    assert.equal(declared.status, 0, declared.stdout);
    assert.match(declared.stdout, /declared .*A\.b is waived as `proven-elsewhere` and was not waived at the base: pinned by the server's own suite/);

    r.git("checkout", "-q", "main");
    r.git("merge", "-q", "--ff-only", "change");
    r.git("checkout", "-q", "-b", "weaken");
    r.write(RPC_WAIVERS, waivers(["A.b", "gap"]));
    r.git("commit", "-qam", "give up the proof");
    const weakened = r.run("--base", "main");
    assert.equal(weakened.status, 1, weakened.stdout);
    assert.match(weakened.stdout, /A\.b's waiver moved from `proven-elsewhere` to `gap`/);

    r.write(RPC_WAIVERS, `waivers:\n    - rpc: A.b\n      kind: gap\n`);
    r.git("commit", "-qam", "re-indent");
    const shape = r.run("--base", "main");
    assert.equal(shape.status, 1, shape.stdout);
    assert.match(shape.stdout, /rpc-waivers-shape +test\/conformance\/inventory\/rpc-waivers\.yaml:2/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: a misplaced test is refused until listed; the list refuses a stale line and, against a base, a new one", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/run.test.ts", `it("a", () => {});`);
    r.write(LAYOUT_BASELINE, "# listed\nlayout-placement pkg/src/run.test.ts\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    const listed = r.run();
    assert.equal(listed.status, 0, listed.stdout);
    assert.match(listed.stdout, /1 layout finding\(s\) listed in scripts\/test-layout-baseline\.txt; clean$/m);

    r.git("checkout", "-q", "-b", "grow");
    r.write("pkg/src/other.test.ts", `it("b", () => {});`);
    r.write(LAYOUT_BASELINE, "layout-placement pkg/src/run.test.ts\nlayout-placement pkg/src/other.test.ts\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "list a new misplaced test");
    const grown = r.run("--base", "main");
    assert.equal(grown.status, 1, grown.stdout);
    assert.match(grown.stdout, /layout-baseline-grown +scripts\/test-layout-baseline\.txt:2/);

    r.git("checkout", "-q", "main");
    r.git("checkout", "-q", "-b", "rename");
    r.git("mv", "pkg/src/run.test.ts", "pkg/src/runs.test.ts");
    r.write(LAYOUT_BASELINE, "# listed\nlayout-placement pkg/src/runs.test.ts\n");
    r.git("commit", "-qam", "rename a listed file, its line follows it");
    const followed = r.run("--base", "main");
    assert.equal(followed.status, 0, followed.stdout);

    r.git("checkout", "-q", "main");
    r.git("checkout", "-q", "-b", "fix");
    mkdirSync(join(r.dir, "pkg/src/__tests__"), { recursive: true });
    r.git("mv", "pkg/src/run.test.ts", "pkg/src/__tests__/run.test.ts");
    r.git("commit", "-q", "-m", "move it, keep the line");
    const stale = r.run("--base", "main");
    assert.equal(stale.status, 1, stale.stdout);
    assert.match(stale.stdout, /layout-baseline-stale +scripts\/test-layout-baseline\.txt:2/);

    r.write(LAYOUT_BASELINE, "# listed\n");
    r.git("commit", "-qam", "drop the line");
    const fixed = r.run("--base", "main");
    assert.equal(fixed.status, 0, fixed.stdout);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

it("the command: a baseline line of any other shape, or listed twice, is refused", () => {
  const r = repo();
  try {
    r.write("pkg/package.json", "{}");
    r.write("pkg/src/run.test.ts", `it("a", () => {});`);
    r.write(LAYOUT_BASELINE, "layout-placement pkg/src/run.test.ts\nlayout-placement pkg/src/run.test.ts\nnot a line\n");
    r.git("add", ".");
    r.git("commit", "-q", "-m", "base");
    const result = r.run();
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /layout-baseline-shape +scripts\/test-layout-baseline\.txt:2 +`layout-placement pkg\/src\/run\.test\.ts` is listed twice/);
    assert.match(result.stdout, /layout-baseline-shape +scripts\/test-layout-baseline\.txt:3/);
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
