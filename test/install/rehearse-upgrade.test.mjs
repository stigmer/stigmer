// Pins the upgrade rehearsal's decisions: which release an upgrade starts
// from (the newest stable release below the target that npm does not mark
// deprecated, never a prerelease, never npm's `latest` tag; a prerelease
// target starts below its X.Y.Z); that no such release reads as the line's
// first release, which the rehearsal states and passes on, while releases
// that are all half-published or a registry that cannot be read still fail;
// what the one registry read takes from npm's install document; what the command line
// accepts (only forward upgrades, a release or a prerelease as the target,
// only a stable base, one of the four artifacts, a packaged chart only for a
// published Helm target); which server version the upgraded
// install must report (the release's own, or this checkout's from-source
// version); and when the running images are not the release's. The installs
// themselves are exercised by running the rehearsal (`make rehearse-upgrade
// ARTIFACT=<a>`), not here; the first-release pass and the registry failure
// are, against a registry served on loopback. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  NOTHING_TO_UPGRADE,
  compareVersions,
  expectedServerVersion,
  imageMismatches,
  parseRehearsalArgs,
  pickFromVersion,
  pickPublishedBase,
  publishedReleases,
  reportNothingToUpgrade,
  versionCore,
} from "./rehearse-upgrade.mjs";
import { sourceBuildVersion } from "../../scripts/lib/source-version.mjs";

const SCRIPT = fileURLToPath(new URL("./rehearse-upgrade.mjs", import.meta.url));
const PUBLISHED = {
  versions: ["3.38.3", "3.39.0", "3.39.1-dev.20260928194002", "3.40.0", "3.40.1", "3.41.0", "3.9.9"],
  deprecated: [],
};
const only = (...versions) => ({ versions, deprecated: [] });

test("a build upgrades from the newest stable release", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "build" }), "3.41.0");
});

test("a published target upgrades from the newest stable release below it, by number not by text", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.41.0" }), "3.40.1");
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.40.0" }), "3.39.0");
  assert.equal(pickFromVersion(only("3.9.9", "3.10.0"), { kind: "build" }), "3.10.0");
});

test("a prerelease is never the base", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.40.0" }), "3.39.0");
  assert.equal(pickFromVersion(only("0.1.0-dev.20261016120000.g10c87982a0f1"), { kind: "build" }), undefined);
});

test("a deprecated release is passed over for the newest one that is not", () => {
  const releases = { versions: PUBLISHED.versions, deprecated: ["3.41.0", "3.40.1"] };
  assert.equal(pickFromVersion(releases, { kind: "build" }), "3.40.0");
  assert.equal(pickFromVersion(releases, { kind: "published", version: "3.42.0" }), "3.40.0");
});

test("no undeprecated release below the target reads as none, not as a refusal", () => {
  assert.equal(pickFromVersion(PUBLISHED, { kind: "published", version: "3.9.9" }), undefined);
  assert.equal(pickFromVersion({ versions: ["3.40.1", "3.41.0", "0.1.0"], deprecated: ["3.40.1", "3.41.0"] }, { kind: "published", version: "0.1.0" }), undefined);
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
    pickPublishedBase(only("3.40.1", "3.41.0"), { kind: "build" }, async () => "the chart", () => {}),
    /no release below this build has every artifact this install needs published \(tried 3\.41\.0, 3\.40\.1\)/,
  );
  await assert.rejects(
    pickPublishedBase(PUBLISHED, { kind: "build" }, async () => {
      throw new Error("ghcr.io answered HTTP 503");
    }, () => {}),
    /HTTP 503/,
  );
});

test("a line whose every earlier release is deprecated has no base, and nothing is asked of the registries", async () => {
  const logged = [];
  const asked = [];
  const releases = { versions: ["3.40.1", "3.41.0", "0.1.0-dev.20261016120000.g10c87982a0f1"], deprecated: ["3.40.1", "3.41.0"] };
  const base = await pickPublishedBase(releases, { kind: "build" }, async (version) => (asked.push(version), undefined), (line) => logged.push(line));
  assert.equal(base, undefined);
  assert.deepEqual(asked, []);
  assert.deepEqual(logged, ["2 deprecated release(s) passed over, the newest 3.41.0"]);
  assert.equal(await pickPublishedBase(only(), { kind: "published", version: "0.1.0" }, async () => undefined, () => {}), undefined);
});

