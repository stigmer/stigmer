// Tests for scripts/live-release.mjs: which commits the live workflow may run
// with the provider keys. Run via `node --test scripts/live-release.test.mjs`
// (wired into root `npm test`).
//
// What these guard: the keys are main's, so a commit main does not carry
// (compare `ahead` or `diverged`) is refused whatever tag points at it; a
// release tag names the CLI version installed; a prerelease tag is skipped,
// not failed, so it files no false live-failure issue; and the command line
// exits 0, 3 or 1 with the version on stdout or the reason on stderr.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { admitLiveRun } from "./live-release.mjs";

const SCRIPT = fileURLToPath(new URL("./live-release.mjs", import.meta.url));

test("a release tag on main runs, with its version", () => {
  assert.deepEqual(admitLiveRun({ tag: "v3.42.0", compareStatus: "identical" }), { action: "run", version: "3.42.0" });
  assert.deepEqual(admitLiveRun({ tag: "v3.41.0", compareStatus: "behind" }), { action: "run", version: "3.41.0" });
});

test("a commit main does not carry is refused, whatever the tag", () => {
  for (const compareStatus of ["ahead", "diverged", "", "unknown"]) {
    const decision = admitLiveRun({ tag: "v3.42.0", compareStatus });
    assert.equal(decision.action, "refuse", compareStatus);
    assert.match(decision.reason, /not on main/);
  }
});

test("a prerelease tag is skipped, not refused", () => {
  const decision = admitLiveRun({ tag: "v3.42.0-rc.1", compareStatus: "ahead" });
  assert.equal(decision.action, "skip");
  assert.match(decision.reason, /prerelease/);
});

test("anything else is not a release tag", () => {
  for (const tag of ["", "3.42.0", "v3.42", "sdk/go/v3.42.0", "v3.42.0;rm -rf /", "main"]) {
    assert.equal(admitLiveRun({ tag, compareStatus: "identical" }).action, "refuse", tag);
  }
});

test("the command line: the version on stdout and exit 0, a skip exits 3, a refusal exits 1", () => {
  assert.equal(execFileSync("node", [SCRIPT, "--tag", "v3.42.0", "--compare", "behind"], { encoding: "utf-8" }).trim(), "version=3.42.0");
  for (const [args, code] of [
    [["--tag", "v3.42.0-rc.1", "--compare", "identical"], 3],
    [["--tag", "v3.42.0", "--compare", "ahead"], 1],
    [["--bogus"], 1],
  ]) {
    assert.throws(() => execFileSync("node", [SCRIPT, ...args], { stdio: "pipe" }), (error) => error.status === code, args.join(" "));
  }
});
