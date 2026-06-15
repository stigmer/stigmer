#!/usr/bin/env node

/**
 * Stage the seedpack content into dist/ after `tsc`.
 *
 * The package publishes from dist/ (see scripts/publish-libs.mjs), so the
 * compiled index.js needs the content beside it: contentDir() resolves by
 * walking up to stigmer.yaml, which then lives at dist/stigmer.yaml. Only the
 * canonical entries are copied — kept in sync with SEEDPACK_ENTRIES in
 * src/index.ts and the //go:embed set in embed.go. Non-content siblings (tools/,
 * icons/, canary/) are excluded by omission, so they never ship in the package.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");

const ENTRIES = ["stigmer.yaml", "organizations", "skills", "agents", "workflows", "mcp-servers"];

mkdirSync(dist, { recursive: true });
for (const entry of ENTRIES) {
  const src = join(root, entry);
  if (!existsSync(src)) {
    console.error(`stage-content: missing seedpack entry ${entry}`);
    process.exit(1);
  }
  cpSync(src, join(dist, entry), { recursive: true });
  console.log(`  staged ${entry}`);
}
console.log(`  staged seedpack content into ${dirname(dist)}/dist`);
