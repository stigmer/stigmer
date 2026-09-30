// Pins the upgrade rehearsal's pure decisions: which release an upgrade
// starts from (the newest stable release below the target, never a
// prerelease, never npm's `latest` tag, and a loud refusal when there is
// none); what the command line accepts (only forward upgrades, only X.Y.Z
// releases, one of the four artifacts); which server version the upgraded
// install must report (the release's own, or this checkout's from-source
// version); and when the running images are not the release's. The installs
// themselves are exercised by running the rehearsal (`make rehearse-upgrade
// ARTIFACT=<a>`), not here. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compareVersions,
  expectedServerVersion,
  imageMismatches,
  parseRehearsalArgs,
  pickFromVersion,
} from "./rehearse-upgrade.mjs";
import { sourceBuildVersion } from "./lib/source-version.mjs";

const PUBLISHED = ["3.38.3", "3.39.0", "3.39.1-dev.20260928194002", "3.40.0", "3.40.1", "3.41.0", "3.9.9"];

test("a build upgrades from the newest stable release", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "build" }), "3.41.0");
});

test("a published target upgrades from the newest stable release below it, by number not by text", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.41.0" }), "3.40.1");
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.40.0" }), "3.39.0");
  assert.equal(pickFromVersion(["3.9.9", "3.10.0"], { kind: "build" }), "3.10.0");
});

test("a prerelease is never the base", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.40.0" }), "3.39.0");
  assert.throws(() => pickFromVersion(["3.39.1-dev.1"], { kind: "build" }), /no published release below this build/);
});

test("no release below the target is refused loudly", () => {
  assert.throws(() => pickFromVersion(PUBLISHED, { kind: "published", version: "3.9.9" }), /no published release below 3\.9\.9/);
});

test("compareVersions orders numerically", () => {
  assert.ok(compareVersions("3.10.0", "3.9.9") > 0);
  assert.equal(compareVersions("3.41.0", "3.41.0"), 0);
});

test("the command line: the artifact, an optional base, the target, and a leading v tolerated", () => {
  assert.deepEqual(parseRehearsalArgs(["--artifact=compose"]), {
    artifact: "compose",
    from: "",
    to: { kind: "build" },
    keep: false,
  });
  assert.deepEqual(parseRehearsalArgs(["--artifact=helm", "--from=v3.40.1", "--to=v3.41.0", "--keep"]), {
    artifact: "helm",
    from: "3.40.1",
    to: { kind: "published", version: "3.41.0" },
    keep: true,
  });
});

test("the command line refuses an unknown artifact, a non-release version, a backward move and a stray flag", () => {
  assert.throws(() => parseRehearsalArgs([]), /--artifact must be one of: compose, all-in-one, helm, cli/);
  assert.throws(() => parseRehearsalArgs(["--artifact=desktop"]), /--artifact must be one of/);
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--from=latest"]), /--from must be a release X\.Y\.Z/);
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--to=3.41"]), /--to must be build or a release X\.Y\.Z/);
  assert.throws(
    () => parseRehearsalArgs(["--artifact=cli", "--from=3.41.0", "--to=3.40.1"]),
    /an upgrade only moves forward/,
  );
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--fake-model=error"]), /unknown argument: --fake-model=error/);
});

test("the upgraded server must report the release's version, or this checkout's from-source version", () => {
  assert.equal(expectedServerVersion({ kind: "published", version: "3.41.0" }), "3.41.0");
  assert.equal(expectedServerVersion({ kind: "build" }), sourceBuildVersion());
  assert.match(sourceBuildVersion(), /^0\.0\.0-dev\.[0-9a-f]{7,}$/);
});

test("images that are not the release's are named; a contained marker is enough where asked", () => {
  assert.deepEqual(
    imageMismatches({
      running: { "stigmer-server": "ghcr.io/stigmer/stigmer-server:v3.40.1", "stigmer-runner": "ghcr.io/stigmer/stigmer-runner:v3.41.0" },
      want: { "stigmer-server": "ghcr.io/stigmer/stigmer-server:v3.41.0", "stigmer-runner": "ghcr.io/stigmer/stigmer-runner:v3.41.0" },
    }),
    ['stigmer-server: running "ghcr.io/stigmer/stigmer-server:v3.40.1", want "ghcr.io/stigmer/stigmer-server:v3.41.0"'],
  );
  assert.deepEqual(
    imageMismatches({ running: { server: "node /h/.stigmer/runtimes/3.41.0/node_modules/x/main.js" }, want: { server: "/runtimes/3.41.0/" }, contains: true }),
    [],
  );
  assert.deepEqual(imageMismatches({ running: {}, want: { server: "/server-pkg/" }, contains: true }), [
    'server: running null, want "/server-pkg/"',
  ]);
});
