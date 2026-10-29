// Pins the contract between the consumer-install smoke and the release
// script that retries it (stigmer/stigmer#1367): which npm failures read as
// "npm does not serve that pinned version yet", and that the smoke's exit
// code for it survives `npm run`, which is how publish-standalone.mjs starts
// the smoke. The failures are npm's own words from the runs that hit the
// race: v3.38.0's ETARGET, the dev lane's ETARGET, v3.33.0's tarball 404
// (stigmer/stigmer#1325), and a packument 404, whose URL encodes the scope's
// slash. The same words about another @stigmer/* package at the release's
// own version are lag too, since Enterprise installs the libs its pinned
// server pins in turn. Anything else, or the same words about any other
// package or version, is a real failure and must not be retried. Run via
// `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { REGISTRY_LAG_EXIT, registryLag } from "./registry-lag.mjs";

const PINNED = [
  "@stigmer/apis",
  "@stigmer/outbound",
  "@stigmer/temporal-codecs",
  "@stigmer/server",
];

// release.npm-libs run 36449757869, publish-server, attempt 1 (v3.38.0).
const V3_38_0_ETARGET = `npm error code ETARGET
npm error notarget No matching version found for @stigmer/temporal-codecs@3.38.0.
npm error notarget In most cases you or one of your dependencies are requesting
npm error notarget a package version that doesn't exist.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-09-28T16_24_15_874Z-debug-0.log
`;

// release.dev run 37114017440, publish-npm-server, attempt 1.
const DEV_ETARGET = `npm error code ETARGET
npm error notarget No matching version found for @stigmer/temporal-codecs@3.41.1-dev.20261003094357.g39d6aa748646.
npm error notarget In most cases you or one of your dependencies are requesting
npm error notarget a package version that doesn't exist.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-10-03T09_49_34_429Z-debug-0.log
`;

// release.npm-libs run 36396282814, attempt 1 (v3.33.0, stigmer/stigmer#1325).
const V3_33_0_TARBALL_404 = `npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@stigmer/temporal-codecs/-/temporal-codecs-3.33.0.tgz - Not found
npm error 404
npm error 404  '@stigmer/temporal-codecs@https://registry.npmjs.org/@stigmer/temporal-codecs/-/temporal-codecs-3.33.0.tgz' is not in this registry.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
npm error A complete log of this run can be found in: /home/runner/.npm/_logs/2026-09-28T08_24_04_179Z-debug-0.log
`;

/** npm 10's answer for a package whose document it does not serve, with the name swapped in. */
function documentNotFound(name, version) {
  return `npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/${name.replace("/", "%2f")} - Not found
npm error 404
npm error 404  '${name}@${version}' is not in this registry.
npm error 404
npm error 404 Note that you can also install from a
npm error 404 tarball, folder, http url, or git url.
`;
}

test("npm run hands back a script's exit code, so the release script can tell the smoke's lag exit apart", () => {
  const dir = mkdtempSync(join(tmpdir(), "registry-lag-exit-"));
  try {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "lag-exit", private: true, scripts: { smoke: `node -e "process.exit(${REGISTRY_LAG_EXIT})"` } }),
    );
    const result = spawnSync("npm", ["run", "smoke", "--silent"], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, REGISTRY_LAG_EXIT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the lag exit is EX_TEMPFAIL, apart from the 1 every other smoke failure exits with", () => {
  assert.equal(REGISTRY_LAG_EXIT, 75);
});

test("the races the releases hit read as lag on the pinned lib they name", () => {
  assert.equal(registryLag(V3_38_0_ETARGET, PINNED), "@stigmer/temporal-codecs");
  assert.equal(registryLag(DEV_ETARGET, PINNED), "@stigmer/temporal-codecs");
  assert.equal(registryLag(V3_33_0_TARBALL_404, PINNED), "@stigmer/temporal-codecs");
  assert.equal(registryLag(documentNotFound("@stigmer/server", "3.41.0"), PINNED), "@stigmer/server");
  assert.equal(
    registryLag(documentNotFound("@stigmer/server", "3.41.0").replace("%2f", "%2F"), PINNED),
    "@stigmer/server",
    "a registry may spell the encoded slash in upper case",
  );
});

test("the same answers about a package the release does not pin are real failures", () => {
  assert.equal(registryLag(V3_38_0_ETARGET, ["@stigmer/apis", "@stigmer/server"]), null);
  assert.equal(registryLag(documentNotFound("left-pad", "9.9.9"), PINNED), null);
  assert.equal(
    registryLag(V3_38_0_ETARGET.replaceAll("@stigmer/temporal-codecs", "@temporalio/proto"), PINNED),
    null,
  );
  assert.equal(
    registryLag(documentNotFound("@stigmer/server-extras", "1.0.0"), PINNED),
    null,
    "a pinned name that is only the prefix of the missing one is not it",
  );
});

test("a release that pins nothing has no lag, so the PR lanes' file: smoke fails as before", () => {
  assert.equal(registryLag(V3_38_0_ETARGET, []), null);
  assert.equal(registryLag(V3_33_0_TARBALL_404, []), null);
});

test("other failures that mention a pinned lib are real failures", () => {
  const eresolve = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error Found: @stigmer/apis@3.38.0
`;
  const network = `npm error code ECONNRESET
npm error network request to https://registry.npmjs.org/@stigmer%2fapis failed, reason: socket hang up
`;
  const integrity = `npm error code EINTEGRITY
npm error sha512-abc integrity checksum failed when using sha512 for @stigmer/outbound
`;
  for (const stderr of [eresolve, network, integrity, ""]) {
    assert.equal(registryLag(stderr, PINNED), null, stderr);
  }
});

test("another @stigmer package at the release's version is lag: Enterprise installs the libs its server pins", () => {
  const enterprise = ["@stigmer/apis", "@stigmer/outbound", "@stigmer/server"];
  assert.equal(registryLag(V3_38_0_ETARGET, enterprise, "3.38.0"), "@stigmer/temporal-codecs");
  assert.equal(registryLag(V3_33_0_TARBALL_404, enterprise, "3.33.0"), "@stigmer/temporal-codecs");
  assert.equal(registryLag(documentNotFound("@stigmer/session-log", "3.41.0"), enterprise, "3.41.0"), "@stigmer/session-log");
  assert.equal(
    registryLag(DEV_ETARGET, enterprise, "3.41.1-dev.20261003094357.g39d6aa748646"),
    "@stigmer/temporal-codecs",
    "a dev build's version ends before ETARGET's closing period",
  );
});

test("another @stigmer package at any other version, or another scope at the release's version, is a real failure", () => {
  const enterprise = ["@stigmer/apis", "@stigmer/outbound", "@stigmer/server"];
  assert.equal(registryLag(V3_38_0_ETARGET, enterprise, "3.37.0"), null);
  assert.equal(registryLag(V3_33_0_TARBALL_404, enterprise, "3.33"), null);
  assert.equal(registryLag(documentNotFound("@stigmerx/session-log", "3.41.0"), enterprise, "3.41.0"), null);
  assert.equal(
    registryLag(V3_38_0_ETARGET.replaceAll("@stigmer/temporal-codecs", "@temporalio/proto"), enterprise, "3.38.0"),
    null,
  );
  assert.equal(registryLag(V3_38_0_ETARGET, enterprise), null, "without the release's version only the pins count");
});
