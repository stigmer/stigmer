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
//
// @stigmer/react runs two suites from one package: `test` (happy-dom) and
// `test:a11y` (Chromium; sdk/react/vitest.a11y.config.ts collects the
// *.a11y|layout|browser.test.* files and the default config excludes the same
// globs). A read is checked against the task that actually runs the file that
// holds it, so a fixture a browser test starts reading is demanded of
// `test:a11y`'s inputs, not hidden behind `test`'s.

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

// The browser suite's files: the collection globs sdk/react/vitest.a11y.config.ts
// declares, and that config itself. A test-side file matching runs under
// `test:a11y`; every other test-side file runs under `test`.
const BROWSER_SUITE_FILE =
  /(\.(a11y|layout|browser)\.test\.tsx?|vitest\.a11y\.config\.[cm]?[jt]s)$/;

/** The turbo task that runs a given test-side file of a package. */
export function suiteTaskFor(file) {
  return BROWSER_SUITE_FILE.test(file) ? "test:a11y" : "test";
}

const plan = dryRun("libs", ["test", "test:a11y"]);
const tasksById = new Map(plan.tasks.map((t) => [t.taskId, t]));

test("every out-of-package file a suite reads is in turbo's input hash for that suite", () => {
  const problems = [];
  for (const relDir of PACKAGES) {
    const pkgDir = join(root, relDir);
    const name = JSON.parse(
      readFileSync(join(pkgDir, "package.json"), "utf8"),
    ).name;
    for (const { file, target } of outOfPackageReads(pkgDir)) {
      const taskName = suiteTaskFor(file);
      const task = tasksById.get(`${name}#${taskName}`);
      assert.ok(
        task,
        `${file} reads outside its package but ${name}#${taskName} is not in the plan`,
      );
      const hashed = Object.keys(task.inputs);
      const covered = hashed.some(
        (input) => input === target || input.startsWith(`${target}/`),
      );
      if (!covered) {
        problems.push(
          `${file} reads ${target}, which ${name}#${taskName} does not hash. ` +
            `Add "$TURBO_ROOT$/<path>/**" to "${name}#${taskName}".inputs in turbo.json.`,
        );
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the browser suite is scheduled for react alone and waits on react's own build", () => {
  const a11y = [...tasksById.values()].filter((t) => t.task === "test:a11y");
  assert.deepEqual(
    a11y.map((t) => t.package),
    ["@stigmer/react"],
    "only sdk/react declares a test:a11y script",
  );
  assert.ok(
    a11y[0].dependencies.includes("@stigmer/react#build"),
    "the suite imports dist/styles.css, react's build output",
  );
});

test("suiteTaskFor sends browser-mode files to test:a11y and the rest to test", () => {
  assert.equal(suiteTaskFor("src/__tests__/x.layout.test.tsx"), "test:a11y");
  assert.equal(
    suiteTaskFor("src/a/__tests__/a11y/y.a11y.test.tsx"),
    "test:a11y",
  );
  assert.equal(suiteTaskFor("src/z.browser.test.ts"), "test:a11y");
  assert.equal(suiteTaskFor("vitest.a11y.config.ts"), "test:a11y");
  assert.equal(suiteTaskFor("src/__tests__/intent-title.test.tsx"), "test");
  assert.equal(suiteTaskFor("vitest.config.ts"), "test");
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