/** A fetch that answers one install document, or the given failure. */
function registryAnswering(answer) {
  return async (url, init) => {
    assert.equal(url, "https://registry.example.invalid/@stigmer%2fcli");
    assert.match(init.headers.accept, /application\/vnd\.npm\.install-v1\+json/);
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

test("one read of npm's install document gives every version and the deprecated ones", async () => {
  const document = {
    versions: {
      "3.41.0": { version: "3.41.0", deprecated: "the 3.x line is retired; install 0.1.0 or later" },
      "3.40.1": { version: "3.40.1", deprecated: "" },
      "0.1.0": { version: "0.1.0" },
    },
  };
  const releases = await publishedReleases("@stigmer/cli", {
    registry: "https://registry.example.invalid",
    fetchImpl: registryAnswering(new Response(JSON.stringify(document), { status: 200 })),
  });
  assert.deepEqual(releases, { versions: ["3.41.0", "3.40.1", "0.1.0"], deprecated: ["3.41.0"] });
});

test("a registry that cannot be read fails; it never reads as a first release", async () => {
  const registry = "https://registry.example.invalid/";
  await assert.rejects(
    publishedReleases("@stigmer/cli", { registry, fetchImpl: registryAnswering(new TypeError("fetch failed", { cause: new Error("ENOTFOUND") })) }),
    /npm registry unreachable reading @stigmer\/cli's releases: fetch failed: ENOTFOUND/,
  );
  await assert.rejects(
    publishedReleases("@stigmer/cli", { registry, fetchImpl: registryAnswering(new Response("busy", { status: 503 })) }),
    /npm registry answered HTTP 503/,
  );
  await assert.rejects(
    publishedReleases("@stigmer/cli", { registry, fetchImpl: registryAnswering(new Response("<html>", { status: 200 })) }),
    /unreadable document/,
  );
  await assert.rejects(
    publishedReleases("@stigmer/cli", { registry, fetchImpl: registryAnswering(new Response("{}", { status: 200 })) }),
    /lists no versions/,
  );
});

test("the first release is stated on stdout, and in the job summary only when there is one", () => {
  const written = [];
  const appended = [];
  const append = (path, text) => appended.push([path, text]);
  reportNothingToUpgrade("helm", "0.1.0", { env: { GITHUB_STEP_SUMMARY: "/summary.md" }, write: (line) => written.push(line), append });
  assert.deepEqual(written, [`rehearse-upgrade: helm to 0.1.0: ${NOTHING_TO_UPGRADE}`]);
  assert.deepEqual(appended, [["/summary.md", `### Upgrade rehearsal: helm\n\nhelm to 0.1.0: ${NOTHING_TO_UPGRADE}\n`]]);

  reportNothingToUpgrade("cli", "0.1.0", { env: {}, write: () => {}, append });
  assert.equal(appended.length, 1);
  assert.equal(NOTHING_TO_UPGRADE, "no earlier release on this line: nothing to upgrade from");
});

/**
 * Runs the rehearsal against a registry on loopback that answers every
 * request with `status` and `body`, and resolves to its exit code, output
 * and job summary. The base is decided before anything is installed, so
 * these runs need no docker.
 */
async function rehearseAgainstRegistry(status, body, args) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "rehearse-upgrade-"));
  const summary = join(dir, "summary.md");
  try {
    const env = {
      ...process.env,
      npm_config_registry: `http://127.0.0.1:${server.address().port}/`,
      GITHUB_STEP_SUMMARY: summary,
    };
    const result = await new Promise((resolve) => {
      execFile(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" }, (error, stdout, stderr) =>
        resolve({ code: error === null ? 0 : error.code, stdout, stderr }),
      );
    });
    let written = "";
    try {
      written = readFileSync(summary, "utf8");
    } catch {
      written = "";
    }
    return { ...result, summary: written };
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("run against a registry whose every release is deprecated, the rehearsal states the first release and exits 0", async () => {
  const document = JSON.stringify({ versions: { "3.41.0": { version: "3.41.0", deprecated: "retired" } } });
  const run = await rehearseAgainstRegistry(200, document, ["--artifact=compose", "--to=0.1.0"]);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /rehearse-upgrade: compose to 0\.1\.0: no earlier release on this line: nothing to upgrade from/);
  assert.match(run.summary, /### Upgrade rehearsal: compose\n\ncompose to 0\.1\.0: no earlier release on this line: nothing to upgrade from/);
});

test("run against a registry that fails, the rehearsal fails and states no first release", async () => {
  const run = await rehearseAgainstRegistry(503, "{}", ["--artifact=compose", "--to=0.1.0"]);
  assert.equal(run.code, 1);
  assert.match(run.stderr, /rehearse-upgrade: FAIL — npm registry answered HTTP 503/);
  assert.equal(run.summary, "");
  assert.doesNotMatch(run.stdout, /nothing to upgrade from/);
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
