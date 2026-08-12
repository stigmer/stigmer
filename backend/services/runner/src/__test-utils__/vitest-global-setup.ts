/**
 * Vitest globalSetup: refuse to run the suite on a Node that cannot run the
 * runner.
 *
 * Why this exists: the durable checkpointer imports Node's built-in
 * `node:sqlite` at module load time, so on a Node without it (below 22.13,
 * or 23.0–23.3 — the 23.x line only gained it unflagged in 23.4) the
 * sqlite-importing test files die at COLLECTION with a raw
 * `ERR_UNKNOWN_BUILTIN_MODULE` while the rest of the suite grinds on
 * (oss#257). globalSetup runs once in the main process before any file is
 * collected, so the whole run fails immediately with the same actionable
 * message the runner itself prints at boot (src/preflight.ts).
 *
 * Deliberately fails the WHOLE suite rather than skipping the sqlite tests:
 * a Node that cannot load `node:sqlite` cannot run the runner at all, and a
 * green-with-skips suite on such a Node would be a false signal. The gate is
 * a capability probe, not a version check — on Nodes where the builtin is
 * flag-gated (22.5–22.12, 23.0–23.3), `NODE_OPTIONS=--experimental-sqlite`
 * satisfies the probe and the suite runs (vitest workers inherit
 * NODE_OPTIONS, so the flag reaches every fork).
 *
 * Lives in src/__test-utils__/ so `tsc --noEmit` covers it (the dev tsconfig
 * only includes src/) while tsconfig.build.json's exclusion keeps it out of
 * dist/.
 */

import { preflightNodeRuntime } from "../preflight.js";

/**
 * Throw an actionable error when this Node cannot run the runner (and hence
 * its test suite). The preflight message is reused verbatim — single source
 * of the diagnosis, contract pinned by __tests__/preflight.test.ts — with a
 * test-context fix hint appended (the check-runner-node Makefile idiom).
 */
export function assertNodeCanRunSuite(
  preflight: () => string | null = preflightNodeRuntime,
): void {
  const failure = preflight();
  if (failure === null) return;
  throw new Error(
    `${failure}\n` +
      `  fix: nvm use (the repo's .nvmrc pins a supported Node), or on a Node\n` +
      `  where node:sqlite is flag-gated (22.5-22.12, 23.0-23.3) run the suite\n` +
      `  with NODE_OPTIONS=--experimental-sqlite.`,
  );
}

export default function globalSetup(): void {
  assertNodeCanRunSuite();
}
