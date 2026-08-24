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

// The ldflags equivalent (D4 #13): release lanes export these env vars and
// the defines stamp them into their fallback chains
// (src/domain/platform/version.ts, boot/config.ts's bundled GitHub OAuth
// defaults). Unset keeps each source default — exactly Go's unstamped
// build.
const defineFromEnv = (identifier, envName) => ({
  [identifier]:
    process.env[envName] !== undefined && process.env[envName] !== ""
      ? JSON.stringify(process.env[envName])
      : "undefined",
});
const versionDefine = {
  ...defineFromEnv("__STIGMER_SERVER_VERSION__", "STIGMER_SERVER_VERSION"),
  ...defineFromEnv("__STIGMER_GITHUB_CLIENT_ID__", "STIGMER_GITHUB_CLIENT_ID"),
  ...defineFromEnv(
    "__STIGMER_GITHUB_CLIENT_SECRET__",
    "STIGMER_GITHUB_CLIENT_SECRET",
  ),
};

await build({
  entryPoints: [join(distDir, "main.js")],
  outfile: join(outDir, "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  define: versionDefine,
  // The AWS SDK (the R2 driver, D4 #13) is CommonJS; bundled into ESM its
  // internal require() calls hit esbuild's throwing __require stub unless a
  // real require exists at top level. The banner installs one via
  // createRequire — the canonical esbuild recipe for CJS deps in an ESM
  // bundle (verified by `npm run verify:slim`, which caught the failure).
  banner: {
    js:
      'import { createRequire as __stigmerCreateRequire } from "node:module";' +
      "const require = __stigmerCreateRequire(import.meta.url);",
  },
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
