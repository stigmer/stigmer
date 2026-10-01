// Pins the upgrade rehearsal's pure decisions: which release an upgrade
// starts from (the newest stable release below the target, never a
// prerelease, never npm's `latest` tag, and a loud refusal when there is
// none; a prerelease target starts below its X.Y.Z); what the command line
// accepts (only forward upgrades, a release or a prerelease as the target,
// only a stable base, one of the four artifacts, a packaged chart only for a
// published Helm target); which server version the upgraded
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
  pickPublishedBase,
  versionCore,
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

test("a prerelease target upgrades from the newest stable release below its X.Y.Z", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.42.0-rc.1" }), "3.41.0");
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.41.0-rc.2" }), "3.40.1");
  // A patch prerelease: its own X.Y is the base's, so only its core orders them.
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.41.1-rc.1" }), "3.41.0");
  assert.equal(versionCore("3.42.0-rc.1"), "3.42.0");
  assert.equal(versionCore("3.42.0"), "3.42.0");
});

test("the base is the newest release whose own artifacts are published, and a release passed over is named", async () => {
  const logged = [];
  const unpublished = { "3.41.0": "ghcr.io/stigmer/charts/stigmer:3.41.0", "3.40.1": "ghcr.io/stigmer/stigmer-server:v3.40.1" };
  const base = await pickPublishedBase(PUBLISHED, { kind: "build" }, async (version) => unpublished[version], (line) => logged.push(line));
  assert.equal(base, "3.40.0");
  assert.deepEqual(logged, [
    "base 3.41.0 passed over: ghcr.io/stigmer/charts/stigmer:3.41.0 is not published",
    "base 3.40.1 passed over: ghcr.io/stigmer/stigmer-server:v3.40.1 is not published",
  ]);
});

test("the base is the newest release when everything is published, asked about once", async () => {
  const asked = [];
  const base = await pickPublishedBase(PUBLISHED, { kind: "published", version: "3.41.0" }, async (version) => (asked.push(version), undefined), () => {});
  assert.equal(base, "3.40.1");
  assert.deepEqual(asked, ["3.40.1"]);
});

test("no fully published release below the target is refused, naming every one tried; a registry fault is not a gap", async () => {
  await assert.rejects(
    pickPublishedBase(["3.40.1", "3.41.0"], { kind: "build" }, async () => "the chart", () => {}),
    /no release below this build has every artifact this install needs published \(tried 3\.41\.0, 3\.40\.1\)/,
  );
  await assert.rejects(
    pickPublishedBase(PUBLISHED, { kind: "build" }, async () => {
      throw new Error("ghcr.io answered HTTP 503");
    }, () => {}),
    /HTTP 503/,
  );
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
    chart: undefined,
    keep: false,
  });
  assert.deepEqual(parseRehearsalArgs(["--artifact=helm", "--from=v3.40.1", "--to=v3.41.0", "--keep"]), {
    artifact: "helm",
    from: "3.40.1",
    to: { kind: "published", version: "3.41.0" },
    chart: undefined,
    keep: true,
  });
});

test("the command line: a prerelease target, and the release's packaged chart for a published Helm target", () => {
  assert.deepEqual(parseRehearsalArgs(["--artifact=compose", "--to=v3.42.0-rc.1"]).to, { kind: "published", version: "3.42.0-rc.1" });
  assert.equal(
    parseRehearsalArgs(["--artifact=helm", "--to=3.42.0", "--chart=dist-chart/stigmer-3.42.0.tgz"]).chart,
    "dist-chart/stigmer-3.42.0.tgz",
  );
});

test("the command line refuses a prerelease base, a base at the target's X.Y.Z, a malformed prerelease and a misplaced chart", () => {
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--from=3.41.0-rc.1"]), /--from must be a release X\.Y\.Z/);
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--from=3.42.0", "--to=3.42.0-rc.1"]), /an upgrade only moves forward/);
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--to=3.42.0-"]), /--to must be build or a release/);
  assert.throws(() => parseRehearsalArgs(["--artifact=cli", "--to=3.42.0-rc.1!"]), /--to must be build or a release/);
  for (const argv of [
    ["--artifact=compose", "--to=3.42.0", "--chart=c.tgz"],
    ["--artifact=helm", "--chart=c.tgz"],
  ]) {
    assert.throws(() => parseRehearsalArgs(argv), /--chart applies only to --artifact=helm with a published --to/, argv.join(" "));
  }
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
