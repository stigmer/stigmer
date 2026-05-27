#!/usr/bin/env node

/**
 * Generates a build fingerprint after tsc compilation.
 *
 * Computes a SHA-256 hash of all src/**\/*.ts files (sorted for
 * determinism) and writes it to dist/.build-fingerprint as JSON.
 * The runner reads this at startup to detect stale dist/ builds.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const runnerRoot = join(__dirname, "..");
const srcDir = join(runnerRoot, "src");
const distDir = join(runnerRoot, "dist");

function collectFiles(dir, ext, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      collectFiles(fullPath, ext, files);
    } else if (entry.name.endsWith(ext)) {
      files.push(fullPath);
    }
  }
  return files;
}

const tsFiles = collectFiles(srcDir, ".ts").sort();
const hash = createHash("sha256");

for (const file of tsFiles) {
  hash.update(relative(runnerRoot, file));
  hash.update(readFileSync(file));
}

const fingerprint = {
  hash: hash.digest("hex").slice(0, 16),
  builtAt: new Date().toISOString(),
  fileCount: tsFiles.length,
};

writeFileSync(
  join(distDir, ".build-fingerprint"),
  JSON.stringify(fingerprint) + "\n",
);

console.log(
  `build-fingerprint: ${fingerprint.hash} (${fingerprint.fileCount} files, ${fingerprint.builtAt})`,
);
