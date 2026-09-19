/**
 * The catalogue as a directory: where it is, and which of its directories
 * are plugins.
 *
 * A directory at the root is a plugin when its own file list carries a
 * manifest at one of the locations the reader knows (`hasPluginManifest`
 * over plugin-relative paths, the question `readMarketplace` asks of an
 * entry), not when a manifest is visible at its top level: a Cursor or
 * Codex folder keeps its manifest one directory down. The tooling
 * directories (`__tests__`, `scripts`, `dist`, `node_modules`) are never
 * plugins whatever they hold.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { comparePaths, hasPluginManifest } from "@stigmer/plugin-package";
import { preparePluginFromTree } from "@stigmer/plugin-package/client";

import { listDirectory } from "./candidates.js";

/** The catalogue root, `plugins/`, from anywhere under `plugins/scripts/lib/`. */
export const CATALOGUE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Directories at the root that are tooling, never plugins. */
export const NOT_PLUGIN_DIRS: ReadonlySet<string> = new Set(["__tests__", "scripts", "dist", "node_modules"]);

/** The names of every directory at `root` that holds a plugin manifest, sorted. */
export function pluginFolders(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_PLUGIN_DIRS.has(entry.name))
    .filter((entry) => hasPluginManifest(listDirectory(join(root, entry.name)).candidates.map((candidate) => candidate.path)))
    .map((entry) => entry.name)
    .sort(comparePaths);
}

/**
 * The digest an install of the folder at `dir` would push: the install's
 * own preparation (ignore rules, the reader, the archive) over the folder's
 * bytes, so the same bytes anywhere yield the same value. Refuses with the
 * reader's sentences when the folder does not install.
 */
export async function digestOfFolder(dir: string): Promise<string> {
  const prepared = await preparePluginFromTree(listDirectory(dir).candidates, { respectGitignore: true });
  if (!prepared.ok) {
    const detail = prepared.kind === "refused" ? prepared.errors.map((f) => f.message).join("; ") : `${prepared.selectedBytes} bytes, over the ${prepared.maxBytes} cap`;
    throw new Error(`${dir} does not install: ${detail}`);
  }
  return prepared.prepared.digest;
}
