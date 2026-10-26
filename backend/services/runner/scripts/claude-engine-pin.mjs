/**
 * The Claude engine pin a published runner carries beside its entry
 * (`claude-engine.json`), read by `src/activities/execute-claude/engine-home.ts`:
 * the Agent SDK's version and, for the SDK and every one of its platform
 * packages, the registry URL and the integrity npm's lockfile recorded.
 *
 * The lockfile is the pin's one home. `bundle-slim.mjs` writes the file from
 * it and `verify-slim-artifact.mjs` checks the artifact's copy equals it, so
 * an SDK upgrade is the lockfile bump alone, and a local runner downloads
 * exactly the bytes CI installed and tested.
 *
 * Node built-ins only: `verify-slim-artifact.mjs` runs from a mounted copy of
 * this directory inside the runner image.
 */

import { readFileSync } from "node:fs";

export const ENGINE_PIN_FILE = "claude-engine.json";
export const CLAUDE_SDK = "@anthropic-ai/claude-agent-sdk";

const TOP_LEVEL = "node_modules/";

/**
 * The pin npm's lockfile (`package-lock.json`, lockfileVersion 2 or 3) records
 * for the top-level SDK and its platform packages, with the packages sorted by
 * name. Throws when the lockfile has no SDK, a platform package the SDK names
 * is missing, an entry is at another version, or one lacks its URL or integrity.
 */
export function claudeEnginePin(lock) {
  const entries = lock?.packages ?? {};
  const sdk = entries[`${TOP_LEVEL}${CLAUDE_SDK}`];
  if (sdk === undefined) throw new Error(`the lockfile has no top-level ${CLAUDE_SDK}`);
  const names = [CLAUDE_SDK, ...Object.keys(sdk.optionalDependencies ?? {})].sort();
  const packages = {};
  for (const name of names) {
    const entry = entries[`${TOP_LEVEL}${name}`];
    if (entry === undefined) throw new Error(`the lockfile has no top-level ${name}, which ${CLAUDE_SDK} names`);
    if (entry.version !== sdk.version) throw new Error(`the lockfile holds ${name} ${entry.version}, not ${sdk.version}`);
    if (typeof entry.resolved !== "string" || typeof entry.integrity !== "string") {
      throw new Error(`the lockfile records no resolved URL or integrity for ${name}`);
    }
    packages[name] = { resolved: entry.resolved, integrity: entry.integrity };
  }
  return { version: sdk.version, packages };
}

/** The pin from the lockfile at `path`. */
export function claudeEnginePinFromLockfile(path) {
  return claudeEnginePin(JSON.parse(readFileSync(path, "utf8")));
}
