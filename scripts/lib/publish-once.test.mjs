/**
 * publish-once.test.mjs — the decision that lets a stopped release's npm run
 * be run again (stigmer/stigmer#3168), and the helper's command line.
 */

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

import { isNotFound, parseArgs, publishDecision } from "./publish-once.mjs";

test("publishDecision publishes a version the registry does not have", () => {
  assert.deepEqual(publishDecision(undefined, "sha512-local"), {
    act: "publish",
  });
});

test("publishDecision skips a version the registry has with the same contents, so a stopped release resumes", () => {
  assert.deepEqual(publishDecision("sha512-same", "sha512-same"), {
    act: "skip",
  });
});

test("publishDecision refuses a version the registry has with other contents, naming both", () => {
  const decision = publishDecision("sha512-theirs", "sha512-ours");
  assert.equal(decision.act, "refuse");
  assert.match(decision.reason, /sha512-theirs/);
  assert.match(decision.reason, /sha512-ours/);
});

test("isNotFound reads npm's E404 and nothing else", () => {
  assert.equal(
    isNotFound("npm error code E404\nnpm error 404 Not Found"),
    true,
  );
  assert.equal(isNotFound("npm error code E403"), false);
  assert.equal(isNotFound("npm error code ETIMEDOUT"), false);
});

test("parseArgs reads the directory, the tag and --dry-run in any order", () => {
  assert.deepEqual(parseArgs(["--tag", "latest", "pkgs/a"]), {
    dir: resolve("pkgs/a"),
    tag: "latest",
    dryRun: false,
  });
  assert.deepEqual(parseArgs(["pkgs/a", "--dry-run", "--tag", "next"]), {
    dir: resolve("pkgs/a"),
    tag: "next",
    dryRun: true,
  });
});

test("parseArgs refuses a missing directory or tag", () => {
  assert.throws(() => parseArgs(["--tag", "latest"]), /usage/);
  assert.throws(() => parseArgs(["pkgs/a"]), /usage/);
});
