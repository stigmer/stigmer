// Tests for the manifest stamping and tag rule in publish-standalone.mjs.
// Run via `node --test scripts/publish-standalone.test.mjs` (wired into root `npm test`).
//
// What these guard: the release train publishes @stigmer/runner and
// @stigmer/server with their workspace-lib `file:` links rewritten to the
// exact release version. A stamp that misses a link publishes a manifest
// no consumer can install (file:../../.. does not exist on their disk); a
// stamp that touches a non-@stigmer dependency, or a lib already pinned to
// a version, changes what CI tested.
//
// They also guard the registry wait (stigmer#1275). The release lost
// @stigmer/server@3.28.0 to a fixed 5-minute window that closed one second
// before npm served a lib it had already accepted. So the schedule is
// pinned here on a fake clock: one shared deadline, backoff to a cap, a
// last sleep cut to the deadline, and a refusal that names the lag and the
// rerun rather than blaming the libs job. And "served" means what an
// install sees: the wait reads npm's abbreviated install document, which
// npm caches apart from the full document `npm view` reads.
//
// And "served" means the whole install, not only its resolution
// (stigmer#1325). On v3.33.0 the install document listed
// @stigmer/temporal-codecs while its tarball still answered 404, so the
// wait passed and the consumer smoke behind it failed. So `installGap` is
// pinned here on a fake fetch: it HEADs the tarball the document names,
// every way an install can still fall short has its own words, and the
// wait holds a lib that is listed but not downloadable and says why.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  INSTALL_METADATA_ACCEPT,
  installGap,
  parseArgs,
  registryLagMessage,
  REQUEST_TIMEOUT_MS,
  resolveTag,
  stampManifest,
  waitForRegistry,
  WAIT_BUDGET_MS,
  WAIT_FIRST_INTERVAL_MS,
  WAIT_MAX_INTERVAL_MS,
} from "./publish-standalone.mjs";

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

/**
 * A registry whose libs appear at given times on a fake clock; `sleep`
 * advances the clock, so the wait runs instantly and its schedule is exact.
 * A lib's time is when it becomes installable, or `{ listedAtMs,
 * servedAtMs }` when its install document lists it before its tarball
 * answers, the v3.33.0 shape. A lib with no time never appears.
 */
function fakeRegistry(timelines) {
  let clock = 0;
  const sleeps = [];
  const queries = [];
  const logs = [];
  return {
    sleeps,
    queries,
    logs,
    options: {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      gapOf: (name, version) => {
        queries.push(`${name}@${version}`);
        const timeline = timelines[name];
        if (timeline === undefined) return "not listed in its install document";
        const { listedAtMs, servedAtMs } =
          typeof timeline === "number"
            ? { listedAtMs: timeline, servedAtMs: timeline }
            : timeline;
        if (clock < listedAtMs) return "not listed in its install document";
        if (clock < servedAtMs) return "tarball answers HTTP 404";
        return null;
      },
      log: (line) => logs.push(line),
      runId: "36264269415",
    },
  };
}

test("the wait's budget is almost three times the worst lag measured, polled from 10 s up to a 60 s cap, each request bounded at 30 s", () => {
  assert.equal(WAIT_BUDGET_MS, 20 * 60_000);
  assert.equal(WAIT_FIRST_INTERVAL_MS, 10_000);
  assert.equal(WAIT_MAX_INTERVAL_MS, 60_000);
  assert.equal(REQUEST_TIMEOUT_MS, 30_000);
});

test("waitForRegistry returns without sleeping when every lib is already installable", async () => {
  const registry = fakeRegistry({
    "@stigmer/protos": 0,
    "@stigmer/outbound": 0,
  });
  await waitForRegistry(
    ["@stigmer/protos", "@stigmer/outbound"],
    "3.28.0",
    registry.options,
  );
  assert.deepEqual(registry.sleeps, []);
  assert.deepEqual(registry.queries, [
    "@stigmer/protos@3.28.0",
    "@stigmer/outbound@3.28.0",
  ]);
});

