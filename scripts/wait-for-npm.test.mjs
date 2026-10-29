// Pins the command form of the release's registry wait, which
// release.mcp-server.yaml runs before it builds an image that installs
// @stigmer/mcp-server (stigmer#1361). It takes the package names and one
// release version, refuses anything else (the version arrives from a tag
// name or a dispatch input), and waits on the release wait's own budget and
// schedule unless told a shorter budget. The wait itself is pinned in
// publish-standalone.test.mjs; here, on a fake clock, only that the command
// hands it the right things. Run via `node --test scripts/wait-for-npm.test.mjs`
// (wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import { WAIT_BUDGET_MS } from "./publish-standalone.mjs";
import { main, parseArgs } from "./wait-for-npm.mjs";

test("parseArgs takes the names and a release version, on the release wait's budget", () => {
  assert.deepEqual(parseArgs(["@stigmer/mcp-server", "--version", "3.41.0"]), {
    names: ["@stigmer/mcp-server"],
    version: "3.41.0",
    budgetMs: WAIT_BUDGET_MS,
  });
  assert.deepEqual(parseArgs(["@stigmer/a", "@stigmer/b", "--version", "3.42.0-rc.1", "--budget-minutes", "1"]), {
    names: ["@stigmer/a", "@stigmer/b"],
    version: "3.42.0-rc.1",
    budgetMs: 60_000,
  });
});

test("parseArgs refuses what is not a release version, no names, and a budget that is not a positive number", () => {
  for (const version of ["v3.41.0", "test-abc1234", "latest", ""]) {
    assert.throws(() => parseArgs(["@stigmer/mcp-server", "--version", version]), /--version must be a release version/);
  }
  assert.throws(() => parseArgs(["@stigmer/mcp-server"]), /--version must be a release version/);
  assert.throws(() => parseArgs(["--version", "3.41.0"]), /name at least one package/);
  for (const minutes of ["0", "-1", "soon"]) {
    assert.throws(
      () => parseArgs(["@stigmer/mcp-server", "--version", "3.41.0", `--budget-minutes=${minutes}`]),
      /--budget-minutes must be a positive number/,
    );
  }
});

/** A fake clock and a registry that serves each name from a given time. */
function fakeWait(servedAtMs) {
  let clock = 0;
  const sleeps = [];
  return {
    sleeps,
    options: {
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
      log: () => {},
      runId: "1",
      gapOf: (name) => (clock >= (servedAtMs[name] ?? Infinity) ? null : "not listed in its install document"),
    },
  };
}

test("main returns at once when npm already serves the version, as after a green release", async () => {
  const wait = fakeWait({ "@stigmer/mcp-server": 0 });
  await main(["@stigmer/mcp-server", "--version", "3.41.0"], wait.options);
  assert.deepEqual(wait.sleeps, []);
});

test("main outlasts npm's 22-minute delay on v3.41.0 within the release budget", async () => {
  const wait = fakeWait({ "@stigmer/mcp-server": 22 * 60_000 });
  await main(["@stigmer/mcp-server", "--version", "3.41.0"], wait.options);
  assert.ok(wait.sleeps.reduce((a, b) => a + b, 0) >= 22 * 60_000);
});

test("main refuses at its budget with the lag and the rerun", async () => {
  const wait = fakeWait({});
  await assert.rejects(
    main(["@stigmer/mcp-server", "--version", "9.9.9", "--budget-minutes", "1"], wait.options),
    /^Error: @stigmer\/mcp-server@9\.9\.9 \(not listed in its install document\) .* after 1 minutes; the registry is lagging\. .*gh run rerun 1 --failed$/,
  );
  assert.equal(wait.sleeps.reduce((a, b) => a + b, 0), 60_000);
});
