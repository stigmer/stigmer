/**
 * Pins scripts/agent-sandbox-live.mjs's own decisions, without a cluster:
 * the arguments and environment it takes and refuses, the manifest it
 * applies for a version, the kind network's IPv4 gateway, the address a pod
 * reaches the host at, the one Temporal binds and the warning a laptop run
 * prints when that is every interface, whether a cluster is listed, who owns
 * the name after a failed create, what the teardown does with it, when a red
 * run is diagnosed, and that the release it tests against is the one the
 * operator guide tells operators to install.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AGENT_SANDBOX_VERSION,
  clusterListed,
  ownsAfterFailedCreate,
  shouldDiagnose,
  teardownAction,
  DEFAULT_RUNNER_IMAGE,
  exposureWarning,
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

test("Temporal binds the loopback on Docker Desktop, and every interface on Linux, where a gateway bind refuses itself", () => {
  assert.equal(temporalBindAddress("linux"), "0.0.0.0");
  assert.equal(temporalBindAddress("darwin"), "127.0.0.1");
  assert.equal(temporalBindAddress("win32"), "127.0.0.1");
});

test("a run that opens Temporal to every interface says so, except in CI and on Docker Desktop", () => {
  assert.match(exposureWarning("linux", {}) ?? "", /listens on every interface for this run, without authentication/);
  assert.equal(exposureWarning("linux", { CI: "true" }), undefined);
  assert.equal(exposureWarning("darwin", {}), undefined);
});

test("the operator guide installs the release the driver is tested against", () => {
  const guide = readFileSync(new URL("../docs/guides/self-hosting/runners.mdx", import.meta.url), "utf8");
  assert.ok(
    guide.includes(manifestUrl(AGENT_SANDBOX_VERSION)),
    `runners.mdx must install ${manifestUrl(AGENT_SANDBOX_VERSION)}`,
  );
  assert.ok(guide.includes(`tested against agent-sandbox ${AGENT_SANDBOX_VERSION}`));
});

test("a cluster is found by its exact name in kind's list", () => {
  assert.equal(clusterListed("kind\nstigmer-agent-sandbox-live\n", "stigmer-agent-sandbox-live"), true);
  assert.equal(clusterListed("stigmer-agent-sandbox-live\r\n", "stigmer-agent-sandbox-live"), true);
  assert.equal(clusterListed("stigmer-agent-sandbox-live-2\n", "stigmer-agent-sandbox-live"), false);
  assert.equal(clusterListed("No kind clusters found.\n", "stigmer-agent-sandbox-live"), false);
});

test("an interrupted create's leftovers are the run's; a name another run took after the check is not", () => {
  assert.equal(ownsAfterFailedCreate({ interrupted: true, listedNow: true }), true);
  assert.equal(ownsAfterFailedCreate({ interrupted: false, listedNow: false }), true);
  assert.equal(ownsAfterFailedCreate({ interrupted: false, listedNow: true }), false);
});

test("the teardown deletes only a name the run owns, and keeps it for --keep", () => {
  assert.equal(teardownAction({ owned: false, keep: false }), "none");
  assert.equal(teardownAction({ owned: false, keep: true }), "none");
  assert.equal(teardownAction({ owned: true, keep: true }), "keep");
  assert.equal(teardownAction({ owned: true, keep: false }), "delete");
});

test("a red run is diagnosed once its cluster answers, a setup step's included, but never after an interrupt", () => {
  assert.equal(shouldDiagnose({ ready: true, code: 1, interrupted: false }), true);
  assert.equal(shouldDiagnose({ ready: true, code: 2, interrupted: false }), true);
  assert.equal(shouldDiagnose({ ready: true, code: 0, interrupted: false }), false);
  assert.equal(shouldDiagnose({ ready: false, code: 2, interrupted: false }), false);
  assert.equal(shouldDiagnose({ ready: true, code: 2, interrupted: true }), false);
});
