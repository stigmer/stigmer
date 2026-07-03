import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractRelativeSpecifiers,
  validateSpecifier,
  checkDistDir,
} from "./verify-esm-node.mjs";

test("extractRelativeSpecifiers finds static, re-export, and dynamic relative imports", () => {
  const source = [
    'import { a } from "./a.js";',
    'import b from "../b.js";',
    'export { c } from "./c.js";',
    'export * from "./d.js";',
    'const lazy = () => import("./e.js");',
    'import react from "react";', // bare — excluded
    'import proto from "@stigmer/protos/x_pb.js";', // bare — excluded
    'const s = "from \\"./not-an-import.js\\"";', // string literal — not an import
  ].join("\n");

  const specs = extractRelativeSpecifiers(source);
  assert.deepEqual(
    specs.sort(),
    ["../b.js", "./a.js", "./c.js", "./d.js", "./e.js"].sort(),
  );
});

test("validateSpecifier rejects extension-less relative specifiers", () => {
  const reason = validateSpecifier("/tmp/pkg/dist/index.js", "./foo");
  assert.ok(reason, "expected a failure reason");
  assert.match(reason, /extension-less/);
});

test("validateSpecifier rejects .js specifiers whose target is missing", () => {
  const reason = validateSpecifier("/tmp/pkg/dist/index.js", "./does-not-exist.js");
  assert.ok(reason);
  assert.match(reason, /missing file/);
});

test("validateSpecifier accepts an explicit .js specifier that exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "esm-gate-"));
  try {
    writeFileSync(join(dir, "index.js"), "");
    writeFileSync(join(dir, "foo.js"), "");
    assert.equal(validateSpecifier(join(dir, "index.js"), "./foo.js"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDistDir flags a bad module and passes a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "esm-gate-dist-"));
  try {
    writeFileSync(join(dir, "target.js"), "export const x = 1;\n");
    // clean: explicit .js that exists
    writeFileSync(join(dir, "good.js"), 'export { x } from "./target.js";\n');
    // broken: extension-less relative specifier
    writeFileSync(join(dir, "bad.js"), 'export { x } from "./target";\n');
    // ignored: test files are not consumer-reachable runtime modules
    writeFileSync(join(dir, "ignored.test.js"), 'export { x } from "./target";\n');

    const violations = checkDistDir(dir);
    assert.equal(violations.length, 1, "only bad.js should fail");
    assert.match(violations[0].file, /bad\.js$/);
    assert.equal(violations[0].spec, "./target");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkDistDir skips the __tests__ directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "esm-gate-tests-"));
  try {
    mkdirSync(join(dir, "__tests__"));
    writeFileSync(join(dir, "__tests__", "a.js"), 'import x from "./missing";\n');
    assert.equal(checkDistDir(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
