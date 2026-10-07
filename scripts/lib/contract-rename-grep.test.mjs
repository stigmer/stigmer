// Pins the string half of a contract rename: the residue is every tracked
// line quoting an old name minus an allow list that names each kept literal
// by path and line, an allow rule that matches nothing is reported (a stale
// exemption is a lie), and the engine-literal census compares per-file
// counts across moved files so a rename that only moves a file is not a
// difference. `git grep` runs on a throwaway repository, at a ref and in the
// tree. Run via `node --test scripts/lib/*.test.mjs`.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  classifyResidue,
  compareCensus,
  countByFile,
  gitGrep,
  gitRenames,
  globToRegExp,
  parseAllowList,
} from "./contract-rename-grep.mjs";

function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "contract-rename-grep-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { dir, git };
}

test("globs match whole paths: * within a segment, ** across", () => {
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/x/a.ts"));
  assert.ok(globToRegExp("src/**/a.ts").test("src/x/y/a.ts"));
  assert.ok(globToRegExp("src/**/a.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/a.ts").test("src/a_ts"), "a dot is literal");
});

test("the allow list keeps named literals, the rest is residue, and an unused rule is reported", () => {
  const rules = parseAllowList('# engine\nsrc/engine/*.ts\t"agent-execution"\nsrc/old.ts\tAGENT_RUN_KIND\n\n');
  const hits = [
    { file: "src/engine/names.ts", line: 3, text: 'const Q = "agent-execution";' },
    { file: "src/engine/names.ts", line: 4, text: "const k = AgentRun;" },
    { file: "src/use.ts", line: 1, text: 'const q = "agent-execution";' },
  ];
  const { kept, residue, unused } = classifyResidue(hits, rules);
  assert.deepEqual(
    kept.map((h) => h.line),
    [3],
  );
  assert.deepEqual(
    residue.map((h) => `${h.file}:${h.line}`),
    ["src/engine/names.ts:4", "src/use.ts:1"],
  );
  assert.deepEqual(unused, ["src/old.ts\tAGENT_RUN_KIND"]);
  assert.throws(() => parseAllowList("no tab here"), /expected <path glob><TAB><line regex>/);
});

test("the census follows a moved file and reports a changed count", () => {
  const base = new Map([
    ["src/agentrun/a.ts", 2],
    ["src/b.ts", 1],
  ]);
  assert.deepEqual(
    compareCensus(
      base,
      new Map([
        ["src/run/a.ts", 2],
        ["src/b.ts", 1],
      ]),
      { "src/agentrun/a.ts": "src/run/a.ts" },
    ),
    [],
  );
  assert.deepEqual(
    compareCensus(
      base,
      new Map([
        ["src/run/a.ts", 1],
        ["src/b.ts", 1],
      ]),
      { "src/agentrun/a.ts": "src/run/a.ts" },
    ),
    [{ file: "src/run/a.ts", before: 2, after: 1 }],
  );
  assert.deepEqual(compareCensus(base, new Map([["src/b.ts", 1]]), {}), [
    { file: "src/agentrun/a.ts", before: 2, after: 0 },
  ]);
});

test("git grep reads a ref and the tree, and git's renames pair a moved file", () => {
  const { dir, git } = repo({
    "src/agentrun/a.ts": 'export const q = "agent-execution";\nexport const k = 1;\n',
    "src/b.ts": "none\n",
  });
  try {
    git("mv", "src/agentrun", "src/run");
    writeFileSync(join(dir, "src/b.ts"), 'const again = "agent-execution";\n');
    git("add", "-A");
    const pattern = '"agent-execution"';
    const atBase = gitGrep({ cwd: dir, pattern, ref: "main" });
    assert.deepEqual(atBase, [{ file: "src/agentrun/a.ts", line: 1, text: 'export const q = "agent-execution";' }]);
    const inTree = countByFile(gitGrep({ cwd: dir, pattern }));
    assert.deepEqual([...inTree.entries()].sort(), [
      ["src/b.ts", 1],
      ["src/run/a.ts", 1],
    ]);
    const renames = gitRenames({ cwd: dir, ref: "main" });
    assert.deepEqual(renames, { "src/agentrun/a.ts": "src/run/a.ts" });
    assert.deepEqual(compareCensus(countByFile(atBase), inTree, renames), [{ file: "src/b.ts", before: 0, after: 1 }]);
    assert.deepEqual(gitGrep({ cwd: dir, pattern: "nothing-matches-this" }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
