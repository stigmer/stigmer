#!/usr/bin/env node

/**
 * Bundles the mcp-server-stigmer bin into a self-contained single file.
 *
 * Why this exists: the bin once had to inline @stigmer/sdk, which was authored
 * for bundlers (extensionless relative imports) and could not run under a bare
 * `node` / `npx` / Docker. The published SDK now runs under plain Node (its
 * node entry carries explicit extensions), and hosts import the library entry
 * (dist/index.js, the "." export) unbundled; the bin stays one self-contained
 * file, so `npx` and the image start it without resolving a dependency tree.
 * Mirrors the approach @stigmer/runner takes for its slim artifact
 * (backend/services/runner/scripts/bundle-slim.mjs), scaled down to a pure-JS
 * server with no native modules.
 *
 * Run after `tsc` (it consumes the compiled dist/). Only the executable bin is
 * bundled; the library entry is left as the tsc output.
 */

import { build } from "esbuild";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "dist", "cli", "mcp-server-stigmer.js");
const tmpPath = join(root, "dist", "cli", "mcp-server-stigmer.bundle.js");

// CJS dependencies bundled into an ESM output need a `require`; provide one
// bound to the bundle's own URL. (import.meta.url is native in ESM output.)
const ESM_BANNER = `import { createRequire as __stigmerCreateRequire } from "node:module";
const require = __stigmerCreateRequire(import.meta.url);`;

await build({
  entryPoints: [binPath],
  outfile: tmpPath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Whitespace/syntax minified for size; identifiers kept so stack traces and
  // `node --inspect` stay readable (same choice as the runner's slim bundle).
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  banner: { js: ESM_BANNER },
  logLevel: "warning",
});

await rename(tmpPath, binPath);
console.log("Bundled dist/cli/mcp-server-stigmer.js (self-contained)");
