// Tests for scripts/turbo-set.mjs: the named package sets the root scripts
// run turbo over, and the flags each set carries.
// Run via `node --test scripts/turbo-set.test.mjs` (wired into root `npm test`).
//
// What these guard: the sets are derived (from publish-libs.mjs's PACKAGES and
// from the runner-linked manifests), so a drift between "what publishes" and
// "what build:libs builds", or between "what the runner links" and "what
// build:runner-deps builds", must show up here rather than in a release lane.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PACKAGES } from "./publish-libs.mjs";
import {
  RUNNER_LINKED_MANIFESTS,
  SETS,
  libsSet,
  resolveSet,
  runnerLinkedSet,
  turboArgs,
  turboEnv,
} from "./turbo-set.mjs";

function scratchRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), "turbo-set-test-"));
  for (const [relPath, json] of Object.entries(files)) {
    mkdirSync(join(dir, relPath, ".."), { recursive: true });
    writeFileSync(join(dir, relPath), JSON.stringify(json));
  }
  return dir;
}

test("libs set is the package name of every PACKAGES entry, in publish order", () => {
  const names = libsSet();
  assert.equal(
    names.length,
    PACKAGES.length,
    "one name per publishable package",
  );
  assert.ok(
    names.every((n) => n.startsWith("@stigmer/")),
    `every publishable package is scoped, got ${names.join(", ")}`,
  );
  assert.equal(
    names[0],
    "@stigmer/protos",
    "protos publishes first, so it builds first",
  );
  assert.equal(
    names.at(-1),
    "@stigmer/cli",
    "the CLI depends on the rest and comes last",
  );
  assert.equal(new Set(names).size, names.length, "no duplicate names");
});

test("runner-deps set is the union of the runner's and the server's file:-linked @stigmer libs", () => {
  const dir = scratchRepo({
    "backend/services/runner/package.json": {
      dependencies: {
        "@stigmer/protos": "file:../../../apis/stubs/ts",
        "@stigmer/zip-structure": "file:../../libs/ts/zip-structure",
        "@temporalio/worker": "^1.0.0", // not ours
        "@stigmer/sdk": "^0.5.0", // ours, but from the registry: not a link
      },
      devDependencies: {
        "@stigmer/react": "file:../../../sdk/react", // dev-only: not what a release stamps
      },
    },
    "backend/services/stigmer-server/package.json": {
      dependencies: {
        "@stigmer/protos": "file:../../../apis/stubs/ts",
        "@stigmer/temporal-codecs": "file:../../libs/ts/temporal-codecs",
      },
    },
  });
  try {
    assert.deepEqual(runnerLinkedSet(dir), [
      "@stigmer/protos",
      "@stigmer/temporal-codecs",
      "@stigmer/zip-structure",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runner-deps set in this repo names the libs both standalone packages link today", () => {
  // The two manifests are the truth; this pins what they say so a link added
  // to one of them shows up as a deliberate change to this expectation.
  assert.deepEqual(RUNNER_LINKED_MANIFESTS, [
    "backend/services/runner/package.json",
    "backend/services/stigmer-server/package.json",
  ]);
  assert.deepEqual(runnerLinkedSet(), [
    "@stigmer/protos",
    "@stigmer/temporal-codecs",
    "@stigmer/zip-structure",
  ]);
  // Every runner-linked lib must also publish, or a released runner could not
  // resolve it.
  for (const name of runnerLinkedSet()) {
    assert.ok(
      libsSet().includes(name),
      `${name} is linked by the runner but not in PACKAGES`,
    );
  }
});

test("resolveSet refuses an unknown set and names the known ones", () => {
  assert.throws(
    () => resolveSet("nope"),
    /unknown set "nope".*Known sets: libs, runner-deps/,
  );
  assert.deepEqual(Object.keys(SETS), ["libs", "runner-deps"]);
});

test("turboArgs: task first, one --filter per package, caller flags last", () => {
  const args = turboArgs("runner-deps", "build", ["--force"]);
  assert.deepEqual(args, [
    "run",
    "build",
    "--filter=@stigmer/protos",
    "--filter=@stigmer/temporal-codecs",
    "--filter=@stigmer/zip-structure",
    "--force",
  ]);
});

test("turboArgs: only `libs test` is serialized", () => {
  assert.ok(
    turboArgs("libs", "test").includes("--concurrency=1"),
    "libs test is serial",
  );
  assert.ok(
    !turboArgs("libs", "build").includes("--concurrency=1"),
    "libs build is parallel",
  );
  assert.ok(!turboArgs("runner-deps", "build").includes("--concurrency=1"));
});

test("turboArgs refuses a missing task or a flag in the task position", () => {
  assert.throws(() => turboArgs("libs", undefined), /usage/);
  assert.throws(() => turboArgs("libs", "--dry-run"), /usage/);
});

test("turboEnv switches telemetry off and leaves the rest of the environment alone", () => {
  const env = turboEnv({ PATH: "/usr/bin", TURBO_TELEMETRY_DISABLED: "0" });
  assert.equal(
    env.TURBO_TELEMETRY_DISABLED,
    "1",
    "the repo policy wins over an ambient value",
  );
  assert.equal(env.PATH, "/usr/bin");
});
