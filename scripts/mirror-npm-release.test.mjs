// Tests for scripts/mirror-npm-release.mjs, the copy of a release's npm
// packages from npmjs.com into Stigmer's own npm repository.
// Run via `node --test scripts/mirror-npm-release.test.mjs` (wired into root `npm test`).
//
// What these pin: the release set is the publishing scripts' own list, so a
// package added to a release is mirrored without a second edit, and every
// standalone package a release workflow publishes is in it. The copy is the
// published bytes: a download that does not match npmjs.com's integrity is
// never published, and the copy must read back with the same integrity. A
// re-run is a no-op where the copy already matches, and a mismatch already
// in the target is refused rather than papered over. A backfill of an old
// release never moves the target's `latest`. And the target is never
// npmjs.com itself. Every registry here is a fake; nothing is sent anywhere.

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  integrityOf,
  mirrorPackage,
  mirrorTarget,
  packumentUrl,
  releaseSet,
  SETTLE_ATTEMPTS,
  SOURCE_REGISTRY,
  tagFor,
  UNTAGGED,
} from "./mirror-npm-release.mjs";
import { PACKAGES } from "./publish-libs.mjs";
import { STANDALONE_PACKAGES } from "./publish-standalone.mjs";

const TARGET = "https://us-central1-npm.pkg.dev/pc-stigmer-foundation/stigmer-npm/";
const BYTES = Buffer.from("a tarball's bytes");
const INTEGRITY = integrityOf(BYTES);

/** A fake pair of registries: npmjs.com's packument and tarball, and the target's packument. */
function registries({ origin, target = [], tarball = BYTES } = {}) {
  const asked = [];
  const targetAnswers = [...target];
  const fetchImpl = async (url, init = {}) => {
    asked.push({ url, init });
    if (url.startsWith(SOURCE_REGISTRY) && url.endsWith(".tgz")) {
      return new Response(tarball, { status: 200 });
    }
    if (url.startsWith(SOURCE_REGISTRY)) {
      return origin ? Response.json(origin) : new Response("", { status: 404 });
    }
    const next = targetAnswers.length > 1 ? targetAnswers.shift() : targetAnswers[0];
    return next ? Response.json(next) : new Response("", { status: 404 });
  };
  return { fetchImpl, asked };
}

function originFor(version, { integrity = INTEGRITY, distTags = { latest: version } } = {}) {
  return {
    "dist-tags": distTags,
    versions: { [version]: { dist: { tarball: `${SOURCE_REGISTRY}@stigmer/apis/-/apis-${version}.tgz`, integrity } } },
  };
}

function withWorkDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "mirror-test-"));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("the release set is publish-libs' PACKAGES then the standalone packages, by manifest name", () => {
  const names = releaseSet((dir) => ({ name: `name-of:${dir}` }));
  assert.deepEqual(names, [...PACKAGES, ...STANDALONE_PACKAGES].map((dir) => `name-of:${dir}`));
  const real = releaseSet();
  for (const name of ["@stigmer/apis", "@stigmer/client", "@stigmer/design-tokens", "@stigmer/mcp-server", "@stigmer/server", "@stigmer/enterprise"]) {
    assert.ok(real.includes(name), `${name} is mirrored`);
  }
  assert.ok(real.indexOf("@stigmer/server") < real.indexOf("@stigmer/enterprise"), "a package's @stigmer/* dependencies land first");
});

test("every standalone package a release workflow publishes is in the release set", () => {
  const workflow = readFileSync(new URL("../.github/workflows/release.npm-libs.yaml", import.meta.url), "utf8");
  const published = [...workflow.matchAll(/publish-standalone\.mjs[\s\\]+--package (\S+)/g)].map((m) => m[1]);
  assert.ok(published.length > 0, "the release workflow publishes standalone packages");
  for (const dir of published) assert.ok(STANDALONE_PACKAGES.includes(dir), `${dir} is in STANDALONE_PACKAGES`);
});

test("tagFor copies under the tag npmjs.com names the version by, preferring latest, and never moves latest for an untagged version", () => {
  assert.equal(tagFor({ latest: "0.1.0", next: "0.1.0" }, "0.1.0"), "latest");
  assert.equal(tagFor({ latest: "0.1.0", next: "0.2.0-rc.1" }, "0.2.0-rc.1"), "next");
  assert.equal(tagFor({ latest: "0.2.0", beta: "0.1.5", alpha: "0.1.5" }, "0.1.5"), "alpha");
  assert.equal(tagFor({ latest: "0.2.0" }, "0.1.0"), UNTAGGED);
  assert.equal(tagFor(undefined, "0.1.0"), UNTAGGED);
});

test("packumentUrl escapes the scope's slash the way npm's client does, with or without a trailing slash", () => {
  assert.equal(packumentUrl(TARGET, "@stigmer/apis"), `${TARGET}@stigmer%2fapis`);
  assert.equal(packumentUrl(TARGET.slice(0, -1), "@stigmer/apis"), `${TARGET}@stigmer%2fapis`);
});

