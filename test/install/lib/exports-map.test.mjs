// Tests for test/install/lib/exports-map.mjs: an exports map's entries under
// every condition (string, array, nested conditions, a null target), a plain
// target matched exactly, a subpath pattern matched as a whole (one `*`, and
// several standing for the same text), and the subpath a consumer imports to
// reach a file a pattern covers.
// Run via `node --test test/install/lib/exports-map.test.mjs` (root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import { exportEntries, matchTarget, patternMatch, subpathFor } from "./exports-map.mjs";

test("lists every entry with every path it names, under every condition", () => {
  assert.deepEqual(exportEntries("./dist/index.js"), [{ key: ".", targets: ["./dist/index.js"] }]);
  assert.deepEqual(exportEntries(["./a.js", "./b.js"]), [{ key: ".", targets: ["./a.js", "./b.js"] }]);
  assert.deepEqual(
    exportEntries({
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./test": { node: { import: "./dist/test/index.js" }, default: "./dist/test/index.js" },
      "./internal": null,
    }),
    [
      { key: ".", targets: ["./dist/index.d.ts", "./dist/index.js"] },
      { key: "./test", targets: ["./dist/test/index.js"] },
      { key: "./internal", targets: [] },
    ],
  );
  assert.deepEqual(exportEntries(undefined), []);
});

const SHIPPED = ["dist/index.js", "dist/icons/a.js", "dist/icons/b.js", "dist/icons/b/b.svg", "dist/icons/.js"];

test("matches a plain target exactly and a pattern as a whole", () => {
  assert.deepEqual(matchTarget("./dist/index.js", SHIPPED), ["dist/index.js"]);
  assert.deepEqual(matchTarget("./dist/missing.js", SHIPPED), []);
  assert.deepEqual(matchTarget("./dist/icons/*.js", SHIPPED), ["dist/icons/a.js", "dist/icons/b.js"]);
  assert.deepEqual(matchTarget("./dist/icons/*/*.svg", SHIPPED), ["dist/icons/b/b.svg"], "every * is the same text");
  assert.deepEqual(matchTarget("./dist/(x)/*.js", ["dist/(x)/y.js", "dist/x/y.js"]), ["dist/(x)/y.js"], "the rest is literal");
});

test("says what a pattern's * stands for, and the subpath that reaches the file", () => {
  assert.equal(patternMatch("./dist/icons/*.js", "dist/icons/a.js"), "a");
  assert.equal(patternMatch("./dist/icons/*/*.svg", "dist/icons/b/c.svg"), undefined);
  assert.equal(patternMatch("./dist/index.js", "dist/index.js"), undefined, "a plain target is not a pattern");
  assert.equal(subpathFor("./icons/*", "./dist/icons/*.js", "dist/icons/a.js"), "./icons/a");
  assert.equal(subpathFor("./icons/*", "./dist/icons/*.js", "dist/other.js"), undefined);
});
