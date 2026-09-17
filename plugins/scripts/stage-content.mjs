#!/usr/bin/env node

/**
 * Stage the marketplace into dist/, the directory `scripts/publish-libs.mjs`
 * publishes as `@stigmer/plugins`.
 *
 * The content set has one definition: `marketplace.json`. This script copies
 * that file and the directory each listed `source` names, so a plugin that is
 * in the catalogue ships and a directory that is not listed does not (a
 * README, a test, a work-in-progress folder never reach npm by accident). The
 * static suite (`__tests__/catalogue.test.ts`) is what makes the file and the
 * tree agree before this runs; here a listed source that is not a directory
 * is a hard failure, never a silent skip, because a published catalogue that
 * names a plugin it does not carry would fail every `stigmer up`.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const MARKETPLACE_FILE = "marketplace.json";

const marketplace = JSON.parse(readFileSync(join(root, MARKETPLACE_FILE), "utf8"));
if (!Array.isArray(marketplace.plugins)) {
  console.error(`stage-content: ${MARKETPLACE_FILE} has no 'plugins' list`);
  process.exit(1);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(root, MARKETPLACE_FILE), join(dist, MARKETPLACE_FILE));
console.log(`  staged ${MARKETPLACE_FILE}`);

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
  console.log(`  staged ${dir}`);
}
console.log(`  staged the marketplace into ${dist}`);
