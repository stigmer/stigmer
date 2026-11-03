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

/** The build this runs: the workspace's Vite, its arguments, where it runs and where it writes. */
export interface GalleryBuild {
  readonly vite: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly out: string;
}

/** The gallery's build for the site whose folder is `site`. */
export function galleryBuild(site: string): GalleryBuild {
  const root = path.resolve(site, "..");
  const out = path.join(site, "public", LIVE_BASE.replaceAll("/", ""));
  return {
    vite: path.join(root, "node_modules/.bin/vite"),
    args: ["build", "--base", LIVE_BASE, "--outDir", out, "--emptyOutDir", "--logLevel", "warn"],
    cwd: path.join(root, "test/visual"),
    out,
  };
}

/** Runs `build`; throws when the workspace has no Vite or the build fails. */
function run(build: GalleryBuild): void {
  if (!existsSync(build.vite)) {
    throw new Error(`no Vite at ${build.vite}: the gallery builds from the repository's workspace; run \`npm ci\` at the root first`);
  }
  const result = spawnSync(build.vite, build.args, { cwd: build.cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`the gallery's build failed (exit ${result.status ?? result.signal})`);
}

const SITE = fileURLToPath(new URL("../", import.meta.url));
const build = galleryBuild(SITE);
run(build);
console.log(`gallery: built into ${path.relative(SITE, build.out)}/ for the docs' live demos`);
