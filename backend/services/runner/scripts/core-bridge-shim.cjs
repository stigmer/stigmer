/**
 * Bundled in place of `@temporalio/core-bridge` by scripts/bundle-slim.mjs.
 *
 * Upstream core-bridge ships native libraries for all five platforms in one
 * npm package (~120 MB). The slim artifact instead carries ONE platform's
 * pruned copy inside `@stigmer/runner-slim-<platform>-<arch>` (published as
 * npm optionalDependencies, or staged into node_modules for directory-style
 * embedding — both layouts resolve identically from here).
 *
 * The dynamic require is intentional: esbuild leaves it as a runtime lookup,
 * which is exactly what platform dispatch needs.
 */

const platformPackage = `@stigmer/runner-slim-${process.platform}-${process.arch}`;

let bridge;
try {
  bridge = require(platformPackage);
} catch (err) {
  throw new Error(
    `Failed to load the Temporal native bridge from ${platformPackage}. ` +
      `Either ${process.platform}-${process.arch} is an unsupported platform, or the slim ` +
      `runner artifact was staged without its platform package. ` +
      `Original error: ${err && err.message}`,
  );
}

module.exports = bridge;
