/**
 * Pins scripts/agent-sandbox-live.mjs's own decisions, without a cluster:
 * the arguments and environment it takes and refuses, the manifest it
 * applies for a version, the kind network's IPv4 gateway, the address a pod
 * reaches the host at and the one Temporal binds (never every interface),
 * and that the release it tests
 * against is the one the operator guide tells operators to install.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AGENT_SANDBOX_VERSION,
  DEFAULT_RUNNER_IMAGE,
  hostFromKindNetwork,
  ipv4Gateway,
  manifestUrl,
  parseArgs,
  temporalBindAddress,
} from "./agent-sandbox-live.mjs";

test("the defaults are the pinned release and the published runner image", () => {
  assert.deepEqual(parseArgs([]), {
    version: AGENT_SANDBOX_VERSION,
    runnerImage: DEFAULT_RUNNER_IMAGE,
    keep: false,
  });
});

test("a version, latest, an image and --keep are taken", () => {
  assert.deepEqual(parseArgs(["--agent-sandbox-version", "v1.2.3", "--runner-image", "runner:dev", "--keep"]), {
    version: "v1.2.3",
    runnerImage: "runner:dev",
    keep: true,
  });
  assert.equal(parseArgs(["--agent-sandbox-version", "latest"]).version, "latest");
});

test("the environment stands in for the flags when set, and a flag wins over it", () => {
  assert.deepEqual(parseArgs([], { AGENT_SANDBOX_VERSION: "latest", RUNNER_IMAGE: "runner:env" }), {
    version: "latest",
    runnerImage: "runner:env",
    keep: false,
  });
  assert.equal(parseArgs([], { AGENT_SANDBOX_VERSION: "", RUNNER_IMAGE: "" }).version, AGENT_SANDBOX_VERSION);
  assert.equal(parseArgs(["--agent-sandbox-version", "v2.0.0"], { AGENT_SANDBOX_VERSION: "latest" }).version, "v2.0.0");
  assert.throws(() => parseArgs([], { AGENT_SANDBOX_VERSION: "v1;touch /tmp/x" }), /takes vX\.Y\.Z or latest/);
});

test("a malformed version, an empty image and an unknown argument are refused", () => {
  assert.throws(() => parseArgs(["--agent-sandbox-version", "1.0.5"]), /takes vX\.Y\.Z or latest, not '1\.0\.5'/);
  assert.throws(() => parseArgs(["--agent-sandbox-version"]), /takes vX\.Y\.Z or latest, not ''/);
  assert.throws(() => parseArgs(["--runner-image"]), /--runner-image needs an image/);
  assert.throws(() => parseArgs(["--kep"]), /unknown argument '--kep'/);
});

test("the manifest is the release's core sandbox.yaml", () => {
  assert.equal(
    manifestUrl("v1.0.5"),
    "https://github.com/kubernetes-sigs/agent-sandbox/releases/download/v1.0.5/sandbox.yaml",
  );
});

test("a pod reaches the host at the kind network's gateway on Linux, at host.docker.internal on Docker Desktop", () => {
  assert.equal(hostFromKindNetwork("linux", "172.18.0.1"), "172.18.0.1");
  assert.equal(hostFromKindNetwork("darwin", "172.18.0.1"), "host.docker.internal");
  assert.equal(hostFromKindNetwork("win32", "172.18.0.1"), "host.docker.internal");
});

test("the kind network's IPv4 gateway is found whichever subnet is listed first, and none is refused", () => {
  assert.equal(ipv4Gateway("fc00:f853:ccd:e793::1 172.18.0.1 "), "172.18.0.1");
  assert.equal(ipv4Gateway("172.18.0.1 fc00:f853:ccd:e793::1 "), "172.18.0.1");
  assert.throws(() => ipv4Gateway("fc00:f853:ccd:e793::1 "), /the kind network has no IPv4 gateway \(gateways: 'fc00:f853:ccd:e793::1'\)/);
});

test("Temporal binds only where a pod reaches the host, never every interface", () => {
  assert.equal(temporalBindAddress("linux", "172.18.0.1"), "172.18.0.1");
  assert.equal(temporalBindAddress("darwin", "172.18.0.1"), "127.0.0.1");
  assert.equal(temporalBindAddress("win32", "172.18.0.1"), "127.0.0.1");
});

test("the operator guide installs the release the driver is tested against", () => {
  const guide = readFileSync(new URL("../docs/guides/self-hosting/runners.mdx", import.meta.url), "utf8");
  assert.ok(
    guide.includes(manifestUrl(AGENT_SANDBOX_VERSION)),
    `runners.mdx must install ${manifestUrl(AGENT_SANDBOX_VERSION)}`,
  );
  assert.ok(guide.includes(`tested against agent-sandbox ${AGENT_SANDBOX_VERSION}`));
});
