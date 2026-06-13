// Tests for the dist/package.json generation in publish-libs.mjs.
// Run via `node --test scripts/publish-libs.test.mjs` (wired into root `npm test`).
//
// The regression this guards: publish-libs.mjs once dropped the `bin` field,
// which would silently break the `mcp-server-stigmer` executable that `npx`
// (and the patched CLI launcher) rely on.

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { generateDistPackageJson, rewriteBinPaths } from "./publish-libs.mjs";

test("rewriteBinPaths rewrites the dist prefix for the object form", () => {
  const out = rewriteBinPaths({
    "mcp-server-stigmer": "./dist/cli/mcp-server-stigmer.js",
  });
  assert.deepEqual(out, {
    "mcp-server-stigmer": "./cli/mcp-server-stigmer.js",
  });
});

test("rewriteBinPaths rewrites the dist prefix for the string form", () => {
  assert.equal(rewriteBinPaths("./dist/cli/run.js"), "./cli/run.js");
});

test("generateDistPackageJson carries bin and pins workspace deps", () => {
  const pkgDir = mkdtempSync(join(tmpdir(), "publish-libs-test-"));
  try {
    mkdirSync(join(pkgDir, "dist"));
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@stigmer/mcp-server",
        license: "Apache-2.0",
        type: "module",
        engines: { node: ">=20" },
        dependencies: { "@stigmer/protos": "*", "@stigmer/sdk": "*", zod: "^3.25.0" },
        publishConfig: {
          main: "./dist/index.js",
          types: "./dist/index.d.ts",
          bin: { "mcp-server-stigmer": "./dist/cli/mcp-server-stigmer.js" },
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        },
      }),
    );

    const distPath = generateDistPackageJson(pkgDir, "1.2.3");
    const dist = JSON.parse(readFileSync(distPath, "utf8"));

    assert.deepEqual(dist.bin, { "mcp-server-stigmer": "./cli/mcp-server-stigmer.js" });
    assert.equal(dist.main, "./index.js");
    assert.equal(dist.types, "./index.d.ts");
    assert.equal(dist.version, "1.2.3");
    // Workspace deps pinned to the lockstep version; third-party untouched.
    assert.equal(dist.dependencies["@stigmer/protos"], "1.2.3");
    assert.equal(dist.dependencies["@stigmer/sdk"], "1.2.3");
    assert.equal(dist.dependencies.zod, "^3.25.0");
  } finally {
    rmSync(pkgDir, { recursive: true, force: true });
  }
});
