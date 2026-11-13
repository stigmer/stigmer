// The MCP server image installs the exact release its build names, and no
// other. Run via `node --test scripts/mcp-server-dockerfile.test.mjs` (wired
// into root `npm test`).
//
// mcp-server/Dockerfile installs @stigmer/mcp-server from npm at the version
// in MCP_SERVER_VERSION. A default there goes stale and quietly installs an
// old release, and a dist-tag such as `latest` resolves at build time and
// lets Docker's layer cache reuse a stale install, so the argument has no
// default and the install step opens with a guard that refuses anything but
// X.Y.Z or X.Y.Z-<pre>. No lane builds this image on a pull request, so this
// test runs the guard's own shell, cut from the Dockerfile, against good and
// bad versions, and checks the release lane still passes the version.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCKERFILE = readFileSync(resolve(ROOT, "mcp-server/Dockerfile"), "utf8");
const RELEASE_LANE = readFileSync(
  resolve(ROOT, ".github/workflows/release.mcp-server.yaml"),
  "utf8",
);

/** The Dockerfile's instructions, each with its continuation lines joined. */
function instructions(text) {
  return text
    .replace(/\\\n/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/** The shell of the RUN instruction that installs the package, before its install loop. */
function versionGuard() {
  const install = instructions(DOCKERFILE).find(
    (line) => line.startsWith("RUN ") && line.includes("@stigmer/mcp-server@"),
  );
  assert.ok(
    install,
    "mcp-server/Dockerfile has no RUN that installs @stigmer/mcp-server",
  );
  const loop = install.indexOf("for i in");
  assert.ok(loop > 0, "the install RUN has no guard before its install loop");
  return install.slice("RUN ".length, loop).replace(/;\s*$/, "");
}

/** Runs the guard as Docker's shell would, with the build argument in the environment. */
function runGuard(version) {
  return spawnSync("/bin/sh", ["-c", versionGuard()], {
    env: { PATH: process.env.PATH, MCP_SERVER_VERSION: version },
    encoding: "utf8",
  });
}

test("MCP_SERVER_VERSION has no default, so every build names its release", () => {
  const args = instructions(DOCKERFILE).filter((line) =>
    /^ARG\s+MCP_SERVER_VERSION\b/.test(line),
  );
  assert.deepEqual(args, ["ARG MCP_SERVER_VERSION"]);
});

for (const version of [
  "0.1.3",
  "12.40.7",
  "0.1.4-rc.1",
  "3.42.0-dev.20261113.abc1234",
]) {
  test(`the guard lets the release version ${version} through`, () => {
    const result = runGuard(version);
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const version of [
  "",
  "latest",
  "next",
  "v0.1.3",
  "0.1",
  "0.1.3 ",
  "^0.1.3",
  "0.1.x",
]) {
  test(`the guard refuses ${JSON.stringify(version)} with one line naming the flag`, () => {
    const result = runGuard(version);
    assert.notEqual(result.status, 0);
    const lines = result.stderr.trim().split("\n");
    assert.equal(lines.length, 1, result.stderr);
    assert.match(lines[0], /not a release version/);
    assert.match(lines[0], /--build-arg MCP_SERVER_VERSION=<release>/);
  });
}

test("the release lane passes the version it published", () => {
  assert.match(
    RELEASE_LANE,
    /--file mcp-server\/Dockerfile[\s\S]*--build-arg MCP_SERVER_VERSION="\$NPM_VERSION"/,
  );
});
