#!/usr/bin/env node

/**
 * Builds the slim distribution artifact for stigmer-server-ts — the entry
 * the CLI's npm package will ship and the daemon will launch
 * (STIGMER_SERVER_ENTRY, D2 §6 cutover mechanics).
 *
 * Deliberately simple next to the runner's bundle-slim.mjs: the server has
 * no native dependencies, no Temporal workflow sandbox, and no lazy-import
 * load-order constraints (those arrive with the Temporal worker
 * sub-projects, which will extend this script the way the runner's grew).
 * Today the whole service — ConnectRPC, protobuf, protovalidate, the
 * bundled registry JSON — compiles into one platform-independent main.js.
 *
 * Build with `npm run build` first; this consumes the compiled dist/.
 * Verify with `npm run verify:slim` (boots the bundle with plain node).
 */
import { build } from "esbuild";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(serverRoot, "dist");
const outDir = join(serverRoot, "dist-slim");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(distDir, "main.js")],
  outfile: join(outDir, "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Identifiers stay readable in stack traces; the external sourcemap
  // recovers file/line (runner precedent).
  minifyWhitespace: true,
  minifySyntax: true,
  minifyIdentifiers: false,
  sourcemap: "linked",
  logLevel: "warning",
});

// The module-type marker for `node main.js`: the bundle is ESM.
writeFileSync(
  join(outDir, "package.json"),
  JSON.stringify({ name: "@stigmer/server-slim", type: "module" }, null, 2) +
    "\n",
);

console.log("bundle-slim: dist-slim/main.js written");