test("mirrorTarget refuses npmjs.com and anything that is not https", () => {
  assert.equal(mirrorTarget(TARGET.slice(0, -1)), TARGET);
  assert.throws(() => mirrorTarget("https://registry.npmjs.org/"), /not to Stigmer's npm repository/);
  assert.throws(() => mirrorTarget("https://registry.npmjs.org"), /not to Stigmer's npm repository/);
  assert.throws(() => mirrorTarget("undefined"), /not to Stigmer's npm repository/);
});

test("a version the target lacks is downloaded, checked, published under its tag, and read back with the same integrity", () =>
  withWorkDir(async (workDir) => {
    const published = [];
    const { fetchImpl, asked } = registries({
      origin: originFor("0.1.0"),
      target: [null, { versions: { "0.1.0": { dist: { integrity: INTEGRITY } } } }],
    });
    const outcome = await mirrorPackage("@stigmer/apis", "0.1.0", {
      target: TARGET,
      token: "ya29.token",
      fetchImpl,
      workDir,
      publish: (file, tag) => published.push({ bytes: readFileSync(file), tag }),
      sleep: async () => {},
    });
    assert.equal(outcome, "copied");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0].bytes, BYTES);
    assert.equal(published[0].tag, "latest");
    const targetReads = asked.filter(({ url }) => url.startsWith(TARGET));
    assert.ok(targetReads.every(({ init }) => init.headers.authorization === "Bearer ya29.token"), "target reads carry the token");
    const sourceReads = asked.filter(({ url }) => url.startsWith(SOURCE_REGISTRY));
    assert.ok(sourceReads.every(({ init }) => !init.headers?.authorization), "npmjs.com never sees the target's token");
  }));

test("a re-run over a version already mirrored with the same integrity publishes nothing", () =>
  withWorkDir(async (workDir) => {
    const { fetchImpl } = registries({
      origin: originFor("0.1.0"),
      target: [{ versions: { "0.1.0": { dist: { integrity: INTEGRITY } } } }],
    });
    const outcome = await mirrorPackage("@stigmer/apis", "0.1.0", {
      target: TARGET,
      fetchImpl,
      workDir,
      publish: () => assert.fail("published a version already there"),
    });
    assert.equal(outcome, "present");
  }));

test("a version already in the target with other bytes is refused, never replaced", () =>
  withWorkDir(async (workDir) => {
    const { fetchImpl } = registries({
      origin: originFor("0.1.0"),
      target: [{ versions: { "0.1.0": { dist: { integrity: "sha512-other" } } } }],
    });
    await assert.rejects(
      mirrorPackage("@stigmer/apis", "0.1.0", { target: TARGET, fetchImpl, workDir, publish: () => assert.fail("published") }),
      /with integrity sha512-other, not npmjs.com's .*never replaced/,
    );
  }));

test("a download that does not match npmjs.com's integrity is never published", () =>
  withWorkDir(async (workDir) => {
    const { fetchImpl } = registries({ origin: originFor("0.1.0"), tarball: Buffer.from("other bytes") });
    await assert.rejects(
      mirrorPackage("@stigmer/apis", "0.1.0", { target: TARGET, fetchImpl, workDir, publish: () => assert.fail("published") }),
      /does not match the integrity npmjs\.com published .*on npmjs\.com only until this mirror is re-run/,
    );
  }));

test("a copy that reads back with other bytes, or never appears, is refused with the recovery", () =>
  withWorkDir(async (workDir) => {
    const wrong = registries({
      origin: originFor("0.1.0"),
      target: [null, { versions: { "0.1.0": { dist: { integrity: "sha512-other" } } } }],
    });
    await assert.rejects(
      mirrorPackage("@stigmer/apis", "0.1.0", { target: TARGET, fetchImpl: wrong.fetchImpl, workDir, publish: () => {}, sleep: async () => {} }),
      /landed in .* with integrity sha512-other/,
    );

    let slept = 0;
    const absent = registries({ origin: originFor("0.1.0"), target: [null] });
    await assert.rejects(
      mirrorPackage("@stigmer/apis", "0.1.0", {
        target: TARGET,
        fetchImpl: absent.fetchImpl,
        workDir,
        publish: () => {},
        sleep: async () => {
          slept += 1;
        },
      }),
      /does not list it yet; the release is on npmjs\.com only until this mirror is re-run/,
    );
    assert.equal(slept, SETTLE_ATTEMPTS - 1);
  }));

test("a version npmjs.com does not have is refused before anything is read from the target", () =>
  withWorkDir(async (workDir) => {
    const { fetchImpl, asked } = registries({ origin: originFor("0.1.0") });
    await assert.rejects(
      mirrorPackage("@stigmer/apis", "0.2.0", { target: TARGET, fetchImpl, workDir, publish: () => assert.fail("published") }),
      /@stigmer\/apis@0\.2\.0 is not on npmjs\.com/,
    );
    assert.ok(asked.every(({ url }) => url.startsWith(SOURCE_REGISTRY)));
  }));
