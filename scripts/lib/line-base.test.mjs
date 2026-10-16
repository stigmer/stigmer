// Pins the release line's next version: before any stable `vX.Y.Z` tag the
// line starts at 0.1.0 whatever the bump; after one, the next patch by
// default and the asked-for minor or major, counted from the newest tag by
// number, never by text; a prerelease tag or a Go module's path-prefixed tag
// is not a release; a bad bump is refused, on a fresh line too. The entry
// point the callers run prints the same answer for this checkout and exits 1
// on a refusal, a scratch repository stands in for a fresh line and for one
// with releases, and all three callers read the rule from here rather than
// restating it. Run via `node --test scripts/lib/*.test.mjs` (wired into the
// root `npm test`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";

import { LINE_START, newestStableTag, nextLineVersion, releaseTags } from "./line-base.mjs";

const SCRIPT = new URL("./line-base.mjs", import.meta.url).pathname;

/** git in the scratch repository only: no caller's GIT_DIR, no signing a global config asks for. */
function git(cwd, ...args) {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args], { cwd, encoding: "utf8", env }).trim();
}

function withScratchRepo(body) {
  const dir = mkdtempSync(join(tmpdir(), "line-base-"));
  try {
    git(dir, "init", "-q");
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

test("a line with no stable tag starts at 0.1.0, whatever the bump", () => {
  assert.equal(LINE_START, "0.1.0");
  for (const bump of ["patch", "minor", "major"]) {
    assert.equal(nextLineVersion({ tags: [], bump }), "0.1.0", bump);
  }
  assert.equal(nextLineVersion({ tags: [] }), "0.1.0");
  assert.equal(nextLineVersion({ tags: ["v0.1.0-rc.1", "vnext"] }), "0.1.0");
});

test("after a release, the next patch by default and the asked-for minor or major", () => {
  assert.equal(nextLineVersion({ tags: ["v0.1.0"] }), "0.1.1");
  assert.equal(nextLineVersion({ tags: ["v3.41.0"], bump: "patch" }), "3.41.1");
  assert.equal(nextLineVersion({ tags: ["v3.41.0"], bump: "minor" }), "3.42.0");
  assert.equal(nextLineVersion({ tags: ["v3.41.2"], bump: "major" }), "4.0.0");
});

test("the newest stable tag is chosen by number; prereleases and other tags are not releases", () => {
  assert.equal(newestStableTag(["v3.9.9", "v3.10.0", "v3.10.0-rc.1", "v3.11.0-rc.1", "v-latest"]), "v3.10.0");
  assert.equal(newestStableTag([]), undefined);
  assert.equal(nextLineVersion({ tags: ["v3.9.9", "v3.10.0", "v3.11.0-rc.1"] }), "3.10.1");
});

test("a bump outside patch, minor and major is refused, on a fresh line as on an established one", () => {
  assert.throws(() => nextLineVersion({ tags: [], bump: "mnior" }), /invalid bump 'mnior' \(use patch\|minor\|major\)/);
  assert.throws(() => nextLineVersion({ tags: ["v3.41.0"], bump: "" }), /invalid bump ''/);
});

test("a checkout's tags: v* only, so the Go module's sdk/go/v* tags are not read", () => {
  withScratchRepo((dir) => {
    assert.deepEqual(releaseTags(dir), []);
    assert.equal(nextLineVersion({ tags: releaseTags(dir) }), "0.1.0");

    git(dir, "tag", "-a", "sdk/go/v0.1.0", "-m", "go");
    git(dir, "tag", "v0.1.0-rc.1");
    assert.equal(nextLineVersion({ tags: releaseTags(dir) }), "0.1.0");

    git(dir, "tag", "-a", "v0.1.0", "-m", "release");
    assert.equal(nextLineVersion({ tags: releaseTags(dir) }), "0.1.1");
    assert.equal(nextLineVersion({ tags: releaseTags(dir), bump: "minor" }), "0.2.0");
  });
});

test("run as the callers run it, it prints this checkout's answer, and refuses a bad bump on stderr with exit 1", () => {
  const tags = releaseTags();
  const run = (...args) => execFileSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" });
  assert.equal(run(), `${nextLineVersion({ tags })}\n`);
  assert.equal(run("--bump=minor"), `${nextLineVersion({ tags, bump: "minor" })}\n`);
  assert.equal(run("--latest"), `${newestStableTag(tags) ?? ""}\n`);

  assert.throws(
    () => run("--bump=huge"),
    (error) => error.status === 1 && /line-base: invalid bump 'huge' \(use patch\|minor\|major\)/.test(String(error.stderr)),
  );
  assert.throws(() => run("--stray"), (error) => error.status === 1 && /line-base: /.test(String(error.stderr)));
});

test("the two dev lanes and `make release` take the next version from this helper, never inline", () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const callers = {
    ".github/workflows/release.dev.yaml": /BASE=\$\(node scripts\/lib\/line-base\.mjs\)/,
    "scripts/publish-dev-local.sh": /BASE="\$\(node scripts\/lib\/line-base\.mjs\)"/,
    Makefile: /NEW_VERSION=\$\$\(node scripts\/lib\/line-base\.mjs --bump="\$\(bump\)"\)/,
  };
  for (const [caller, call] of Object.entries(callers)) {
    const text = read(caller);
    assert.match(text, call, `${caller} calls the helper`);
    assert.doesNotMatch(text, /git tag -l "v\*" \| sort -V/, `${caller} restates the rule inline`);
    assert.doesNotMatch(text, /v0\.0\.0/, `${caller} keeps the old fallback`);
  }
});
