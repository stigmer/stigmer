// A cached test run is only honest if turbo hashes every file the tests read.
// Run via `node --test scripts/turbo-inputs.test.mjs` (wired into root `npm test`).
//
// Turborepo's default inputs for a task are the package's own files. A test
// that reads a fixture from elsewhere in the repo (today: the SDK's HITL
// corpus under apis/testdata and the tool-view fixtures under test/fixtures)
// is invisible to that hash, so editing the fixture would replay a stale pass
// from cache. turbo.json widens `inputs` for the packages that do this; this
// test finds every such read and checks that turbo's resolved input list for
// the package's `test` task contains it.
//
// The scan is lexical: string literals beginning with `../` in the test-side
// files of each package, resolved against the file that holds them. That
// covers import specifiers and `resolve(here, "../…")` arguments alike. A
// path computed at runtime would not be seen; nothing in the repo does that
// today, and the shape (`resolve(here, "<literal>")`) is the one to keep.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PACKAGES } from "./publish-libs.mjs";
import { dryRun } from "./turbo-set.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const TEST_SIDE_FILE =
  /(\.test\.(ts|tsx|mts|mjs|js)$|[\\/]__tests__[\\/]|vitest[^\\/]*\.(config|setup)\.)/;
const RELATIVE_PARENT_LITERAL = /["'`]((?:\.\.\/)+[^"'`\n]*)["'`]/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".turbo"
    )
      continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (TEST_SIDE_FILE.test(path)) out.push(path);
  }
  return out;
}

/**
 * For one package directory: every path its test-side files name that
 * resolves outside the package, as `{ file, target }` pairs with
 * package-relative targets (the shape turbo's `inputs` keys take).
 */
export function outOfPackageReads(pkgDir) {
  const reads = [];
  for (const file of walk(pkgDir)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(RELATIVE_PARENT_LITERAL)) {
      const target = resolve(dirname(file), match[1]);
      if (target.startsWith(pkgDir + sep)) continue;
      reads.push({
        file: relative(root, file),
        target: relative(pkgDir, target).split(sep).join("/"),
      });
    }
  }
  return reads;
}

const plan = dryRun("libs", ["test"]);
const testTasks = new Map(
  plan.tasks.filter((t) => t.task === "test").map((t) => [t.package, t]),
);

test("every out-of-package file a suite reads is in turbo's input hash for that suite", () => {
  const problems = [];
  for (const relDir of PACKAGES) {
    const pkgDir = join(root, relDir);
    const name = JSON.parse(
      readFileSync(join(pkgDir, "package.json"), "utf8"),
    ).name;
    const reads = outOfPackageReads(pkgDir);
    if (reads.length === 0) continue;
    const task = testTasks.get(name);
    assert.ok(
      task,
      `${name} reads outside its package but has no test task in the plan`,
    );
    const hashed = Object.keys(task.inputs);
    for (const { file, target } of reads) {
      const covered = hashed.some(
        (input) => input === target || input.startsWith(`${target}/`),
      );
      if (!covered) {
        problems.push(
          `${file} reads ${target}, which ${name}#test does not hash. ` +
            `Add "$TURBO_ROOT$/<path>/**" to "${name}#test".inputs in turbo.json.`,
        );
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the widened inputs of 2026-09-10 are still needed (drop them from turbo.json when they are not)", () => {
  // The two overrides exist for these reads. If a refactor moves the fixtures
  // into the packages, this test says the overrides can go.
  const sdkReads = outOfPackageReads(join(root, "sdk/typescript")).map(
    (r) => r.target,
  );
  assert.ok(
    sdkReads.some((t) => t.includes("apis/testdata/hitl/file-review")),
    "sdk reads the HITL corpus",
  );
  assert.ok(
    sdkReads.some((t) => t.includes("test/fixtures/tool-view")),
    "sdk reads the tool-view fixtures",
  );
  const reactReads = outOfPackageReads(join(root, "sdk/react")).map(
    (r) => r.target,
  );
  assert.ok(
    reactReads.some((t) => t.includes("test/fixtures/tool-view")),
    "react reads the tool-view fixtures",
  );
});