test("waitForRegistry outlasts the v3.28.0 lag: a lib served after 7 minutes is found, on a doubling schedule capped at 60 s", async () => {
  const registry = fakeRegistry({
    "@stigmer/outbound": 20_000,
    "@stigmer/plugin-package": 7 * 60_000 + 8_000,
  });
  await waitForRegistry(
    ["@stigmer/outbound", "@stigmer/plugin-package"],
    "3.28.0",
    registry.options,
  );
  assert.deepEqual(
    registry.sleeps.slice(0, 4),
    [10_000, 20_000, 40_000, 60_000],
  );
  assert.ok(registry.sleeps.slice(3).every((ms) => ms === 60_000));
  // A lib found once is never asked about again.
  const outboundQueries = registry.queries.filter(
    (q) => q === "@stigmer/outbound@3.28.0",
  );
  assert.equal(outboundQueries.length, 3);
});

test("waitForRegistry holds a lib that is listed but not downloadable until its tarball answers, and says so each round (the v3.33.0 lag)", async () => {
  const registry = fakeRegistry({
    "@stigmer/temporal-codecs": { listedAtMs: 60_000, servedAtMs: 180_000 },
  });
  await waitForRegistry(
    ["@stigmer/temporal-codecs"],
    "3.33.0",
    registry.options,
  );
  // Rounds at 0, 10, 30, 70, 130 and 190 s: listed from 70 s, installable only at 190 s.
  assert.deepEqual(registry.sleeps, [10_000, 20_000, 40_000, 60_000, 60_000]);
  const gaps = registry.logs
    .filter((line) => line.startsWith("  not yet installable: "))
    .map((line) => line.match(/\((.+)\); next check/)[1]);
  assert.deepEqual(gaps, [
    "not listed in its install document",
    "not listed in its install document",
    "not listed in its install document",
    "tarball answers HTTP 404",
    "tarball answers HTTP 404",
  ]);
  assert.equal(
    registry.logs.at(-1),
    "  installable: @stigmer/temporal-codecs@3.33.0",
  );
});

test("waitForRegistry shares one deadline across libs and cuts its last sleep to it", async () => {
  const registry = fakeRegistry({});
  await assert.rejects(
    waitForRegistry(["@stigmer/protos", "@stigmer/plugin-package"], "3.28.0", {
      ...registry.options,
      budgetMs: 100_000,
    }),
  );
  // 10 + 20 + 40 = 70 s, then the last sleep is cut to the 30 s left.
  assert.deepEqual(registry.sleeps, [10_000, 20_000, 40_000, 30_000]);
  assert.equal(
    registry.sleeps.reduce((a, b) => a + b, 0),
    100_000,
  );
});

test("waitForRegistry's refusal names each lagging lib with what it lacks, and the rerun, not a failed libs job", async () => {
  const registry = fakeRegistry({
    "@stigmer/protos": 0,
    "@stigmer/temporal-codecs": { listedAtMs: 0, servedAtMs: Infinity },
  });
  await assert.rejects(
    waitForRegistry(
      [
        "@stigmer/protos",
        "@stigmer/temporal-codecs",
        "@stigmer/plugin-package",
      ],
      "3.28.0",
      { ...registry.options, budgetMs: 120_000 },
    ),
    (error) => {
      assert.equal(
        error.message,
        "@stigmer/temporal-codecs@3.28.0 (tarball answers HTTP 404), " +
          "@stigmer/plugin-package@3.28.0 (not listed in its install document) " +
          "published by the libs job but not installable from npm after 2 minutes; " +
          "the registry is lagging. Rerun the failed job once npm serves them: gh run rerun 36264269415 --failed",
      );
      return true;
    },
  );
});

test("registryLagMessage names every lagging lib with its gap, and a placeholder when no run id is known", () => {
  assert.equal(
    registryLagMessage(
      [{ name: "@stigmer/a", gap: "not listed in its install document" }],
      "1.0.0",
      20 * 60_000,
      undefined,
    ),
    "@stigmer/a@1.0.0 (not listed in its install document) published by the libs job but not installable " +
      "from npm after 20 minutes; the registry is lagging. Rerun the failed job once npm serves it: " +
      "gh run rerun <run-id> --failed",
  );
});

const TARBALL =
  "https://registry.npmjs.org/@stigmer/temporal-codecs/-/temporal-codecs-3.33.0.tgz";

/** An install document that lists `version` with the given tarball URL. */
function listing(version, tarball = TARBALL) {
  return {
    status: 200,
    body: { versions: { [version]: { dist: { tarball } } } },
  };
}

/**
 * A fetch that answers the install document (GET) and the tarball (HEAD)
 * separately, and records what it was asked. An answer that is an Error
 * rejects the request; a body that is an Error fails its JSON parse.
 */
