// Tests for the worktree guidance hook in agents-context-hook.mjs.
// Run via `node --test scripts/agents-context-hook.test.mjs` (wired into root `npm test`).
//
// Every case builds a throwaway primary checkout and a worktree of it under a
// temp directory, linking the two with the one-line `.git` file git itself
// writes (`gitdir: <primary>/.git/worktrees/<name>`), so no git binary runs
// and the suite never depends on this repository's own checkouts. The cases
// cover each branch the hook can take and the one it must never take: serving
// a path that a workspace folder already owns.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { matchesGlob } from "./agents-check.mjs";
import {
  canonical,
  guidesFor,
  isInside,
  planInjection,
  renderContext,
  resolveCheckout,
  skillsFor,
  stateFor,
} from "./agents-context-hook.mjs";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "agents-context-hook.mjs");

const ROOT_GUIDE = "# root\n\nThe root guide, already loaded from the primary.\n";
const RUNNER_GUIDE = "# Agent guide: backend/services/runner\n\nRead `src/main.ts` first.\n";
const BACKEND_GUIDE = "# Agent guide: backend\n\nBackend-wide laws.\n";
const RUNNER_SKILL =
  "---\nname: runner-dev-guidelines\ndescription: Runner doctrine.\npaths:\n  - backend/services/runner/**\n---\n\n# Runner\n";
const ACTION_SKILL =
  "---\nname: commit-changes\ndescription: Commits.\ndisable-model-invocation: true\n---\n\n# Commit\n";

function write(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
}

/** A primary checkout (`.git` directory) and a worktree of it (`.git` link file), both carrying the same guidance tree. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "agents-context-hook-"));
  const primary = join(base, "repo");
  const worktree = join(base, ".worktrees", "repo", "feat-x");
  const guidance = {
    "AGENTS.md": ROOT_GUIDE,
    "backend/AGENTS.md": BACKEND_GUIDE,
    "backend/services/runner/AGENTS.md": RUNNER_GUIDE,
    "backend/services/runner/src/main.ts": "",
    "backend/services/runner/node_modules/dep/AGENTS.md": "# a dependency's guide\n",
    "backend/services/runner/node_modules/dep/index.js": "",
    "sdk/react/src/index.ts": "",
    ".agents/skills/runner-dev-guidelines/SKILL.md": RUNNER_SKILL,
    ".agents/skills/commit-changes/SKILL.md": ACTION_SKILL,
  };
  write(primary, guidance);
  mkdirSync(join(primary, ".git", "worktrees", "feat-x"), { recursive: true });
  write(worktree, guidance);
  writeFileSync(join(worktree, ".git"), `gitdir: ${join(primary, ".git", "worktrees", "feat-x")}\n`);
  const stateDir = join(base, "state");
  return {
    base,
    primary,
    worktree,
    stateDir,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

function payload(filePath, { roots = [], conversation = "conv-1" } = {}) {
  return {
    tool_name: "Read",
    tool_input: { file_path: filePath },
    workspace_roots: roots,
    conversation_id: conversation,
  };
}

test("canonical resolves the nearest existing ancestor and keeps the rest, so a deleted file still compares", () => {
  const f = fixture();
  try {
    const real = canonical(f.worktree);
    assert.equal(canonical(join(f.worktree, "backend/gone/away.ts")), join(real, "backend/gone/away.ts"));
  } finally {
    f.cleanup();
  }
});

test("isInside is segment-aware: a sibling that shares a prefix string is outside", () => {
  assert.equal(isInside("/a/b/c.ts", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/bc/c.ts", "/a/b"), false);
  assert.equal(isInside("/a/c.ts", "/a/b"), false);
});

test("resolveCheckout tells a primary, a worktree with its primary, another link, and no checkout apart", () => {
  const f = fixture();
  try {
    assert.deepEqual(resolveCheckout(join(f.primary, "backend/services/runner/src/main.ts")), {
      kind: "primary",
      root: canonical(f.primary),
    });
    assert.deepEqual(resolveCheckout(join(f.worktree, "backend/services/runner/src/main.ts")), {
      kind: "worktree",
      root: canonical(f.worktree),
      primary: canonical(f.primary),
    });
    const sub = join(f.base, "sub");
    write(sub, { ".git": "gitdir: ../repo/.git/modules/sub\n", "x.ts": "" });
    assert.equal(resolveCheckout(join(sub, "x.ts")).kind, "other");
    assert.equal(resolveCheckout(join(f.base, "loose.ts")), null);
  } finally {
    f.cleanup();
  }
});

test("guidesFor returns the chain outermost first, skips the root guide, and stops at a directory the gate skips", () => {
  const f = fixture();
  try {
    assert.deepEqual(guidesFor(f.worktree, "backend/services/runner/src/main.ts"), [
      "backend/AGENTS.md",
      "backend/services/runner/AGENTS.md",
    ]);
    assert.deepEqual(guidesFor(f.worktree, "backend/services/runner/node_modules/dep/index.js"), [
      "backend/AGENTS.md",
      "backend/services/runner/AGENTS.md",
    ]);
    assert.deepEqual(guidesFor(f.worktree, "sdk/react/src/index.ts"), []);
    assert.deepEqual(guidesFor(f.worktree, "README.md"), []);
  } finally {
    f.cleanup();
  }
});

test("skillsFor offers only the skills whose paths match; an action skill without paths is never offered", () => {
  const f = fixture();
  try {
    assert.deepEqual(skillsFor(f.worktree, "backend/services/runner/src/main.ts"), [
      ".agents/skills/runner-dev-guidelines/SKILL.md",
    ]);
    assert.deepEqual(skillsFor(f.worktree, "sdk/react/src/index.ts"), []);
  } finally {
    f.cleanup();
  }
});

test("matchesGlob implements **, * and ? over segments and rejects syntax the hook cannot read", () => {
  assert.equal(matchesGlob("backend/services/runner/**", "backend/services/runner/src/main.ts"), true);
  assert.equal(matchesGlob("backend/services/runner/**", "backend/services/runner-v2/src/main.ts"), false);
  assert.equal(matchesGlob("**/*.test.ts", "a/b/c.test.ts"), true);
  assert.equal(matchesGlob("**/*.test.ts", "c.test.ts"), true);
  assert.equal(matchesGlob("a/**/b", "a/b"), true);
  assert.equal(matchesGlob("a/**/b", "a/x/y/b"), true);
  assert.equal(matchesGlob("a/**/b", "ab"), false);
  assert.equal(matchesGlob("*.ts", "x.ts"), true);
  assert.equal(matchesGlob("*.ts", "d/x.ts"), false);
  assert.equal(matchesGlob("src/?.ts", "src/a.ts"), true);
  assert.equal(matchesGlob("src/?.ts", "src/ab.ts"), false);
  assert.equal(matchesGlob("src/a.ts", "src/a+ts"), false);
  assert.equal(matchesGlob("{a,b}/**", "a/x"), false);
});

