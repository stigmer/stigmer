/**
 * Builds the kit's gallery into the site, for the docs' live demos.
 *
 * The gallery is the visual suite's page (test/visual): every part of the
 * React kit drawn from fixed data by the code its screenshot check
 * approves. Its docs mode, which the site frames with `<Live>` and
 * `<ThemePlayground>`, is the same build, so this runs the suite's own Vite
 * build with the site's path (`/gallery/`) as its base and `public/gallery`
 * as its output. `next build` and `next dev` then serve it as a static
 * folder.
 *
 * The folder is build output, ignored by git: the gallery's source is the
 * one copy, and every build writes it again.
 *
 * Usage: tsx scripts/generate-gallery.ts
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_BASE } from "../src/lib/live";

const SITE = fileURLToPath(new URL("../", import.meta.url));
const ROOT = path.resolve(SITE, "..");
const GALLERY = path.join(ROOT, "test/visual");
const OUT = path.join(SITE, "public", LIVE_BASE.replaceAll("/", ""));
const VITE = path.join(ROOT, "node_modules/.bin/vite");

if (!existsSync(VITE)) {
  throw new Error(`no Vite at ${VITE}: the gallery builds from the repository's workspace; run \`npm ci\` at the root first`);
}

const result = spawnSync(VITE, ["build", "--base", LIVE_BASE, "--outDir", OUT, "--emptyOutDir", "--logLevel", "warn"], {
  cwd: GALLERY,
  stdio: "inherit",
});
if (result.status !== 0) throw new Error(`the gallery's build failed (exit ${result.status ?? result.signal})`);
console.log(`gallery: built into ${path.relative(SITE, OUT)}/ for the docs' live demos`);