function fakeFetch({ document, tarball = { status: 200 } }) {
  const asked = [];
  return {
    asked,
    fetchImpl: async (url, init) => {
      const method = init?.method ?? "GET";
      asked.push({
        method,
        url,
        accept: init?.headers?.accept,
        bounded: init?.signal instanceof AbortSignal,
      });
      const answer = method === "HEAD" ? tarball : document;
      if (answer instanceof Error) throw answer;
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => {
          if (answer.body instanceof Error) throw answer.body;
          return answer.body;
        },
      };
    },
  };
}

test("installGap asks for the install document the way npm's installer does, then HEADs the tarball it names, each request bounded", async () => {
  const registry = fakeFetch({ document: listing("3.33.0") });
  assert.equal(
    await installGap("@stigmer/temporal-codecs", "3.33.0", {
      registry: "https://registry.npmjs.org/",
      fetchImpl: registry.fetchImpl,
    }),
    null,
  );
  assert.deepEqual(registry.asked, [
    {
      method: "GET",
      url: "https://registry.npmjs.org/@stigmer%2ftemporal-codecs",
      accept: INSTALL_METADATA_ACCEPT,
      bounded: true,
    },
    { method: "HEAD", url: TARBALL, accept: undefined, bounded: true },
  ]);
  assert.match(
    INSTALL_METADATA_ACCEPT,
    /^application\/vnd\.npm\.install-v1\+json/,
  );
});

test("installGap adds the separator a registry URL without a trailing slash lacks, and asks for no tarball it cannot name", async () => {
  const registry = fakeFetch({
    document: { status: 200, body: { versions: {} } },
  });
  await installGap("@stigmer/protos", "1.0.0", {
    registry: "https://npm.example.test/api",
    fetchImpl: registry.fetchImpl,
  });
  assert.equal(
    registry.asked[0].url,
    "https://npm.example.test/api/@stigmer%2fprotos",
  );
  assert.equal(registry.asked.length, 1);
});

test("installGap names the tarball when the install document lists a version npm does not serve yet (v3.33.0, run 36396282814)", async () => {
  const registry = fakeFetch({
    document: listing("3.33.0"),
    tarball: { status: 404 },
  });
  assert.equal(
    await installGap("@stigmer/temporal-codecs", "3.33.0", {
      registry: "https://registry.npmjs.org/",
      fetchImpl: registry.fetchImpl,
    }),
    "tarball answers HTTP 404",
  );
});

test("installGap names the first thing an install still lacks, so the wait asks again and its refusal says why", async () => {
  const cases = [
    [
      { document: new Error("getaddrinfo ENOTFOUND registry.npmjs.org") },
      "registry unreachable: getaddrinfo ENOTFOUND registry.npmjs.org",
    ],
    [
      {
        document: new TypeError("fetch failed", {
          cause: new Error("read ECONNRESET"),
        }),
      },
      "registry unreachable: fetch failed: read ECONNRESET",
    ],
    [
      { document: { status: 404, body: { error: "Not found" } } },
      "install document answers HTTP 404",
    ],
    [
      { document: { status: 503, body: {} } },
      "install document answers HTTP 503",
    ],
    [
      {
        document: {
          status: 200,
          body: new SyntaxError("Unexpected token '<'"),
        },
      },
      "install document unreadable: Unexpected token '<'",
    ],
    [
      { document: { status: 200, body: { versions: { "3.27.2": {} } } } },
      "not listed in its install document",
    ],
    [
      { document: { status: 200, body: {} } },
      "not listed in its install document",
    ],
    [
      { document: { status: 200, body: { versions: { "3.28.0": {} } } } },
      "no tarball in its install document",
    ],
    [{ document: listing("3.28.0", "") }, "no tarball in its install document"],
    [
      {
        document: listing("3.28.0"),
        tarball: new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      },
      "tarball unreachable: The operation was aborted due to timeout",
    ],
    [
      { document: listing("3.28.0"), tarball: { status: 404 } },
      "tarball answers HTTP 404",
    ],
    [
      { document: listing("3.28.0"), tarball: { status: 403 } },
      "tarball answers HTTP 403",
    ],
  ];
  for (const [answers, gap] of cases) {
    const registry = fakeFetch(answers);
    assert.equal(
      await installGap("@stigmer/outbound", "3.28.0", {
        registry: "https://registry.npmjs.org/",
        fetchImpl: registry.fetchImpl,
      }),
      gap,
    );
  }
});
