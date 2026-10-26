/**
 * Pins that installing the published runner never installs the Claude
 * engine: `@anthropic-ai/claude-agent-sdk` is a development dependency
 * (CI, a checkout and the image's build stage install it) and an optional
 * peer, which npm never installs for a consumer, never a dependency or an
 * optional dependency, which it would.
 *
 * Why it matters: the full `@stigmer/runner` package is published from this
 * manifest on every release (`scripts/publish-standalone.mjs`), and the
 * engine is 120 to 140 MB per platform that an install would pull for
 * people who may never run an agent on Claude. The slim artifact keeps it
 * out on its own (`scripts/bundle-slim.mjs` `NEVER_STAGED`, checked by
 * `scripts/verify-slim-artifact.mjs`) and carries its pin, which a local
 * runner downloads on its first Claude turn (`engine-fetch.ts`); this is
 * the same rule for the package, whose embedder installs the SDK beside it
 * when it wants Claude.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ENGINE = "@anthropic-ai/claude-agent-sdk";

interface Manifest {
  readonly dependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../../../package.json", import.meta.url)), "utf8")) as Manifest;

describe("the published runner and the Claude engine", () => {
  it("never names the engine where a consumer's install would fetch it", () => {
    expect(manifest.dependencies?.[ENGINE]).toBeUndefined();
    expect(manifest.optionalDependencies?.[ENGINE]).toBeUndefined();
  });

  it("names it as a development dependency and an optional peer, at one exact version", () => {
    const version = manifest.devDependencies?.[ENGINE];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.peerDependencies?.[ENGINE]).toBe(version);
    expect(manifest.peerDependenciesMeta?.[ENGINE]?.optional).toBe(true);
  });
});
