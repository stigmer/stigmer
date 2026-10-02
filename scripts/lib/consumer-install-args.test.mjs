// Pins the consumer check's two npm install argument lists: each carries the
// gate's `--before` cutoff when one is given and nothing extra at release, so
// dropping the cutoff from either install fails here (stigmer/stigmer#1669).
// Run via `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { test } from "node:test";

import { consumerInstallArgs, tarballInstallArgs } from "./consumer-install-args.mjs";

const CUTOFF = ["--before=2026-10-02T11:00:00.000Z"];

test("the tarball install resolves for production into the staging prefix, with the cutoff when given", () => {
  assert.deepEqual(tarballInstallArgs("/w/pkg.tgz", "/w/staging", CUTOFF), [
    "install", "/w/pkg.tgz", "--prefix", "/w/staging", "--omit=dev",
    "--no-audit", "--no-fund", "--loglevel=error",
    "--before=2026-10-02T11:00:00.000Z",
  ]);
  assert.ok(!tarballInstallArgs("/w/pkg.tgz", "/w/staging", []).some((arg) => arg.startsWith("--before")), "a release resolves live");
});

test("the consumer's install carries the same cutoff, and nothing at release", () => {
  assert.deepEqual(consumerInstallArgs(CUTOFF), ["install", "--no-audit", "--no-fund", "--loglevel=error", "--before=2026-10-02T11:00:00.000Z"]);
  assert.deepEqual(consumerInstallArgs([]), ["install", "--no-audit", "--no-fund", "--loglevel=error"]);
});
