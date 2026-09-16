/**
 * The plugin archive gate: the pushed ZIP becomes the `PluginFiles` reader
 * `@stigmer/plugin-package` is pure over, and the bytes' SHA-256 becomes
 * the plugin's version identity. Composes the shared archive plumbing
 * (src/archive): open, hash, prefilter and the structural walk exactly as
 * the skill gate, then a lazy reader whose `read` inflates one entry under
 * the central directory's declared size as the real cap and verifies its
 * CRC — the library refuses an over-cap DECLARATION before asking, and this
 * reader refuses an over-cap INFLATION, so a bomb is caught on both sides.
 *
 * Nothing here knows what a plugin IS: manifests, skills and overlays are
 * the library's to find. This module knows what an ARCHIVE is and how to
 * hand its files to the library without inflating anything nobody asked
 * for.
 *
 * Error text is wire-visible: the shared gate's sentences pass through
 * verbatim (the same limits skills quote), and a failed read names the
 * entry. The push step wraps them into its InvalidArgument arm.
 *
 * Proven by __tests__/archive.test.ts.
 */
import type { PluginFileEntry, PluginFiles } from "@stigmer/plugin-package";
import { comparePaths, isContainedPath } from "@stigmer/plugin-package";

import { InflateError, inflateEntry } from "../../archive/inflate.js";
import { MAX_ZIP_SIZE, PLATFORM_ARCHIVE_LIMITS } from "../../archive/limits.js";
import { openArchive, validateArchiveStructure } from "../../archive/open.js";
import type { PrefilteredEntry } from "../../archive/prefilter.js";

/** A gated archive: its identity and the files the library may read. */
export interface OpenedPluginArchive {
  /** SHA-256 hex of the archive bytes — the plugin's version identity. */
  readonly digest: string;
  readonly files: PluginFiles;
}

/**
 * Gates the archive and builds the lazy reader. Directory entries and
 * entries whose sanitised name the library would refuse as uncontained are
 * dropped here rather than surfaced: the prefilter already made every name
 * unrooted and `..`-free, so what remains is the rare empty-segment name,
 * which no plugin author writes and no manifest can declare.
 */
export function openPluginArchive(bytes: Uint8Array): OpenedPluginArchive {
  const { hash, entries } = openArchive(bytes, MAX_ZIP_SIZE);
  validateArchiveStructure(entries, PLATFORM_ARCHIVE_LIMITS);

  const byPath = new Map<string, PrefilteredEntry>();
  for (const prefiltered of entries) {
    const { name } = prefiltered;
    if (name.endsWith("/") || !isContainedPath(name)) {
      continue;
    }
    // Two entries sanitising to one name (`a/../b.md` beside `b.md`): the
    // first wins, as the skill gate's "first root-named entry" rule reads.
    if (!byPath.has(name)) {
      byPath.set(name, prefiltered);
    }
  }

  const fileEntries: PluginFileEntry[] = [...byPath.values()]
    .map(({ name, entry }) => ({ path: name, size: entry.uncompressedSize }))
    .sort((a, b) => comparePaths(a.path, b.path));

  const files: PluginFiles = {
    entries: fileEntries,
    read(path: string): Uint8Array {
      const prefiltered = byPath.get(path);
      if (prefiltered === undefined) {
        throw new Error(`plugin file '${path}' is not listed`);
      }
      try {
        return inflateEntry(
          prefiltered.entry,
          prefiltered.entry.uncompressedSize,
        );
      } catch (error) {
        if (error instanceof InflateError) {
          throw new Error(
            `failed to read '${path}' from the plugin archive: ${error.detail}`,
          );
        }
        throw error;
      }
    },
  };

  return { digest: hash, files };
}
