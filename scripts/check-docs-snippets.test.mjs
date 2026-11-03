/**
 * Pins the docs snippet gate's own decisions, with no compiler: how a page's
 * fences are scanned and classified (a whole file, a fragment, a prelude, a
 * marked exception, and the shapes refused), how a fence's hidden setup is
 * split from what the reader sees with every line kept on its page line,
 * how a page's prelude reaches its fragments and is refused without one,
 * how a relative import finds the titled fence above it, which lines an
 * assembled file owes to the prelude, the theme playground's looks the gate
 * writes code for, the list of known failures, which may only shrink, and
 * the CLI's use of it against a base branch's list in a scratch repository. The compilers themselves are pinned against real
 * toolchains by scripts/lib/docs-snippets/compilers.test.mjs, in the lane
 * that sets them up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { splitSnippetSetup } from "../site/src/lib/snippet-setup.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { judge, scopeOf } from "./check-docs-snippets.mjs";
import { Assembly, located } from "./lib/docs-snippets/assemble.mjs";
import { collectPage, relativeImports } from "./lib/docs-snippets/collect.mjs";
import { classify, scanFences } from "./lib/docs-snippets/fences.mjs";
import { packageName, safeImportPaths } from "./lib/docs-snippets/go.mjs";
import { livePresets, themeUnits } from "./lib/docs-snippets/theme-snippets.mjs";
import {
  compareToList,
  entryKey,
  failingMultiset,
  fenceDigest,
  formatList,
  growthAgainstBase,
  parseList,
  prune,
  within,
} from "./lib/docs-snippets/ratchet.mjs";

const fence = (lang, meta, body = "x\n") => ({ path: "p.mdx", line: 1, lang, meta, body });

test("a fence is classified as a file, a fragment, a prelude or an exception", () => {
  assert.deepEqual(classify(fence("ts", "")), { kind: "fragment", language: "typescript" });
  assert.deepEqual(classify(fence("go", "", "package main\n")), { kind: "file", language: "go" });
  assert.deepEqual(classify(fence("typescript", 'title="client.ts"')), { kind: "file", language: "typescript" });
  assert.deepEqual(classify(fence("python", "prelude")), { kind: "prelude", language: "python" });
  assert.deepEqual(classify(fence("java", 'no-compile="pseudo-code"')), { kind: "skip", language: "java", reason: "pseudo-code" });
  assert.deepEqual(classify(fence("ts", 'compile="file"')), { kind: "file", language: "typescript" });
  assert.equal(classify(fence("bash", "")), null);
});

test("the shapes the gate refuses say what to do", () => {
  assert.match(classify(fence("go", 'title="go.mod"')).problem, /label this fence by what it is/);
  assert.match(classify(fence("ts", 'no-compile=""')).problem, /needs a reason/);
  assert.match(classify(fence("ts", 'prelude no-compile="x"')).problem, /cannot also be/);
  assert.match(classify(fence("ts", 'prelude title="a.ts"')).problem, /not a file/);
  assert.match(classify(fence("ts", 'compile="react"')).problem, /only value is compile="file"/);
  // A reason that says "prelude" does not make the fence one.
  assert.equal(classify(fence("ts", 'no-compile="see the prelude above"')).kind, "skip");
});

test("the scanner keeps an indented fence's body and refuses an unclosed one", () => {
  const fences = scanFences("p.mdx", "1. Step\n\n   ```go\n   x := 1\n   ```\n");
  assert.equal(fences[0].body, "x := 1\n");
  assert.equal(fences[0].line, 3);
  assert.throws(() => scanFences("p.mdx", "```ts\nopen\n"), /unclosed code fence/);
});

test("the setup split hides the lines above the marker, once", () => {
  assert.deepEqual(splitSnippetSetup("ts", "declare const user: User;\n// ---cut---\nuser.id;\n"), {
    setup: "declare const user: User;",
    body: "user.id;\n",
    hiddenLines: 2,
  });
  assert.equal(splitSnippetSetup("python", "user = None\n# ---cut---\nprint(user)\n").body, "print(user)\n");
  assert.deepEqual(splitSnippetSetup("go", "x := 1\n"), { setup: "", body: "x := 1\n", hiddenLines: 0 });
  // A language with no compiler takes no marker: its text is all shown.
  assert.equal(splitSnippetSetup("bash", "# ---cut---\nls\n").body, "# ---cut---\nls\n");
  // Python's marker is Python's: a `//` line is code there.
  assert.equal(splitSnippetSetup("python", "// ---cut---\n").hiddenLines, 0);
  assert.throws(() => splitSnippetSetup("ts", "a\n// ---cut---\nb\n// ---cut---\nc\n"), /setup ends once/);
});

const PAGE = [
  "# A page", //                          1
  "", //                                  2
  "```typescript prelude", //             3
  'import { RunPhase } from "x";', //     4
  "```", //                               5
  "", //                                  6
  "```typescript", //                     7
  "declare const user: { org: string };", // 8
  "// ---cut---", //                      9
  "user.org;", //                         10
  "```", //                               11
  "",
  "```typescript title=\"client.ts\"",
  "export const org = 'acme';",
  "```",
  "",
  "```typescript title=\"report.ts\"",
  'import { org } from "./client.js";',
  "```",
  "",
].join("\n");

test("a fragment carries its setup and body on their page lines, and the page's prelude", () => {
  const { units, problems } = collectPage("docs/p.mdx", PAGE);
  assert.deepEqual(problems, []);
  const fragment = units.find((u) => u.kind === "fragment");
  assert.deepEqual(fragment.setup, [{ text: "declare const user: { org: string };", line: 8 }]);
  assert.deepEqual(fragment.body, [{ text: "user.org;", line: 10 }]);
  assert.deepEqual(fragment.prelude, [{ text: 'import { RunPhase } from "x";', line: 4 }]);
  // The fence's whole text, setup included, is its identity on the list.
  assert.equal(fragment.text, "declare const user: { org: string };\n// ---cut---\nuser.org;\n");
  // A titled file takes no prelude: it is compiled as it stands.
  assert.deepEqual(units.find((u) => u.title === "client.ts").prelude, []);
});

test("a relative import finds the nearest titled fence above it, never one below", () => {
  const { units } = collectPage("docs/p.mdx", PAGE);
  const report = units.find((u) => u.title === "report.ts");
  assert.deepEqual(report.siblings, [{ path: "client.ts", id: units.find((u) => u.title === "client.ts").id }]);

  const twoTabs = ['```ts title="client.ts"', "a", "```", '```ts title="client.ts"', "b", "```", '```ts title="r.ts"', 'import "./client.js";', "```"].join("\n");
  const r = collectPage("docs/p.mdx", twoTabs).units;
  assert.equal(r[2].siblings[0].id, r[1].id);

  const below = ['```ts title="r.ts"', 'import { x } from "./client.js";', "```", '```ts title="client.ts"', "export const x = 1;", "```"].join("\n");
  const { problems } = collectPage("docs/p.mdx", below);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /no TypeScript fence above it/);
  assert.deepEqual(relativeImports('import a from "./a.js";\nexport * from "../b";\nimport "c";'), ["./a.js", "../b"]);
});

test("a prelude with no fragment of its language to compile through is refused", () => {
  const page = ["```go prelude", 'import "fmt"', "```", "```python", "print(1)", "```"].join("\n");
  const { problems } = collectPage("docs/p.mdx", page);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].line, 1);
  assert.match(problems[0].message, /no go fragment on the page/);
});

test("an assembled file maps the prelude's lines to the page and marks them", () => {
  const a = new Assembly().add("export {};").addPrelude(['import "x";'], [4]).addSource([{ text: "user.org;", line: 10 }]);
  assert.equal(a.pageLine(1), null);
  assert.equal(a.pageLine(2), 4);
  assert.equal(a.fromPrelude(2), true);
  assert.equal(a.fromPrelude(3), false);
  const unit = { id: 0, page: "p.mdx", line: 7 };
  assert.match(located(unit, a, 1, "boom").message, /gate's convention/);
  assert.equal(located(unit, a, 1, "boom").line, 7);
  assert.match(located(unit, a, 2, "boom").message, /page's prelude, compiling the fence at line 7/);
  assert.equal(located(unit, a, 3, "boom").line, 10);
});

test("Go names an unaliased import as its package does", () => {
  assert.equal(packageName("go.stigmer.ai/sdk"), "stigmer");
  assert.equal(packageName("go.stigmer.ai/sdk/proto/ai/stigmer/agentic/agent/v1"), "agentv1");
  assert.equal(packageName("context"), "context");
});

const unit = (id, page, text, language = "typescript") => ({ id, page, language, text });

test("the known failures are a multiset: two identical failing fences are two", () => {
  const units = [unit(0, "a.mdx", "x\n"), unit(1, "a.mdx", "x\n"), unit(2, "a.mdx", "y\n")];
  const failing = failingMultiset(units, new Set([0, 1]));
  assert.equal(failing.get(entryKey({ page: "a.mdx", language: "typescript", sha: fenceDigest("x\n") })), 2);
  assert.equal(failing.size, 1);
  const listedOnce = new Map([[entryKey({ page: "a.mdx", language: "typescript", sha: fenceDigest("x\n") }), 1]]);
  assert.equal(compareToList(failing, listedOnce).unlisted[0].extra, 1);
});

test("a listed fence that compiles is stale, and pruning only removes", () => {
  const key = (t) => entryKey({ page: "a.mdx", language: "go", sha: fenceDigest(t) });
  const listed = new Map([
    [key("fixed\n"), 1],
    [key("still\n"), 2],
  ]);
  const failing = new Map([
    [key("still\n"), 1],
    [key("new\n"), 1],
  ]);
  const { unlisted, stale } = compareToList(failing, listed);
  assert.deepEqual(unlisted.map((u) => u.sha), [fenceDigest("new\n")]);
  assert.deepEqual(stale.map((s) => [s.sha, s.extra]).sort(), [[fenceDigest("fixed\n"), 1], [fenceDigest("still\n"), 1]].sort());
  const pruned = prune(listed, failing);
  assert.deepEqual([...pruned], [[key("still\n"), 1]]);
});

test("the list may not grow against the base, and a base without one is the bootstrap", () => {
  const k = entryKey({ page: "a.mdx", language: "java", sha: fenceDigest("j\n") });
  const other = entryKey({ page: "b.mdx", language: "java", sha: fenceDigest("j\n") });
  assert.deepEqual(growthAgainstBase(new Map([[k, 2]]), new Map([[k, 2]])), []);
  assert.equal(growthAgainstBase(new Map([[k, 3]]), new Map([[k, 2]]))[0].extra, 1);
  assert.equal(growthAgainstBase(new Map([[other, 1]]), new Map([[k, 2]])).length, 1);
  assert.deepEqual(growthAgainstBase(new Map([[k, 9]]), null), []);
});

test("the list file round-trips sorted, with its total, and refuses a wrong one", () => {
  const counts = new Map([
    [entryKey({ page: "b.mdx", language: "go", sha: "bbbbbbbbbbbb" }), 1],
    [entryKey({ page: "a.mdx", language: "typescript", sha: "aaaaaaaaaaaa" }), 2],
  ]);
  const text = formatList(counts);
  assert.deepEqual(parseList(text), counts);
  const data = JSON.parse(text);
  assert.equal(data.total, 3);
  assert.equal(data.fences[0].page, "a.mdx");
  assert.throws(() => parseList(JSON.stringify({ total: 9, fences: data.fences })), /total says 9/);
  assert.throws(() => parseList(JSON.stringify({ total: 2, fences: [data.fences[0], data.fences[0]] })), /listed twice/);
  assert.throws(() => parseList(JSON.stringify({ total: 1, fences: [{ page: "a", language: "go", sha: "zz", count: 1 }] })), /malformed/);
});

test("a run over some pages calls only their entries stale", () => {
  const inRun = entryKey({ page: "a.mdx", language: "go", sha: "aaaaaaaaaaaa" });
  const outside = entryKey({ page: "b.mdx", language: "go", sha: "bbbbbbbbbbbb" });
  const scoped = within(new Map([[inRun, 1], [outside, 1]]), new Set(["a.mdx"]), new Set(["go"]));
  assert.deepEqual([...scoped.keys()], [inRun]);
  const verdict = judge({ units: [], errors: [] }, { listed: new Map([[inRun, 1], [outside, 1]]), base: null, scope: new Set(["a.mdx"]), languages: ["go"] });
  assert.equal(verdict.stale.length, 1);
  assert.equal(verdict.stale[0].page, "a.mdx");
});

test("the playground's code is written for every live preset, in both modes, at both radii", () => {
  const presets = livePresets('export const LIVE_PRESETS = ["default", "corporate", "monochrome"] as const;\nexport type LivePreset = 1;');
  assert.deepEqual(presets, ["default", "corporate", "monochrome"]);
  const seen = [];
  const units = themeUnits((theme) => {
    seen.push(theme);
    return { tsx: `// ${theme.preset}\n` };
  }, presets, 40);
  assert.equal(units.length, 12);
  assert.deepEqual(units.map((u) => u.id), Array.from({ length: 12 }, (_, i) => 40 + i));
  assert.deepEqual(new Set(seen.map((t) => `${t.mode}:${t.radius}`)), new Set(["light:null", "dark:null", "light:0.75", "dark:0.75"]));
  assert.ok(units.every((u) => u.kind === "file" && u.language === "typescript" && u.page === "site/src/lib/theme-snippet.mjs"));
  assert.throws(() => livePresets("export const OTHER = [];"), /no LIVE_PRESETS/);
});

test("a tilde fence is scanned as a backtick fence is, and closes only on its own character", () => {
  const fences = scanFences("p.mdx", "~~~go\nx := 1\n```\n~~~\n~~~~python title=\"a`b.py\"\nprint(1)\n~~~~\n");
  assert.equal(fences.length, 2);
  assert.equal(fences[0].body, "x := 1\n```\n");
  assert.equal(fences[1].lang, "python");
});

test("a Go fence cannot import a path the go command would read as a flag", () => {
  assert.deepEqual(safeImportPaths(["fmt", "go.stigmer.ai/sdk"]), ["fmt", "go.stigmer.ai/sdk"]);
  assert.throws(() => safeImportPaths(["fmt", "-toolexec=/bin/sh"]), /not an import path/);
});

test("a full run answers for every listed page, a narrowed run for its own, and the playground only when it compiled", () => {
  const key = (page) => entryKey({ page, language: "go", sha: "aaaaaaaaaaaa" });
  const listed = new Map([[key("docs/gone.mdx"), 1], [key("site/src/lib/theme-snippet.mjs"), 1]]);
  assert.deepEqual([...scopeOf({ pages: ["docs/a.mdx"], units: [], listed, full: true })].sort(), ["docs/a.mdx", "docs/gone.mdx"]);
  assert.deepEqual([...scopeOf({ pages: ["docs/a.mdx"], units: [], listed, full: false })], ["docs/a.mdx"]);
  const withTheme = scopeOf({ pages: [], units: [{ page: "site/src/lib/theme-snippet.mjs" }], listed, full: false });
  assert.deepEqual([...withTheme], ["site/src/lib/theme-snippet.mjs"]);
});

// The CLI against a scratch repository: a page with a fence that fails
// (a string where a number goes) and one that compiles, in TypeScript alone,
// which needs no toolchain beyond the workspace's compiler.
const CLI = fileURLToPath(new URL("./check-docs-snippets.mjs", import.meta.url));
const FAILS = "const total: number = \"12\";\n";
const OTHER_FAILS = "const count: number = \"7\";\n";
const page = (...bodies) => ["# Page", "", ...bodies.flatMap((b) => ["```typescript", b.trimEnd(), "```", ""])].join("\n");
const listOf = (entries) => formatList(new Map(entries.map(([p, text]) => [entryKey({ page: p, language: "typescript", sha: fenceDigest(text) }), 1])));

function scratchRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "docs-snippets-cli-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=docs@example.test", "-c", "user.name=docs", "commit", "-qm", "base");
  const write = (path, text) => {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  return { dir, git, write };
}

const cli = (dir, ...args) => spawnSync(process.execPath, [CLI, "--lang=typescript", `--docs-root=${dir}`, ...args], { encoding: "utf8" });

test("the CLI refuses a list that grew against the base's, and takes a base without one as the bootstrap", () => {
  const repo = scratchRepo({
    "docs/a.mdx": page(FAILS, "const ok = 1;\n"),
    "test/docs-snippets-known-failing.json": listOf([["docs/a.mdx", FAILS]]),
  });
  try {
    assert.equal(cli(repo.dir, "--base=HEAD").status, 0);
    repo.write("docs/a.mdx", page(FAILS, OTHER_FAILS));
    repo.write("test/docs-snippets-known-failing.json", listOf([["docs/a.mdx", FAILS], ["docs/a.mdx", OTHER_FAILS]]));
    const grown = cli(repo.dir, "--base=HEAD");
    assert.equal(grown.status, 1);
    assert.match(grown.stdout, /is not on HEAD's list; the list may only shrink/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
  const bootstrap = scratchRepo({ "docs/a.mdx": page(FAILS) });
  try {
    bootstrap.write("test/docs-snippets-known-failing.json", listOf([["docs/a.mdx", FAILS]]));
    assert.equal(cli(bootstrap.dir, "--base=HEAD").status, 0);
  } finally {
    rmSync(bootstrap.dir, { recursive: true, force: true });
  }
});

test("--prune drops what a run no longer fails, keeps entries outside the run, and a full run calls a vanished page's entry stale", () => {
  const repo = scratchRepo({
    "docs/a.mdx": page("const fixed = 1;\n"),
    "docs/b.mdx": page(OTHER_FAILS),
    "test/docs-snippets-known-failing.json": listOf([["docs/a.mdx", FAILS], ["docs/b.mdx", OTHER_FAILS], ["docs/gone.mdx", FAILS]]),
  });
  try {
    const stale = cli(repo.dir);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /docs\/a\.mdx: a listed typescript fence/);
    assert.match(stale.stdout, /docs\/gone\.mdx: a listed typescript fence/);
    assert.equal(cli(repo.dir, "--page=docs/a.mdx", "--prune").status, 0);
    const kept = parseList(readFileSync(join(repo.dir, "test/docs-snippets-known-failing.json"), "utf8"));
    assert.deepEqual([...kept.keys()].map((k) => k.split("\u0000")[0]).sort(), ["docs/b.mdx", "docs/gone.mdx"]);
    assert.equal(cli(repo.dir, "--prune").status, 0);
    const full = parseList(readFileSync(join(repo.dir, "test/docs-snippets-known-failing.json"), "utf8"));
    assert.deepEqual([...full.keys()].map((k) => k.split("\u0000")[0]), ["docs/b.mdx"]);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});
