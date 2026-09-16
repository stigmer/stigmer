// Tests for the agent-guidance gate in agents-check.mjs.
// Run via `node --test scripts/agents-check.test.mjs` (wired into root `npm test`).
//
// Every case builds a throwaway repository under a temp directory, so the
// suite never depends on this repository's own guidance state. The three
// invariants each get a happy path and the failure the gate exists to catch:
// a shim that drifted or was orphaned, a citation that points at nothing, and
// a private-record id in public prose.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import {
  asPathCitation,
  checkCitations,
  checkLeakage,
  collectGuidanceFiles,
  discoverNestedGuides,
  extractCitedPaths,
  renderShim,
  runGate,
  shimPathFor,
  stripFences,
  syncShims,
} from "./agents-check.mjs";

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), "agents-check-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const GUIDE = "# Runner guide\n\nRead `src/main.ts` first.\n";

test("nested guides are discovered below the root, outside dot-directories and build output", () => {
  const root = repo({
    "AGENTS.md": "# root\n",
    "backend/services/runner/AGENTS.md": GUIDE,
    "backend/services/runner/src/main.ts": "",
    "sdk/react/AGENTS.md": "# sdk\n",
    ".agents/skills/vendored/AGENTS.md": "# a vendored bundle's own guide, not ours\n",
    "node_modules/pkg/AGENTS.md": "# a dependency's guide\n",
    "client-apps/web/dist/AGENTS.md": "# build output\n",
  });
  try {
    assert.deepEqual(discoverNestedGuides(root), ["backend/services/runner/AGENTS.md", "sdk/react/AGENTS.md"]);
    assert.deepEqual(collectGuidanceFiles(root), [
      "AGENTS.md",
      "backend/services/runner/AGENTS.md",
      "sdk/react/AGENTS.md",
      ".agents/skills/vendored/AGENTS.md",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shim path and content are a pure, byte-stable function of the guide path", () => {
  assert.equal(shimPathFor("backend/services/runner/AGENTS.md"), ".cursor/rules/agents-backend-services-runner.mdc");
  const shim = renderShim("backend/services/runner/AGENTS.md");
  assert.match(shim, /^---\ndescription: Package guide for backend\/services\/runner, /);
  assert.match(shim, /\nglobs: backend\/services\/runner\/\*\*\n/);
  assert.match(shim, /\nalwaysApply: false\n---\n/);
  // The @path line is what makes Cursor attach the guide beside the shim.
  assert.match(shim, /\n@backend\/services\/runner\/AGENTS\.md\n$/);
  assert.equal(renderShim("backend/services/runner/AGENTS.md"), shim);
});

test("sync writes missing shims, is idempotent, and check reports drift and orphans", () => {
  const root = repo({
    "backend/services/runner/AGENTS.md": GUIDE,
    "backend/services/runner/src/main.ts": "",
    ".cursor/rules/hand-written-agents-thing.mdc": "---\ndescription: not ours\n---\n",
  });
  try {
    const first = syncShims(root, { write: true });
    assert.deepEqual(first.written, [".cursor/rules/agents-backend-services-runner.mdc"]);
    assert.deepEqual(first.findings, []);

    const second = syncShims(root, { write: true });
    assert.deepEqual(second.written, []);
    assert.deepEqual(second.removed, []);
    assert.deepEqual(syncShims(root, { write: false }).findings, []);

    // Drift: a hand edit to a generated file is reported, not silently kept.
    const shimAbs = join(root, ".cursor/rules/agents-backend-services-runner.mdc");
    writeFileSync(shimAbs, readFileSync(shimAbs, "utf8") + "extra line\n");
    assert.match(syncShims(root, { write: false }).findings[0], /out of date/);
    syncShims(root, { write: true });
    assert.deepEqual(syncShims(root, { write: false }).findings, []);

    // Orphan: the guide is gone, the shim must go too. The hand-written file
    // sharing the prefix is never touched because it lacks the generated marker.
    rmSync(join(root, "backend/services/runner/AGENTS.md"));
    assert.match(syncShims(root, { write: false }).findings[0], /orphan shim/);
    const cleanup = syncShims(root, { write: true });
    assert.deepEqual(cleanup.removed, [".cursor/rules/agents-backend-services-runner.mdc"]);
    assert.equal(existsSync(shimAbs), false);
    assert.equal(existsSync(join(root, ".cursor/rules/hand-written-agents-thing.mdc")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("path citations: what counts, what is normalised, what is ignored", () => {
  assert.equal(asPathCitation("backend/services/runner/src/main.ts"), "backend/services/runner/src/main.ts");
  assert.equal(asPathCitation("sdk/README.md:193"), "sdk/README.md");
  assert.equal(asPathCitation("apis/"), "apis");
  assert.equal(asPathCitation("./scripts/agents-check.mjs."), "./scripts/agents-check.mjs");
  for (const notAPath of [
    "SKILL.md",
    "make check",
    "npm test -w @stigmer/react",
    "@stigmer/protos",
    "https://example.com/x",
    "~/scm/github.com/stigmer",
    "/Users/someone/repo/file.ts",
    "$HOME/x",
    "--sync",
    "<package>/AGENTS.md",
    "src/**/*.ts",
    "node:test",
  ]) {
    assert.equal(asPathCitation(notAPath), null, notAPath);
  }
});

test("citations are extracted from spans and links outside fenced blocks, with line numbers", () => {
  const md = [
    "See `backend/x.ts:12` and [the guide](docs/guide.md).",
    "```bash",
    "cat `not/cited/in/fence.ts`",
    "```",
    "Also `sdk/`.",
  ].join("\n");
  assert.deepEqual(extractCitedPaths(md), [
    { path: "backend/x.ts", line: 1 },
    { path: "docs/guide.md", line: 1 },
    { path: "sdk", line: 5 },
  ]);
  assert.equal(stripFences(md).split("\n").length, md.split("\n").length, "fences are blanked, not removed, so line numbers hold");
});

test("a citation resolves relative to the citing file or the root; anything else is a finding with file and line", () => {
  const root = repo({
    "AGENTS.md": "Start with `backend/services/runner/AGENTS.md` and `scripts/agents-check.mjs`.\n",
    "backend/services/runner/AGENTS.md": "Read `src/main.ts` (relative to this guide) and `apis/` (relative to the root).\n\nBroken: `src/gone.ts`.\n",
    "backend/services/runner/src/main.ts": "",
    "scripts/agents-check.mjs": "",
    "apis/README.md": "",
  });
  try {
    assert.deepEqual(checkCitations(root, collectGuidanceFiles(root)), [
      "backend/services/runner/AGENTS.md:3: cited path does not exist: src/gone.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("private-record identifiers fail public guidance; --private-repo relaxes only the record path", () => {
  const root = repo({
    "AGENTS.md": [
      "Decided in _projects/2026-09/some-record/tasks/T01_0_plan.md.",
      "Ruled at Q-S5-2; see F-M2-23.",
      "DD-006 is defined in this repository and is fine.",
      "T0 alone, or 2026-09-16, or PR #1136, are fine too.",
    ].join("\n"),
  });
  try {
    const publicFindings = checkLeakage(root, ["AGENTS.md"], { privateRepo: false });
    assert.deepEqual(
      publicFindings.map((f) => f.split(": ").slice(1).join(": ")),
      [
        "planning-record path in public guidance: _projects/",
        "task file id in public guidance: T01_0",
        "ruling id in public guidance: Q-S5-2",
        "finding id in public guidance: F-M2-23",
      ],
    );
    const privateFindings = checkLeakage(root, ["AGENTS.md"], { privateRepo: true });
    assert.equal(privateFindings.length, 3);
    assert.ok(privateFindings.every((f) => !f.includes("planning-record path")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runGate composes the three checks and reports green only when all pass", () => {
  const root = repo({
    "AGENTS.md": "Root guide. See `backend/services/runner/AGENTS.md`.\n",
    "backend/services/runner/AGENTS.md": GUIDE,
    "backend/services/runner/src/main.ts": "",
    ".agents/README.md": "How guidance works. Skills live under `.agents/skills/`.\n",
    ".agents/skills/.gitkeep": "",
  });
  try {
    const before = runGate(root, { sync: false });
    assert.equal(before.findings.length, 1, "the missing shim is the one finding");
    const synced = runGate(root, { sync: true });
    assert.deepEqual(synced.findings, []);
    assert.deepEqual(synced.written, [".cursor/rules/agents-backend-services-runner.mdc"]);
    assert.deepEqual(synced.files, ["AGENTS.md", "backend/services/runner/AGENTS.md", ".agents/README.md"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
