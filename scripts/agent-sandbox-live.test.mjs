/**
 * Pins scripts/agent-sandbox-live.mjs's own decisions, without a cluster:
 * the arguments it takes and refuses, the manifest it applies for a version,
 * the address a pod reaches the host at, and that the release it tests
 * against is the one the operator guide tells operators to install.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  AGENT_SANDBOX_VERSION,
  DEFAULT_RUNNER_IMAGE,
  hostFromKindNetwork,
  manifestUrl,
  parseArgs,
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

test("the operator guide installs the release the driver is tested against", () => {
  const guide = readFileSync(new URL("../docs/guides/self-hosting/runners.mdx", import.meta.url), "utf8");
  assert.ok(
    guide.includes(manifestUrl(AGENT_SANDBOX_VERSION)),
    `runners.mdx must install ${manifestUrl(AGENT_SANDBOX_VERSION)}`,
  );
  assert.ok(guide.includes(`tested against agent-sandbox ${AGENT_SANDBOX_VERSION}`));
});
