/**
 * The archive gate every pushed folder kind shares (plugins, evals): the
 * pushed ZIP becomes the `PluginFiles` reader `@stigmer/plugin-package` is
 * pure over, and the bytes' SHA-256 becomes the version identity. Composes
 * the shared archive plumbing in this folder: open, hash, prefilter and
 * the structural walk exactly as the skill gate, then a lazy reader whose
 * `read` inflates one entry under the central directory's declared size as
 * the real cap and verifies its CRC — the library refuses an over-cap
 * DECLARATION before asking, and this reader refuses an over-cap
 * INFLATION, so a bomb is caught on both sides.
 *
 * Nothing here knows what a plugin or an eval IS: manifests, skills and
 * cases are the library's to find. This module knows what an ARCHIVE is
 * and how to hand its files to the library without inflating anything
 * nobody asked for. It lived in the plugin domain until a second kind
 * pushed folders.
 *
 * Error text is wire-visible: the shared gate's sentences pass through
 * verbatim (the same limits skills quote), and a failed read names the
 * entry and the caller's noun. The push step wraps them into its
 * InvalidArgument arm.
 *
 * Proven by the plugin domain's __tests__/plugin.test.ts and
 * __tests__/legacy-status.test.ts, and the eval domain's push tests.
 */
import type { PluginFileEntry, PluginFiles } from "@stigmer/plugin-package";
import { comparePaths, isContainedPath } from "@stigmer/plugin-package";

import { InflateError, inflateEntry } from "./inflate.js";
import { MAX_ZIP_SIZE, PLATFORM_ARCHIVE_LIMITS } from "./limits.js";
import { openArchive, validateArchiveStructure } from "./open.js";
import type { PrefilteredEntry } from "./prefilter.js";

/** A gated archive: its identity and the files the library may read. */
export interface OpenedArchive {
  /** SHA-256 hex of the archive bytes — the version identity. */
  readonly digest: string;
  readonly files: PluginFiles;
}

/**
 * Gates the archive and builds the lazy reader. Directory entries and
 * entries whose sanitised name the library would refuse as uncontained are
 * dropped here rather than surfaced: the prefilter already made every name
 * unrooted and `..`-free, so what remains is the rare empty-segment name,
 * which no author writes and no manifest can declare. `noun` names the
 * kind in a failed read's sentence ("plugin", "eval").
 */
export function openArchiveFiles(bytes: Uint8Array, noun: string): OpenedArchive {
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
        throw new Error(`${noun} file '${path}' is not listed`);
      }
      try {
        return inflateEntry(
          prefiltered.entry,
          prefiltered.entry.uncompressedSize,
        );
      } catch (error) {
        if (error instanceof InflateError) {
          throw new Error(
            `failed to read '${path}' from the ${noun} archive: ${error.detail}`,
          );
        }
        throw error;
      }
    },
  };

  return { digest: hash, files };
}