test("planInjection: a worktree path gets the guide chain and the scoped skill once, then nothing more", () => {
  const f = fixture();
  try {
    const opts = { projectRoot: f.primary, stateDir: f.stateDir };
    const first = planInjection(payload(join(f.worktree, "backend/services/runner/src/main.ts")), opts);
    assert.equal(first.reason, "injected");
    assert.match(first.context, /^Package guidance for the git worktree at .*feat-x, which is outside the window/);
    assert.match(first.context, /--- backend\/AGENTS\.md ---\n# Agent guide: backend/);
    assert.match(
      first.context,
      /--- backend\/services\/runner\/AGENTS\.md ---\n# Agent guide: backend\/services\/runner/,
    );
    assert.match(
      first.context,
      /Skills scoped to this path; read before working here: \.agents\/skills\/runner-dev-guidelines\/SKILL\.md\n$/,
    );
    assert.doesNotMatch(first.context, /already loaded from the primary/, "the root guide is never injected");

    const again = planInjection(payload(join(f.worktree, "backend/services/runner/src/other.ts")), opts);
    assert.equal(again.context, null);
    assert.equal(again.reason, "already injected in this conversation");

    // Another conversation starts from nothing.
    const other = planInjection(
      payload(join(f.worktree, "backend/services/runner/src/main.ts"), {
        conversation: "conv-2",
      }),
      opts,
    );
    assert.equal(other.reason, "injected");

    // A touch one level up adds nothing new: backend/AGENTS.md is already known to conv-1.
    const up = planInjection(payload(join(f.worktree, "backend/other.ts")), opts);
    assert.equal(up.reason, "already injected in this conversation");
  } finally {
    f.cleanup();
  }
});

test("planInjection: every branch that must do nothing says why", () => {
  const f = fixture();
  try {
    const opts = { projectRoot: f.primary, stateDir: f.stateDir };
    const target = join(f.worktree, "backend/services/runner/src/main.ts");

    assert.equal(
      planInjection({ tool_name: "Shell", tool_input: { command: "ls" } }, opts).reason,
      "no tool_input.file_path",
    );
    assert.equal(planInjection(null, opts).reason, "no tool_input.file_path");

    // Inside a workspace folder: the shims own it, even when it is a worktree.
    assert.match(planInjection(payload(target, { roots: [f.worktree] }), opts).reason, /inside a workspace folder/);
    // A sibling folder sharing a prefix does not count as containing it.
    assert.equal(planInjection(payload(target, { roots: [`${f.worktree}-other`] }), opts).reason, "injected");

    assert.match(
      planInjection(
        payload(join(f.primary, "backend/services/runner/src/main.ts"), {
          conversation: "c3",
        }),
        opts,
      ).reason,
      /a primary checkout, not a worktree/,
    );
    assert.equal(
      planInjection(payload(join(f.base, "loose.ts"), { conversation: "c3" }), opts).reason,
      "not inside any git checkout",
    );

    // A worktree of some other repository is not this hook's to serve.
    const elsewhere = join(f.base, "elsewhere");
    mkdirSync(join(elsewhere, ".git"), { recursive: true });
    assert.match(
      planInjection(payload(target, { conversation: "c4" }), {
        projectRoot: elsewhere,
        stateDir: f.stateDir,
      }).reason,
      /a worktree of .*, not of this repository/,
    );

    assert.equal(
      planInjection(
        payload(join(f.worktree, "sdk/react/src/index.ts"), {
          conversation: "c5",
        }),
        opts,
      ).reason,
      "no package guide or scoped skill binds this path",
    );
  } finally {
    f.cleanup();
  }
});

test("state files are per conversation and swept after a day", () => {
  const f = fixture();
  try {
    const now = Date.now();
    const s = stateFor(f.stateDir, "conv/with:odd chars", now);
    s.add(["k1"]);
    assert.equal(stateFor(f.stateDir, "conv/with:odd chars", now).has("k1"), true);
    assert.equal(stateFor(f.stateDir, "another", now).has("k1"), false);
    const stale = join(f.stateDir, "stale.json");
    writeFileSync(stale, "[]");
    const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
    utimesSync(stale, twoDaysAgo, twoDaysAgo);
    stateFor(f.stateDir, "sweeper", now);
    assert.equal(existsSync(stale), false);
  } finally {
    f.cleanup();
  }
});

test("renderContext carries provenance, each guide under its heading, and the skills by path", () => {
  const f = fixture();
  try {
    const text = renderContext(f.worktree, ["backend/AGENTS.md"], [".agents/skills/runner-dev-guidelines/SKILL.md"]);
    assert.equal(
      text.split("\n")[0],
      `Package guidance for the git worktree at ${f.worktree}, which is outside the window; attached by scripts/agents-context-hook.mjs on the first touch of a file under each package.`,
    );
    assert.match(text, /\n--- backend\/AGENTS\.md ---\n# Agent guide: backend\n\nBackend-wide laws\.\n/);
    assert.equal(renderContext(f.worktree, ["backend/AGENTS.md"], []).includes("Skills scoped"), false);
  } finally {
    f.cleanup();
  }
});

test("the executable never fails closed: malformed stdin and an unrelated payload both yield {} with exit 0", () => {
  for (const input of ["not json", "", '{"tool_name":"Read","tool_input":{"file_path":"/nowhere/at/all.ts"}}']) {
    const out = execFileSync(process.execPath, [HOOK], {
      input,
      encoding: "utf8",
    });
    assert.equal(out, "{}");
  }
});

test("--explain reports the resolution of a path without a payload", () => {
  const f = fixture();
  try {
    const out = execFileSync(
      process.execPath,
      [HOOK, "--explain", join(f.worktree, "backend/services/runner/src/main.ts")],
      { encoding: "utf8" },
    );
    assert.match(out, /^path {8}/m);
    assert.match(out, /^checkout {4}worktree at .*feat-x \(primary .*repo\)/m);
    // The script's own project is this repository, so the fixture's worktree is another repository's.
    assert.match(out, /^serves {6}no, a worktree of another repository/m);
    assert.match(out, /^guides {6}backend\/AGENTS\.md, backend\/services\/runner\/AGENTS\.md/m);
    assert.match(out, /^skills {6}\.agents\/skills\/runner-dev-guidelines\/SKILL\.md/m);
  } finally {
    f.cleanup();
  }
});
