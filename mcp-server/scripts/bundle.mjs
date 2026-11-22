#!/usr/bin/env node

/**
 * Bundles the mcp-server-stigmer bin into a self-contained single file.
 *
 * Why this exists: the bin once had to inline @stigmer/client, which was authored
 * for bundlers (extensionless relative imports) and could not run under a bare
 * `node` / `npx` / Docker. The published SDK now runs under plain Node (its
 * node entry carries explicit extensions), and hosts import the library entry
 * (dist/index.js, the "." export) unbundled; the bin stays one self-contained
 * file, so `npx` and the image start it without resolving a dependency tree.
 * Mirrors the approach @stigmer/runner takes for its slim artifact
 * (backend/services/runner/scripts/bundle-slim.mjs), scaled down to a pure-JS
 * server with no native modules.
 *
 * Run after `tsc` (it consumes the compiled dist/). Two files are bundled:
 *
 *   - the executable bin, dist/cli/mcp-server-stigmer.js;
 *   - the HTTP entry, dist/http.js (`@stigmer/mcp-server/http`): the mountable
 *     handler for a host that loads this package unbundled under plain Node.
 *     In this repository the "." export and @stigmer/client's are TypeScript
 *     source, which only a bundler or tsx can load, so this file carries the
 *     client, the API stubs and the MCP SDK inside it. Its declaration file is
 *     tsc's, and names only Node's types (src/http.ts says why).
 *
 * The library entry (dist/index.js, the published "." export) is left as the
 * tsc output.
 */

import { build } from "esbuild";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const binPath = join(root, "dist", "cli", "mcp-server-stigmer.js");
const httpPath = join(root, "dist", "http.js");

// CJS dependencies bundled into an ESM output need a `require`; provide one
// bound to the bundle's own URL. (import.meta.url is native in ESM output.)
const ESM_BANNER = `import { createRequire as __stigmerCreateRequire } from "node:module";
const require = __stigmerCreateRequire(import.meta.url);`;

/** Bundle the tsc output at `path` into one self-contained file, in place. */
async function bundleInPlace(path) {
  const tmp = path.replace(/\.js$/, ".bundle.js");
  await build({
    entryPoints: [path],
    outfile: tmp,
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
  await rename(tmp, path);
}

await bundleInPlace(binPath);
console.log("Bundled dist/cli/mcp-server-stigmer.js (self-contained)");
await bundleInPlace(httpPath);
console.log("Bundled dist/http.js (self-contained)");
