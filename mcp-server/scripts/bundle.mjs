#!/usr/bin/env node

/**
 * Bundles the mcp-server-stigmer bin into a self-contained single file.
 *
 * Why this exists: @stigmer/mcp-server's dependency @stigmer/sdk is authored for
 * bundlers (extensionless relative imports), so a plain `tsc` build cannot run
 * under a bare `node` / `npx` / Docker — it would try to import the
 * non-runnable SDK at runtime. Bundling inlines the SDK (and the rest of the
 * dependency tree) into one file that runs under a bare Node. Mirrors the
 * approach @stigmer/runner takes for its slim artifact
 * (backend/services/runner/scripts/bundle-slim.mjs), scaled down to a pure-JS
 * server with no native modules.
 *
 * Run after `tsc` (it consumes the compiled dist/). Only the executable bin is
 * bundled; the library entry (dist/index.js, the "." export) is intentionally
 * left as the tsc output for bundler consumers.
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
