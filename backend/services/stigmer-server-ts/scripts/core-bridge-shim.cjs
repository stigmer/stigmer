/**
 * Bundled in place of `@temporalio/core-bridge` by scripts/bundle-slim.mjs
 * (the runner's core-bridge-shim.cjs pattern, adapted for the server's own
 * platform packages).
 *
 * Upstream core-bridge ships native libraries for all five platforms in one
 * npm package (~120 MB). The slim artifact instead carries ONE platform's
 * pruned copy inside `@stigmer/server-slim-<platform>` (e.g.
 * server-slim-darwin-arm64; published as npm optionalDependencies, or staged
 * into node_modules for directory-style embedding — both layouts resolve
 * identically from here).
 *
 * The server deliberately does NOT reuse `@stigmer/runner-slim-<platform>`:
 * sharing native packages would couple the two artifacts' @temporalio
 * version bumps forever (owner ruling, sub-project 20260825.07 T01).
 *
 * The dynamic require is intentional: esbuild leaves it as a runtime lookup,
 * which is exactly what platform dispatch needs.
 */

const platformPackage = `@stigmer/server-slim-${process.platform}-${process.arch}`;

let bridge;
try {
  bridge = require(platformPackage);
} catch (err) {
  throw new Error(
    `Failed to load the Temporal native bridge from ${platformPackage}. ` +
      `Either ${process.platform}-${process.arch} is an unsupported platform, or the slim ` +
      `server artifact was staged without its platform package. ` +
      `Original error: ${err && err.message}`,
  );
}

module.exports = bridge;
