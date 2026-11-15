// The MCP server image installs the exact release its build names, and no
// other, and reports its health honestly in every transport. Run via
// `node --test scripts/mcp-server-dockerfile.test.mjs` (wired into root
// `npm test`).
//
// mcp-server/Dockerfile installs @stigmer/mcp-server from npm at the version
// in MCP_SERVER_VERSION. A default there goes stale and quietly installs an
// old release, and a dist-tag such as `latest` resolves at build time and
// lets Docker's layer cache reuse a stale install, so the argument has no
// default and the install step opens with a guard that refuses anything but
// X.Y.Z or X.Y.Z-<pre>. No lane builds this image on a pull request, so this
// test runs the guard's own shell, cut from the Dockerfile, against good and
// bad versions, and checks the release lane still passes the version.
//
// The image's default transport is stdio, where nothing listens on a port, so
// a health check that always probes HTTP calls every stdio container
// unhealthy. The HEALTHCHECK's shell is run the same way: with a stub `wget`
// on PATH that records the URL it was asked for, under every transport the
// server accepts, so a stdio container is healthy without a probe and an HTTP
// one is probed on the port it was configured with.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  "0.1.3\nlatest",
  "latest\n0.1.3",
  "0.1.3\n",
]) {
  test(`the guard refuses ${JSON.stringify(version)} with one message naming the flag`, () => {
    const result = runGuard(version);
    assert.notEqual(result.status, 0);
    // One echo: the message spans only the lines the value itself carries.
    assert.equal(
      result.stderr.split("\n").length - 1,
      version.split("\n").length,
      result.stderr,
    );
    assert.match(result.stderr, /not a release version/);
    assert.match(result.stderr, /--build-arg MCP_SERVER_VERSION=<release>/);
  });
}

test("the release lane passes the version it published", () => {
  assert.match(
    RELEASE_LANE,
    /--file mcp-server\/Dockerfile[\s\S]*--build-arg MCP_SERVER_VERSION="\$NPM_VERSION"/,
  );
});

/** The shell Docker runs for the image's HEALTHCHECK (`CMD <string>` runs under `/bin/sh -c`). */
function healthCheck() {
  const check = instructions(DOCKERFILE).find((line) =>
    line.startsWith("HEALTHCHECK "),
  );
  assert.ok(check, "mcp-server/Dockerfile has no HEALTHCHECK");
  const cmd = check.indexOf(" CMD ");
  assert.ok(cmd > 0, "the HEALTHCHECK has no CMD");
  const shell = check.slice(cmd + " CMD ".length).trim();
  assert.ok(!shell.startsWith("["), "the HEALTHCHECK CMD must be a shell string");
  return shell;
}

/**
 * Runs the health check with the given environment and a stub `wget` that
 * appends its arguments to a log and exits with `wgetStatus`. Returns the
 * check's exit status and the wget calls it made.
 */
function runHealthCheck(env, wgetStatus = 0) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-healthcheck-"));
  try {
    const log = join(dir, "wget.log");
    const stub = join(dir, "wget");
    writeFileSync(
      stub,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexit ${wgetStatus}\n`,
    );
    chmodSync(stub, 0o755);
    const result = spawnSync("/bin/sh", ["-c", healthCheck()], {
      env: { PATH: `${dir}:${process.env.PATH}`, ...env },
      encoding: "utf8",
    });
    let calls = [];
    try {
      calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    } catch {
      calls = [];
    }
    return { status: result.status, calls, stderr: result.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const [name, env] of [
  ["unset", {}],
  ["empty", { STIGMER_MCP_TRANSPORT: "" }],
  ["stdio", { STIGMER_MCP_TRANSPORT: "stdio" }],
  ["STDIO", { STIGMER_MCP_TRANSPORT: "STDIO" }],
]) {
  test(`the health check passes without probing when the transport is ${name}`, () => {
    // wget would fail if it were called: nothing listens under stdio.
    const result = runHealthCheck(env, 1);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, []);
  });
}

for (const transport of ["http", "both", "HTTP"]) {
  test(`the health check probes /health on the default port when the transport is ${transport}`, () => {
    const result = runHealthCheck({ STIGMER_MCP_TRANSPORT: transport });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.calls.length, 1);
    assert.match(result.calls[0], /http:\/\/localhost:8080\/health(\s|$)/);
  });
}

test("the health check probes the configured STIGMER_MCP_HTTP_PORT", () => {
  const result = runHealthCheck({
    STIGMER_MCP_TRANSPORT: "http",
    STIGMER_MCP_HTTP_PORT: "9090",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0], /http:\/\/localhost:9090\/health(\s|$)/);
});

test("the health check treats an empty STIGMER_MCP_HTTP_PORT as the default", () => {
  const result = runHealthCheck({
    STIGMER_MCP_TRANSPORT: "http",
    STIGMER_MCP_HTTP_PORT: "",
  });
  assert.equal(result.calls.length, 1);
  assert.match(result.calls[0], /http:\/\/localhost:8080\/health(\s|$)/);
});

test("the health check fails when the HTTP probe fails", () => {
  const result = runHealthCheck({ STIGMER_MCP_TRANSPORT: "both" }, 4);
  assert.equal(result.status, 1);
  assert.equal(result.calls.length, 1);
});
