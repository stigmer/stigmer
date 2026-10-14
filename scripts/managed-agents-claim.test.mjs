// Stigmer's Claude Managed Agents claim names one beta version and one exact
// `@anthropic-ai/sdk` release, and every copy of either says the same.
// Run via `node --test scripts/managed-agents-claim.test.mjs` (wired into root `npm run test:root`).
//
// The claim ("compatible with managed-agents-<date>, as typed by
// @anthropic-ai/sdk <version>") is proved by tests that run the SDK at an
// exact pin: session-log's shape test and the conformance suites that drive
// the server's Managed Agents lane. The version is copied into the packages
// that pin it, the lockfile that resolves it, the docs that state it and the
// lane that serves it, and nothing else holds those copies equal, so a pin
// could move (a dependency bot, a hand edit) while the docs went on claiming
// the old one. This test fails, naming the copy, unless every one agrees,
// so the claim moves only by one deliberate bump that reruns the suites.
// The runner's own SDK pin, for its model calls, is not a copy of the claim
// and is not read.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SDK = "@anthropic-ai/sdk";

/** The packages whose exact devDependency pin is the claim's SDK version. */
export const PINNING_MANIFESTS = [
  "backend/libs/ts/session-log/package.json",
  "test/conformance/package.json",
];

/** The documents that state the claim, each naming both versions. */
export const CLAIM_DOCUMENTS = [
  "apis/ai/stigmer/agentic/session/docs/README.md",
  "docs/sdk/managed-agents.mdx",
];

/** The lane's served version (the server source that owns the beta string). */
export const LANE_VERSION_MODULE =
  "backend/services/stigmer-server/src/transport/managed-agents/version.ts";

const read = (path) => readFileSync(join(ROOT, path), "utf8");

/** The beta version the lane serves, from its one constant. */
export function laneVersion(source) {
  const match = source.match(/MANAGED_AGENTS_VERSION\s*=\s*"(managed-agents-\d{4}-\d{2}-\d{2})"/);
  return match?.[1];
}

/** Every Managed Agents beta version a document names. */
export function betaVersionsIn(text) {
  return [...text.matchAll(/managed-agents-\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]);
}

/** Every SDK version a document names beside the package (`@anthropic-ai/sdk` 0.1.2, or @0.1.2). */
export function sdkVersionsIn(text) {
  return [...text.matchAll(/@anthropic-ai\/sdk`?(?:@|\s+)v?(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
}

const pinned = JSON.parse(read(PINNING_MANIFESTS[0])).devDependencies?.[SDK];
const version = laneVersion(read(LANE_VERSION_MODULE));

test("the claim's SDK pin is one exact version", () => {
  assert.match(pinned ?? "", /^\d+\.\d+\.\d+$/, `${PINNING_MANIFESTS[0]} pins ${SDK} to an exact version`);
});

test("the lane serves one dated Managed Agents version", () => {
  assert.ok(version, `${LANE_VERSION_MODULE} declares MANAGED_AGENTS_VERSION`);
});

for (const manifest of PINNING_MANIFESTS) {
  test(`${manifest} pins ${SDK} ${pinned}`, () => {
    assert.equal(JSON.parse(read(manifest)).devDependencies?.[SDK], pinned);
  });
}

test(`the root lockfile resolves ${SDK} ${pinned}`, () => {
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(lock.packages?.[`node_modules/${SDK}`]?.version, pinned);
});

for (const document of CLAIM_DOCUMENTS) {
  test(`${document} claims ${version} at ${SDK} ${pinned}`, () => {
    const text = read(document);
    const betas = betaVersionsIn(text);
    const sdks = sdkVersionsIn(text);
    assert.ok(betas.length > 0, `${document} names the Managed Agents version`);
    assert.ok(sdks.length > 0, `${document} names the SDK version`);
    assert.deepEqual([...new Set(betas)], [version], `${document} names only ${version}`);
    assert.deepEqual([...new Set(sdks)], [pinned], `${document} names only ${SDK} ${pinned}`);
  });
}

test("the readers find what a claim sentence writes", () => {
  const sentence =
    "compatible with Claude Managed Agents `managed-agents-2026-04-01`, as typed by `@anthropic-ai/sdk` 0.131.0; install @anthropic-ai/sdk@0.131.0";
  assert.deepEqual(betaVersionsIn(sentence), ["managed-agents-2026-04-01"]);
  assert.deepEqual(sdkVersionsIn(sentence), ["0.131.0", "0.131.0"]);
  assert.equal(laneVersion('export const MANAGED_AGENTS_VERSION = "managed-agents-2026-04-01";'), "managed-agents-2026-04-01");
});
