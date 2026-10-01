// Pins which artifacts make a release an install's upgrade base
// (scripts/lib/published-release.mjs): the images, the all-in-one image, the
// chart and the CLI's packages each install pulls, under the tags the
// release pushes them with; that a 404 manifest or a version npm does not
// list is "not published" while every other answer throws, so an outage
// never moves a base; and that the first missing artifact is the one named.
// The registries are fakes. Run via `npm run test:scripts`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CLI_PACKAGES, npmPublished, ociPublished, releaseArtifacts, unpublishedArtifact } from "./published-release.mjs";

test("each install pulls its own artifacts, images at v<version> and the chart at <version>", () => {
  const images = ["ghcr.io/stigmer/stigmer-server:v3.41.0", "ghcr.io/stigmer/stigmer-runner:v3.41.0"];
  assert.deepEqual(releaseArtifacts("compose", "3.41.0"), { oci: images, npm: [] });
  assert.deepEqual(releaseArtifacts("all-in-one", "3.41.0"), { oci: ["ghcr.io/stigmer/stigmer:v3.41.0"], npm: [] });
  assert.deepEqual(releaseArtifacts("helm", "3.41.0"), { oci: ["ghcr.io/stigmer/charts/stigmer:3.41.0", ...images], npm: [] });
  assert.deepEqual(releaseArtifacts("cli", "3.41.0"), { oci: [], npm: [...CLI_PACKAGES] });
  assert.throws(() => releaseArtifacts("desktop", "3.41.0"), /no published artifacts are known for "desktop"/);
});

/** A ghcr.io that hands out a token, then answers the manifest HEAD with `status`. */
function registry(status, { tokenStatus = 200 } = {}) {
  const asked = [];
  const fetchImpl = async (url, init = {}) => {
    asked.push({ url: String(url), method: init.method ?? "GET", authorization: init.headers?.authorization });
    if (String(url).startsWith("https://ghcr.io/token")) {
      return new Response(JSON.stringify({ token: "anon" }), { status: tokenStatus });
    }
    return new Response(null, { status });
  };
  return { fetchImpl, asked };
}

test("a manifest that answers is published, with the anonymous token on the HEAD", async () => {
  const { fetchImpl, asked } = registry(200);
  assert.equal(await ociPublished("ghcr.io/stigmer/charts/stigmer:3.41.0", { fetchImpl }), true);
  assert.deepEqual(asked, [
    { url: "https://ghcr.io/token?scope=repository:stigmer/charts/stigmer:pull", method: "GET", authorization: undefined },
    { url: "https://ghcr.io/v2/stigmer/charts/stigmer/manifests/3.41.0", method: "HEAD", authorization: "Bearer anon" },
  ]);
});

test("a 404 manifest is not published; any other answer, a refused token or a bad reference throws", async () => {
  assert.equal(await ociPublished("ghcr.io/stigmer/stigmer:v3.41.0", registry(404)), false);
  await assert.rejects(ociPublished("ghcr.io/stigmer/stigmer:v3.41.0", registry(503)), /ghcr\.io answered HTTP 503 for ghcr\.io\/stigmer\/stigmer:v3\.41\.0/);
  await assert.rejects(ociPublished("ghcr.io/stigmer/stigmer:v3.41.0", registry(200, { tokenStatus: 401 })), /refused an anonymous token .*HTTP 401/);
  await assert.rejects(ociPublished("docker.io/library/postgres:16", registry(200)), /not a ghcr\.io image reference/);
});

test("npm's answer: installable is published, an unlisted version is not, any other gap throws", async () => {
  assert.equal(await npmPublished("@stigmer/cli", "3.41.0", { gapOf: async () => null }), true);
  assert.equal(await npmPublished("@stigmer/cli", "3.42.0", { gapOf: async () => "not listed in its install document" }), false);
  await assert.rejects(
    npmPublished("@stigmer/cli", "3.42.0", { gapOf: async () => "registry unreachable: ENOTFOUND" }),
    /npm cannot say whether @stigmer\/cli@3\.42\.0 is published: registry unreachable: ENOTFOUND/,
  );
});

test("the first unpublished artifact is named, images before packages; none means the release is a base", async () => {
  const oci = async (reference) => !reference.includes("charts");
  const npm = async (name) => name !== "@stigmer/runner-slim";
  assert.equal(await unpublishedArtifact("helm", "3.41.0", { oci, npm }), "ghcr.io/stigmer/charts/stigmer:3.41.0");
  assert.equal(await unpublishedArtifact("cli", "3.41.0", { oci, npm }), "@stigmer/runner-slim@3.41.0");
  assert.equal(await unpublishedArtifact("compose", "3.41.0", { oci, npm }), undefined);
});
