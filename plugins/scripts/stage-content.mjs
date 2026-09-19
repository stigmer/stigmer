#!/usr/bin/env node

/**
 * Stage the marketplace into dist/, the directory `scripts/publish-libs.mjs`
 * publishes as `@stigmer/plugins`, and prove that npm will publish all of it.
 *
 * The content set has one definition: `marketplace.json`. This script copies
 * that file, the NOTICE beside it (the attribution for every vendored folder)
 * and the directory each listed `source` names, so a plugin that is in the
 * catalogue ships and a directory that is not listed does not (a README, a
 * test, a work-in-progress folder never reach npm by accident). The static
 * suite (`__tests__/catalogue.test.ts`) is what makes the file and the tree
 * agree before this runs; here a listed source that is not a directory is a
 * hard failure, never a silent skip, because a published catalogue that
 * names a plugin it does not carry would fail every `stigmer up`.
 *
 * Then the pack check. npm decides what a tarball carries by rules of its
 * own: a `.gitignore` inside a staged folder is read as packing rules and
 * not shipped, whatever it names is dropped, `.npmrc` and `.DS_Store` never
 * ship. Every consumer of a release reads the packed tree (the console
 * through the npm CDN, the CLI through the package it acquires), and a
 * vendored folder's promise is that its bytes are the vendor's; so after
 * staging, npm itself is asked (`npm pack --dry-run --json`) and any staged
 * file it would leave out fails the build by name. npm is the oracle; no
 * copy of its rules lives here. `make test-plugins-static` runs this on
 * every plugins pull request, so the failure is seen at review, not at the
 * release.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const MARKETPLACE_FILE = "marketplace.json";
const NOTICE_FILE = "NOTICE";

const marketplace = JSON.parse(readFileSync(join(root, MARKETPLACE_FILE), "utf8"));
if (!Array.isArray(marketplace.plugins)) {
  console.error(`stage-content: ${MARKETPLACE_FILE} has no 'plugins' list`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, MARKETPLACE_FILE), join(dist, MARKETPLACE_FILE));
console.log(`  staged ${MARKETPLACE_FILE}`);
if (existsSync(join(root, NOTICE_FILE))) {
  cpSync(join(root, NOTICE_FILE), join(dist, NOTICE_FILE));
  console.log(`  staged ${NOTICE_FILE}`);
}

for (const entry of marketplace.plugins) {
  // The reader accepts `./name`, `name` and `name/`; the staged copy keeps
  // the directory name exactly, so the staged marketplace.json still resolves.
  const dir = String(entry.source).replace(/^\.\//, "").replace(/\/+$/, "");
  const src = join(root, dir);
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    console.error(`stage-content: ${MARKETPLACE_FILE} lists '${entry.name}' at '${entry.source}', which is not a directory`);
    process.exit(1);
  }
  cpSync(src, join(dist, dir), { recursive: true });
}
console.log(`  staged ${marketplace.plugins.length} plugin directories into ${dist}`);

const staged = listFiles(dist, "dist");
const packed = new Set(packList().map((file) => file.path));
const unshipped = staged.filter((path) => !packed.has(path));
if (unshipped.length > 0) {
  console.error(`stage-content: npm would not publish ${unshipped.length} staged file${unshipped.length === 1 ? "" : "s"}, so the package would not be the tree:`);
  for (const path of unshipped) console.error(`    ${path}`);
  console.error("  a vendored folder that carries such a file cannot ship whole; strike it in vendor.json with the reason, or ask its vendor");
  process.exit(1);
}
console.log(`  npm pack lists every one of the ${staged.length} staged files`);

/** Every regular file under `dir`, as `prefix/<relative>` POSIX paths, sorted. */
function listFiles(dir, prefix) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...listFiles(join(dir, entry.name), path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

/** What `npm pack` would put in the tarball, from npm's own dry run. */
function packList() {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const [report] = JSON.parse(output);
  if (report === undefined || !Array.isArray(report.files)) throw new Error("stage-content: npm pack --dry-run --json returned no file list");
  return report.files;
}
