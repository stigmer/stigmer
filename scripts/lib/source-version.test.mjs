// Pins the from-source version's hash length: 7 characters whatever the
// repository's object count or `core.abbrev`, so two reads of one HEAD in one
// run agree (stigmer#1748: the upgrade rehearsal's build stamped `1f866e8`
// and its check wanted `1f866e89`). A scratch repository with `core.abbrev`
// set to 12 stands in for a checkout whose object count has grown, since
// git's automatic length is that setting's default. Run via
// `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sourceBuildVersion } from "./source-version.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("the version carries a 7-character hash even where git would abbreviate longer", () => {
  const dir = mkdtempSync(join(tmpdir(), "source-version-"));
  try {
    git(dir, "init", "-q");
    git(dir, "config", "core.abbrev", "12");
    git(dir, "config", "user.email", "test@example.invalid");
    git(dir, "config", "user.name", "test");
    writeFileSync(join(dir, "file"), "x");
    git(dir, "add", "file");
    git(dir, "commit", "-q", "-m", "one");
    const full = git(dir, "rev-parse", "HEAD");
    assert.equal(git(dir, "rev-parse", "--short", "HEAD").length, 12, "the scratch repository abbreviates long");
    assert.equal(sourceBuildVersion(dir), `0.0.0-dev.${full.slice(0, 7)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("this checkout's version is the same rule", () => {
  assert.match(sourceBuildVersion(), /^0\.0\.0-dev\.[0-9a-f]{7}$/);
});
