// Tests for the manifest stamping and tag rule in publish-standalone.mjs.
// Run via `node --test scripts/publish-standalone.test.mjs` (wired into root `npm test`).
//
// What these guard: the release train publishes @stigmer/runner and
// @stigmer/server with their workspace-lib `file:` links rewritten to the
// exact release version. A stamp that misses a link publishes a manifest
// no consumer can install (file:../../.. does not exist on their disk); a
// stamp that touches a non-@stigmer dependency, or a lib already pinned to
// a version, changes what CI tested.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parseArgs, resolveTag, stampManifest } from "./publish-standalone.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

test("stampManifest pins every @stigmer/* file: link to the release version and nothing else", () => {
  const input = {
    name: "@stigmer/example",
    version: "0.0.0-dev",
    dependencies: {
      "@stigmer/protos": "file:../../../apis/stubs/ts",
      "@stigmer/temporal-codecs": "file:../../libs/ts/temporal-codecs",
      "@stigmer/already-pinned": "3.13.0",
      "@temporalio/worker": "1.16.2",
      pg: "8.23.0",
    },
  };
  const { manifest, pinned } = stampManifest(input, "3.14.0");
  assert.equal(manifest.version, "3.14.0");
  assert.deepEqual(manifest.dependencies, {
    "@stigmer/protos": "3.14.0",
    "@stigmer/temporal-codecs": "3.14.0",
    "@stigmer/already-pinned": "3.13.0",
    "@temporalio/worker": "1.16.2",
    pg: "8.23.0",
  });
  assert.deepEqual(pinned, ["@stigmer/protos", "@stigmer/temporal-codecs"]);
  // Pure: the caller's object is untouched (the script restores the file
  // from the original text on --dry-run; a mutated input would defeat that).
  assert.equal(input.version, "0.0.0-dev");
  assert.equal(
    input.dependencies["@stigmer/protos"],
    "file:../../../apis/stubs/ts",
  );
});

test("stampManifest tolerates a manifest without dependencies", () => {
  const { manifest, pinned } = stampManifest(
    { name: "@stigmer/x", version: "0.0.0-dev" },
    "1.0.0",
  );
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.dependencies, {});
  assert.deepEqual(pinned, []);
});

test("resolveTag follows publish-libs: explicit wins, pre-release → next, stable → latest", () => {
  assert.equal(resolveTag("3.14.0", undefined), "latest");
  assert.equal(resolveTag("3.14.0-rc.1", undefined), "next");
  assert.equal(resolveTag("3.14.1-dev.20260910120000", undefined), "next");
  assert.equal(resolveTag("3.14.1-dev.20260910120000", "dev"), "dev");
  assert.equal(resolveTag("3.14.0", "dev"), "dev");
});

test("parseArgs requires --package and a semver --version", () => {
  assert.deepEqual(
    parseArgs(["--package", "backend/services/runner", "--version", "3.14.0"]),
    {
      packageDir: "backend/services/runner",
      version: "3.14.0",
      tag: undefined,
      dryRun: false,
    },
  );
  assert.deepEqual(
    parseArgs([
      "--package",
      "x",
      "--version",
      "3.14.1-dev.1",
      "--tag",
      "dev",
      "--dry-run",
    ]),
    { packageDir: "x", version: "3.14.1-dev.1", tag: "dev", dryRun: true },
  );
  assert.throws(() => parseArgs(["--version", "3.14.0"]), /usage/);
  assert.throws(() => parseArgs(["--package", "x"]), /usage/);
  assert.throws(
    () => parseArgs(["--package", "x", "--version", "v3.14.0"]),
    /semver/,
  );
});

test("the two standalone packages stamp cleanly from their committed manifests", () => {
  // The release workflows run this script against exactly these two
  // directories. Every @stigmer/* dependency each carries must be a file:
  // link (so the stamp pins it) — a dependency added as a bare version
  // range would publish untested resolution and escape the pinned set.
  for (const dir of [
    "backend/services/runner",
    "backend/services/stigmer-server",
  ]) {
    const manifest = JSON.parse(
      readFileSync(join(repoRoot, dir, "package.json"), "utf8"),
    );
    const stigmerDeps = Object.entries(manifest.dependencies).filter(([n]) =>
      n.startsWith("@stigmer/"),
    );
    assert.ok(
      stigmerDeps.length > 0,
      `${dir} links at least one workspace lib`,
    );
    for (const [name, spec] of stigmerDeps) {
      assert.ok(
        spec.startsWith("file:"),
        `${dir}: ${name} must be a file: link in the committed manifest, got '${spec}'`,
      );
    }
    const { manifest: stamped, pinned } = stampManifest(manifest, "9.9.9");
    assert.equal(pinned.length, stigmerDeps.length);
    for (const [name] of stigmerDeps)
      assert.equal(stamped.dependencies[name], "9.9.9");
    assert.equal(
      manifest.private,
      undefined,
      `${dir} must not be private: the release train publishes it`,
    );
    assert.ok(
      manifest.stigmerPublish?.consumerCheck,
      `${dir} must declare stigmerPublish.consumerCheck for the consumer-install smoke this script runs`,
    );
  }
});
