// The attach entry's module rule refuses the runner and allows the waiter.
// Run via `node --test scripts/attach-graph-rule.test.mjs` (wired into root `npm test`).
//
// backend/services/runner/scripts/attach-graph-rule.mjs is applied to two
// shapes of the attach entry: the compiled dist's module URLs
// (verify-attach-boot.mjs) and the slim bundle's esbuild inputs, paths
// relative to the runner package (bundle-slim.mjs). A pattern edit that
// stopped matching one shape would disarm that check silently, because each
// check only fails when the rule finds something. So both shapes are pinned
// here, the refused modules and the allowed ones.

import assert from "node:assert/strict";
import { test } from "node:test";

import { forbiddenAttachModules } from "../backend/services/runner/scripts/attach-graph-rule.mjs";

const ROOT = "file:///repo/backend/services/runner";

test("the runner's own modules and @temporalio are refused in both shapes", () => {
  const refused = [
    "dist/main.js",
    "dist/runner.js",
    "dist/runner-manager.js",
    "dist/worker.js",
    "dist/harness/run-turn.js",
    "dist/activities/execute-cursor/index.js",
    "node_modules/@temporalio/common/lib/errors.js",
    "../../../node_modules/@temporalio/worker/lib/index.js",
  ];
  const urls = refused
    .filter((p) => p.startsWith("dist/"))
    .map((p) => `${ROOT}/${p}`);
  assert.deepEqual(forbiddenAttachModules(refused), refused);
  assert.deepEqual(forbiddenAttachModules(urls), urls);
  assert.deepEqual(forbiddenAttachModules(["dist\\worker.js"]), [
    "dist\\worker.js",
  ]);
});

test("the waiter's own modules are allowed in both shapes", () => {
  const allowed = [
    "dist/attach/main.js",
    "dist/attach/entry.js",
    "dist/attach/waiter.js",
    "dist/attach/push.js",
    "dist/shared/runner-credential-keys.js",
    "dist/client/token-claims.js",
    "../../libs/ts/temporal-codecs/dist/connection.js",
    "node:http",
  ];
  assert.deepEqual(forbiddenAttachModules(allowed), []);
  assert.deepEqual(
    forbiddenAttachModules(allowed.map((p) => `${ROOT}/${p}`)),
    [],
  );
});
