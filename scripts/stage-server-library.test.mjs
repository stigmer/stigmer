// Tests for the pure parts of stage-server-library.mjs.
// Run via `node --test scripts/stage-server-library.test.mjs` (wired into root `npm test`).
//
// What these guard: a consumer installs the staged set in one `npm install`
// and trusts it to replace every @stigmer/* package the server brings. So
// the set must be complete (every lib the server links, with everything
// those libs depend on), the version must be one npm accepts and never a
// registry version, and a repeat stage must not reuse a version. The pack
// itself runs npm and is proven by running the script, not here.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { packageClosure } from "./publish-libs.mjs";
import {
  linkedLibs,
  localVersion,
  parseArgs,
} from "./stage-server-library.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("localVersion is 0.0.0-local.<UTC stamp>, a semver pre-release publish-standalone accepts", () => {
  assert.equal(
    localVersion(new Date("2026-09-29T07:05:09.123Z")),
    "0.0.0-local.20260929070509",
  );
  // The same check publish-standalone.mjs's parseArgs applies to --version.
  assert.match(localVersion(new Date()), /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  // Two stages a second apart are two versions.
  assert.notEqual(
    localVersion(new Date("2026-09-29T07:05:09Z")),
    localVersion(new Date("2026-09-29T07:05:10Z")),
  );
});

test("parseArgs defaults the version to now and the out dir to the server's stage/library", () => {
  const now = new Date("2026-09-29T07:05:09Z");
  assert.deepEqual(parseArgs([], { now }), {
    version: "0.0.0-local.20260929070509",
    out: join(
      repoRoot,
      "backend",
      "services",
      "stigmer-server",
      "stage",
      "library",
    ),
    skipBuild: false,
  });
  assert.deepEqual(
    parseArgs(["--version=3.40.0-rc.1", "--out=stage", "--skip-build"], {
      now,
      cwd: "/work",
    }),
    {
      version: "3.40.0-rc.1",
      out: "/work/stage",
      skipBuild: true,
    },
  );
  assert.equal(
    parseArgs(["--out=/tmp/x"], { now, cwd: "/work" }).out,
    "/tmp/x",
  );
  assert.throws(
    () => parseArgs(["--pack-dir=x"], { now }),
    /unknown argument: --pack-dir=x/,
  );
});

test("linkedLibs names the @stigmer/* file: links only, sorted", () => {
  assert.deepEqual(
    linkedLibs({
      dependencies: {
        "@stigmer/protos": "file:../../../apis/stubs/ts",
        "@bufbuild/protobuf": "2.12.0",
        "@stigmer/outbound": "file:../../libs/ts/outbound",
        "@stigmer/pinned": "3.38.3",
        "left-pad": "file:../left-pad",
      },
    }),
    ["@stigmer/outbound", "@stigmer/protos"],
  );
  assert.deepEqual(linkedLibs({}), []);
});

test("the checked-in server's links close over exactly the libs it links, so the staged set is those and the server", () => {
  // Pinned so a new link on the server, or a new @stigmer/* dep of a linked
  // lib, is a visible change here: the consumer installs exactly this set
  // plus the server, and anything outside it would come from the registry
  // at a version that does not exist there.
  const manifest = JSON.parse(
    readFileSync(
      join(repoRoot, "backend", "services", "stigmer-server", "package.json"),
      "utf8",
    ),
  );
  const libs = linkedLibs(manifest);
  assert.deepEqual(libs, [
    "@stigmer/outbound",
    "@stigmer/plugin-package",
    "@stigmer/protos",
    "@stigmer/temporal-codecs",
    "@stigmer/zip-structure",
  ]);
  assert.deepEqual(packageClosure(libs), [
    "apis/stubs/ts",
    "backend/libs/ts/temporal-codecs",
    "backend/libs/ts/zip-structure",
    "backend/libs/ts/plugin-package",
    "backend/libs/ts/outbound",
  ]);
});
