/**
 * The preparation every client runs once it holds a tree: select the files
 * a push carries, read the package and refuse what the reader refuses,
 * archive, digest.
 *
 * Three clients arrive here with three kinds of tree: the CLI with a
 * directory on disk, the console with a marketplace host's file listing,
 * and the console again with a folder or a zip the user picked. What they
 * do after selection is identical, and it is where the plugin's identity
 * is made (the archive's bytes are `status.digest`), so it is written once.
 * A parity test proves that one function reached three ways yields one
 * digest for one tree; before this module each client carried its own copy
 * of the chain and the test proved a coincidence.
 *
 * `preparePluginFromTree` is the lazy form for a tree whose bytes cost
 * something to obtain (a fetch per file, a `File.arrayBuffer()`): it reads
 * the two root ignore files, selects, refuses an over-cap selection before
 * another byte moves, then reads only the files the archive will carry. A
 * plugin folder holding a `node_modules/` costs its ignore file and its
 * manifest, wherever the tree lives. The CLI keeps its own walk (a
 * filesystem lets it skip a directory before listing it, which a flat tree
 * cannot) and joins at `preparePluginArchive`.
 *
 * Refusals are returned, not thrown: each client renders the reader's
 * findings in its own voice (the CLI's `pluginRefusal`, the console's
 * `PluginReadRefusal`) and adds its own provenance around the result.
 */

import type { PluginFiles } from "../files.js";
import type { PluginFinding } from "../outcome.js";
import { readPluginPackage } from "../read-plugin-package.js";
import type { PluginPackage } from "../types.js";
import { archivePlugin, digestArchive } from "./archive.js";
import {
  type CandidateFile,
  type SelectPluginFilesOptions,
  type SelectionStats,
  IGNORE_FILE_NAMES,
  selectPluginFiles,
} from "./select.js";

/** What a client holds after preparation: the package as read, the bytes a push sends, and their identity. */
export interface PreparedPlugin {
  readonly plugin: PluginPackage;
  readonly warnings: readonly PluginFinding[];
  /** The selected files, for the client that lists them (`push --dry-run`). */
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
  /** The exact bytes a push sends. */
  readonly archive: Uint8Array;
  /**
   * SHA-256 of `archive`, lowercase hex: the identity the server records as
   * `status.digest` (its digest is over the bytes it receives, and these are
   * those bytes), so a client knows "already installed" without pushing.
   */
  readonly digest: string;
}

/** What an already-selected tree can come to: a prepared plugin, or the reader's refusal. */
export type PrepareArchiveOutcome =
  | { readonly ok: true; readonly prepared: PreparedPlugin }
  /** The reader refused the package; `errors` are its sentences, as `stigmer validate -f` prints them. */
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly errors: readonly PluginFinding[];
      readonly warnings: readonly PluginFinding[];
    };

/** What a lazily-read tree can come to: the above, or a refusal on size before its bytes were read. */
export type PreparePluginOutcome =
  | PrepareArchiveOutcome
  /** The selected files exceed the caller's `maxBytes`; nothing beyond the ignore files was read. */
  | { readonly ok: false; readonly kind: "too-large"; readonly selectedBytes: number; readonly maxBytes: number };

/** A tree the client can list now and read later: a candidate with the promise of its bytes. */
export interface LazyCandidate extends CandidateFile {
  read(): Promise<Uint8Array>;
}

export interface PrepareFromTreeOptions extends SelectPluginFilesOptions {
  /**
   * The most bytes the SELECTED files may total, refused before they are
   * read. A client states its own budget (the console's is the archive cap
   * a browser will hold in memory); omitted, nothing is refused here and
   * the server's zip gate is the only limit.
   */
  readonly maxBytes?: number;
}

/**
 * Read, refuse, archive and digest an already-selected tree. `selection`
 * is what `selectPluginFiles` returns or what the CLI's walk builds in the
 * same shape; its `files.read` must answer synchronously for every listed
 * entry by now.
 */
export async function preparePluginArchive(selection: {
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
}): Promise<PrepareArchiveOutcome> {
  const outcome = readPluginPackage(selection.files);
  if (!outcome.ok) {
    return { ok: false, kind: "refused", errors: outcome.errors, warnings: outcome.warnings };
  }
  const archive = archivePlugin(selection.files);
  return {
    ok: true,
    prepared: {
      plugin: outcome.plugin,
      warnings: outcome.warnings,
      files: selection.files,
      stats: selection.stats,
      archive,
      digest: await digestArchive(archive),
    },
  };
}

/**
 * Prepare a tree whose bytes are obtained on demand. A byte is read only
 * for a file that will be in the archive (plus the two root ignore files
 * that decide which those are), and an over-cap selection is refused
 * before any of them.
 */
export async function preparePluginFromTree(
  candidates: readonly LazyCandidate[],
  options: PrepareFromTreeOptions,
): Promise<PreparePluginOutcome> {
  const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const contents = new Map<string, Uint8Array>();
  const fetchInto = async (path: string): Promise<void> => {
    const candidate = byPath.get(path);
    if (candidate === undefined) throw new Error(`plugin file '${path}' is not listed`);
    contents.set(path, await candidate.read());
  };
  const read = (path: string): Uint8Array => {
    const bytes = contents.get(path);
    if (bytes === undefined) throw new Error(`plugin file '${path}' was not read before selection asked for it`);
    return bytes;
  };

  // Phase 1: only the two files that shape the selection.
  await Promise.all(
    [IGNORE_FILE_NAMES.gitignore, IGNORE_FILE_NAMES.stigmerignore]
      .filter((name) => byPath.has(name))
      .map((name) => fetchInto(name)),
  );
  const { maxBytes, ...selectOptions } = options;
  const selection = selectPluginFiles(candidates, read, selectOptions);

  if (maxBytes !== undefined && selection.stats.totalSize > maxBytes) {
    return { ok: false, kind: "too-large", selectedBytes: selection.stats.totalSize, maxBytes };
  }

  // Phase 2: exactly the files the archive carries.
  await Promise.all(
    selection.files.entries.filter((entry) => !contents.has(entry.path)).map((entry) => fetchInto(entry.path)),
  );
  return preparePluginArchive(selection);
}
