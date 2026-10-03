// Pins the dev build's npm version: a clean tree names its commit as
// `.g<first 12 characters of HEAD>`, whatever git's own abbreviation length;
// a tree with an uncommitted or untracked file names none; a malformed base,
// stamp or id is refused rather than published; and the entry point the
// lanes call prints the same version and exits 1 on a refusal, and both
// lanes call it rather than restating the rule. A scratch
// repository with `core.abbrev` set to 7 stands in for a checkout git
// abbreviates short.
// Run via `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import { checkoutState, devNpmVersion } from "./dev-version.mjs";

const SCRIPT = new URL("./dev-version.mjs", import.meta.url).pathname;

const SHA = "10c87982a0f1e2d3c4b5a69788796a5b4c3d2e1f";

/** git in the scratch repository only: no caller's GIT_DIR, no signing a global config asks for. */
function git(cwd, ...args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env }).trim();
}

function withScratchRepo(body) {
  const dir = mkdtempSync(join(tmpdir(), "dev-version-"));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "core.abbrev", "7");
    git(dir, "config", "user.email", "test@example.invalid");
    git(dir, "config", "user.name", "test");
    writeFileSync(join(dir, "file"), "x");
    git(dir, "add", "file");
    git(dir, "commit", "-q", "-m", "one");
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("a clean tree's version names the first 12 characters of its commit", () => {
  assert.equal(
    devNpmVersion({ base: "3.41.1", stamp: "20261003120000", sha: SHA, clean: true }),
    "3.41.1-dev.20261003120000.g10c87982a0f1",
  );
});

test("a commit id that starts with a digit still yields an alphanumeric identifier", () => {
  const version = devNpmVersion({ base: "3.41.1", stamp: "20261003120000", sha: "0123456789abcdef0123456789abcdef01234567", clean: true });
  assert.equal(version, "3.41.1-dev.20261003120000.g0123456789ab");
  assert.match(version.split(".").at(-1), /^g[0-9a-f]+$/);
});

test("a dirty tree's version names no commit", () => {
  assert.equal(devNpmVersion({ base: "3.41.1", stamp: "20261003120000", sha: SHA, clean: false }), "3.41.1-dev.20261003120000");
});

test("a malformed base, stamp or commit id is refused with what was expected", () => {
  assert.throws(() => devNpmVersion({ base: "3.41", stamp: "20261003120000", sha: SHA, clean: true }), /base must be X\.Y\.Z, got '3\.41'/);
  assert.throws(() => devNpmVersion({ base: "3.41.1", stamp: "2026100312", sha: SHA, clean: true }), /stamp must be 14 digits/);
  assert.throws(() => devNpmVersion({ base: "3.41.1", stamp: "20261003120000", sha: "10c8798", clean: true }), /sha must be a full 40-character commit id, got '10c8798'/);
});

test("the checkout state reads the full id however short git abbreviates, and sees an untracked file as dirty", () => {
  withScratchRepo((dir) => {
    const full = git(dir, "rev-parse", "HEAD");
    assert.equal(git(dir, "rev-parse", "--short", "HEAD").length, 7, "the scratch repository abbreviates short");
    assert.deepEqual(checkoutState(dir), { sha: full, clean: true });

    writeFileSync(join(dir, "untracked"), "y");
    assert.deepEqual(checkoutState(dir), { sha: full, clean: false });
    rmSync(join(dir, "untracked"));

    writeFileSync(join(dir, "file"), "changed");
    assert.equal(checkoutState(dir).clean, false);
  });
});

test("run as the lanes run it, it prints this checkout's version, and refuses a bad argument on stderr with exit 1", () => {
  const { sha, clean } = checkoutState();
  const printed = execFileSync(process.execPath, [SCRIPT, "--base", "3.41.1", "--stamp", "20261003120000"], { encoding: "utf8" });
  assert.equal(printed, `${devNpmVersion({ base: "3.41.1", stamp: "20261003120000", sha, clean })}\n`);

  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, "--base", "3.41", "--stamp", "20261003120000"], { encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && /dev-version: base must be X\.Y\.Z, got '3\.41'/.test(String(error.stderr)),
  );
  assert.throws(
    () => execFileSync(process.execPath, [SCRIPT, "--stamp", "20261003120000"], { encoding: "utf8", stdio: "pipe" }),
    (error) => error.status === 1 && /base must be X\.Y\.Z, got ''/.test(String(error.stderr)),
  );
});

test("both dev lanes stamp the npm version through this helper, never inline", () => {
  const lanes = {
    ".github/workflows/release.dev.yaml": readFileSync(new URL("../../.github/workflows/release.dev.yaml", import.meta.url), "utf8"),
    "scripts/publish-dev-local.sh": readFileSync(new URL("../publish-dev-local.sh", import.meta.url), "utf8"),
  };
  for (const [lane, text] of Object.entries(lanes)) {
    assert.match(text, /NPM_VERSION="?\$\(node scripts\/lib\/dev-version\.mjs --base "\$BASE" --stamp "\$STAMP"\)"?/, `${lane} calls the helper`);
    assert.doesNotMatch(text, /-dev\.\$\{?STAMP\}?/, `${lane} restates the rule inline`);
  }
});
