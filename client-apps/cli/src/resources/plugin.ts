// A plugin directory as the reader's input, and the reader's outcome as
// something the CLI can print.
//
// `@stigmer/plugin-package` is pure over a `PluginFiles` list; this module is
// the CLI's edge for it. The walk is the skill packager's discipline
// (`createSkillZip`): sorted entries, symlinks never followed, the same
// gitignore-compatible matcher deciding inclusion, so what `validate` reads
// is exactly what a push of the same directory would package. Sizes come
// from `stat` so the library can refuse an over-cap document before reading
// it; the library re-checks the bytes it gets back.
//
// `describePlugin` is the JSON projection for `--json`: the normalised
// package with overlay documents reduced to their paths (the bytes are the
// user's own files, and a byte array serialises badly).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  MANIFEST_LOCATIONS,
  type PluginFileEntry,
  type PluginFiles,
  type PluginFinding,
  type PluginPackage,
} from "@stigmer/plugin-package";
import { createMatcher } from "./ignore/index.js";
import type { IgnoreOptions, ZipStats } from "./skill.js";

/** The four manifest locations; a directory holding any of them is a plugin. */
export const PLUGIN_MANIFEST_PATHS: readonly string[] = Object.values(MANIFEST_LOCATIONS);

/** True when `path` is a directory holding one of the four plugin manifests. */
export function isPluginDirectory(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false;
  } catch {
    return false;
  }
  return PLUGIN_MANIFEST_PATHS.some((manifest) => {
    try {
      return statSync(join(path, ...manifest.split("/"))).isFile();
    } catch {
      return false;
    }
  });
}

export interface PluginDirectory {
  readonly files: PluginFiles;
  /** What the walk included and left out, for the summary line. */
  readonly stats: ZipStats;
}

/** Validate's ignore posture: the defaults and the directory's own ignore files, no flags. */
export const DEFAULT_IGNORE_OPTIONS: IgnoreOptions = { respectGitignore: true, extraIgnore: [], extraInclude: [] };

/** Walk `dir` through the ignore matcher into a `PluginFiles`. */
export function readPluginDirectory(dir: string, options: IgnoreOptions = DEFAULT_IGNORE_OPTIONS): PluginDirectory {
  const matcher = createMatcher({
    rootDir: dir,
    respectGitignore: options.respectGitignore,
    includeDefaults: true,
    extraIgnore: options.extraIgnore,
    extraInclude: options.extraInclude,
  });
  const stats: ZipStats = { filesIncluded: 0, filesIgnored: 0, dirsSkipped: 0, totalSize: 0 };
  const entries: PluginFileEntry[] = [];

  const walk = (currentDir: string, prefix: string): void => {
    const dirents = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const dirent of dirents) {
      const relPath = prefix === "" ? dirent.name : `${prefix}/${dirent.name}`;
      const full = join(currentDir, dirent.name);
      if (dirent.isDirectory()) {
        if (matcher.matchWithReason(relPath, true).ignored) {
          stats.dirsSkipped++;
          continue;
        }
        walk(full, relPath);
        continue;
      }
      // Symlinks are neither files nor directories here and are never followed.
      if (!dirent.isFile()) continue;
      if (matcher.matchWithReason(relPath, false).ignored) {
        stats.filesIgnored++;
        continue;
      }
      const size = statSync(full).size;
      entries.push({ path: relPath, size });
      stats.filesIncluded++;
      stats.totalSize += size;
    }
  };
  walk(dir, "");

  return {
    files: {
      entries,
      read: (path) => new Uint8Array(readFileSync(join(dir, ...path.split("/")))),
    },
    stats,
  };
}

/** The `--json` payload: the package with overlay documents as paths, plus the findings. */
export interface PluginDescription {
  readonly plugin: Omit<PluginPackage, "overlay"> & {
    readonly overlay: {
      readonly agent?: string;
      readonly workflows: readonly { readonly name: string; readonly path: string }[];
      readonly mcpServers: readonly { readonly server: string; readonly path: string }[];
    };
  };
  readonly warnings: readonly PluginFinding[];
  readonly excludedFiles: number;
}

export function describePlugin(plugin: PluginPackage, warnings: readonly PluginFinding[], stats: ZipStats): PluginDescription {
  const { overlay, ...rest } = plugin;
  return {
    plugin: {
      ...rest,
      overlay: {
        ...(overlay.agent !== undefined && { agent: overlay.agent.path }),
        workflows: overlay.workflows.map((w) => ({ name: w.name, path: w.path })),
        mcpServers: overlay.mcpServers.map((s) => ({ server: s.server, path: s.path })),
      },
    },
    warnings,
    excludedFiles: stats.filesIgnored,
  };
}
