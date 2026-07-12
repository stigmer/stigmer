/**
 * Copies the built `@stigmer/embed` IIFE loader into `public/embed.js`,
 * where the Next static export (and `next dev`) serves it as
 * `<app-origin>/embed.js` — the one-line snippet's script URL.
 *
 * The loader must be served from the same origin as the hosted chat page:
 * `embed.js` derives the app origin from its own script URL (see
 * `sdk/embed/src/global.ts`), which is what makes the pasted snippet
 * zero-config for both cloud and self-hosted installs.
 *
 * Builds `@stigmer/embed` first when its dist is missing (fresh checkout,
 * `predev`), so neither developers nor CI need to remember an ordering.
 * `public/embed.js` is a build artifact and is gitignored.
 */

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const repoRoot = resolve(webRoot, "../..");
const require = createRequire(import.meta.url);

function resolveLoader(): string | null {
  try {
    // Resolved through the package export so it works both in the
    // workspace (symlinked) and against a published install.
    return require.resolve("@stigmer/embed/loader");
  } catch {
    return null;
  }
}

let loaderPath = resolveLoader();
if (!loaderPath || !existsSync(loaderPath)) {
  console.log("copy-embed-loader: @stigmer/embed dist missing — building it");
  execSync("npm run build -w @stigmer/embed", {
    cwd: repoRoot,
    stdio: "inherit",
  });
  loaderPath = resolveLoader();
}

if (!loaderPath || !existsSync(loaderPath)) {
  console.error(
    "copy-embed-loader: could not resolve @stigmer/embed/loader — " +
      "run `npm run build -w @stigmer/embed` from the repo root",
  );
  process.exit(1);
}

const target = join(webRoot, "public", "embed.js");
mkdirSync(dirname(target), { recursive: true });
copyFileSync(loaderPath, target);
console.log(`copy-embed-loader: ${loaderPath} -> ${target}`);
