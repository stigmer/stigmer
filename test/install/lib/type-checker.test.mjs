// Tests for test/install/lib/type-checker.mjs: where an install smoke's
// TypeScript compiler comes from.
// Run via `node --test test/install/lib/type-checker.test.mjs` (wired into root `npm test`).
//
// What these pin: from a checkout with its install, the workspace's `tsc`
// and `@types`, with nothing installed; in the published mode, the
// lockfile's own versions of the compiler and the Node types installed into
// a tools folder beside the reader's, never into it; and that a package the
// lockfile does not pin is refused rather than taken from the registry.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { lockedSpec, typeChecker } from "./type-checker.mjs";

/** A checkout holding only a root lockfile that pins `pins`. */
function checkout(pins) {
  const root = mkdtempSync(join(tmpdir(), "type-checker-"));
  const packages = Object.fromEntries(Object.entries(pins).map(([name, version]) => [`node_modules/${name}`, { version }]));
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } }));
  return root;
}

test("a checkout with its install uses the workspace's compiler and types, installing nothing", async () => {
  const runs = [];
  const checker = await typeChecker({ repoRoot: "/repo", published: false, scratch: "/scratch", run: async (...args) => runs.push(args) });
  assert.deepEqual(checker, { tsc: "/repo/node_modules/.bin/tsc", typeRoots: "/repo/node_modules/@types" });
  assert.deepEqual(runs, []);
});

test("the published mode installs the locked compiler and Node types beside the reader's folder", async () => {
  const root = checkout({ typescript: "5.9.3", "@types/node": "22.19.1" });
  const scratch = mkdtempSync(join(tmpdir(), "type-checker-scratch-"));
  try {
    const runs = [];
    const checker = await typeChecker({ repoRoot: root, published: true, scratch, run: async (command, cwd) => runs.push({ command, cwd }) });
    const tools = join(scratch, "tools");
    assert.deepEqual(runs, [{ command: `npm install --no-save --prefix ${tools} typescript@5.9.3 @types/node@22.19.1`, cwd: scratch }]);
    assert.deepEqual(checker, { tsc: join(tools, "node_modules", ".bin", "tsc"), typeRoots: join(tools, "node_modules", "@types") });
    assert.ok(existsSync(tools), "the tools folder is made before the install");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("lockedSpec names the lockfile's version and refuses a package it does not pin", () => {
  const root = checkout({ "@types/react": "19.2.2" });
  try {
    assert.equal(lockedSpec(root, "@types/react"), "@types/react@19.2.2");
    assert.throws(() => lockedSpec(root, "typescript"), /package-lock\.json pins no typescript/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
