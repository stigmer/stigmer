/**
 * A test-only `PluginFiles` over a directory on disk, for the vendored
 * fixtures. Sorted, symlinks skipped, sizes from `stat`, the contract the
 * CLI's walker honours; kept here (not in the library) because the
 * library's main entry imports no `node:*` module and the CLI owns the
 * real walker with its ignore rules.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { comparePaths, type PluginFileEntry, type PluginFiles } from "../files.js";

export function directoryPluginFiles(root: string): PluginFiles {
  const entries: PluginFileEntry[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) entries.push({ path, size: statSync(join(dir, entry.name)).size });
    }
  };
  walk(root, "");
  entries.sort((a, b) => comparePaths(a.path, b.path));
  return {
    entries,
    read: (path) => new Uint8Array(readFileSync(join(root, ...path.split("/")))),
  };
}
