/**
 * Which files of a tree a plugin push carries, and in what order.
 *
 * A client that installs a plugin holds a tree: the CLI a directory on disk,
 * the console the file list a marketplace host returned. Both must choose
 * the same files in the same order, because the archive's bytes are the
 * plugin's identity on the server (`status.digest` is the SHA-256 of what
 * it received) and the order of the archive's entries is part of those
 * bytes. This module is that choice, made once.
 *
 * The rule is the CLI's original walk (`stigmer push plugin <dir>`): at each
 * directory the names are sorted by code point, files and directories
 * interleaved by name, and a directory the matcher ignores is skipped whole,
 * so no negation inside it can pull a file back. Symlinks never appear (the
 * CLI walker skips them; a hosted tree has none the client asks for).
 * `compareWalkOrder` states that order for a flat list of paths so a client
 * with no directory to walk arrives at the same sequence; it is NOT the plain
 * code-point order of full paths (`b/x.txt` sorts before `b.txt` here,
 * because the directory `b` sorts before the file `b.txt` at their level).
 * The reader in `read-plugin-package.ts` indexes entries by path and is
 * indifferent to their order; only the archive cares.
 *
 * `.gitignore` and `.stigmerignore` are read from the root of the tree being
 * selected, as the CLI does, never from an ancestor: a marketplace entry is
 * its own plugin root.
 */

import type { PluginFileEntry, PluginFiles } from "../files.js";
import { type IgnoreSources, type Matcher, SOURCE_GITIGNORE, SOURCE_STIGMERIGNORE, buildMatcher } from "./ignore/matcher.js";

/** The tree a client holds before selection: every file it could offer, with its size. */
export interface CandidateFile {
  /** Root-relative POSIX path, no leading `./`. */
  readonly path: string;
  readonly size: number;
}

/** What the selection included and left out, for the summary line every client prints. */
export interface SelectionStats {
  filesIncluded: number;
  filesIgnored: number;
  /** Ignored directories that held at least one candidate; a tree lists no empty directories. */
  dirsSkipped: number;
  totalSize: number;
}

export interface SelectPluginFilesOptions {
  /** Whether the tree's own root `.gitignore` applies (every push says yes unless asked otherwise). */
  readonly respectGitignore: boolean;
  readonly extraIgnore?: readonly string[];
  readonly extraInclude?: readonly string[];
}

export interface PluginSelection {
  readonly files: PluginFiles;
  readonly stats: SelectionStats;
  /** The matcher the selection ran, for diagnostics (`push --dry-run` lists its patterns). */
  readonly matcher: Matcher;
}

/** The two files at a tree's root that shape its own selection. */
export const IGNORE_FILE_NAMES = {
  gitignore: SOURCE_GITIGNORE,
  stigmerignore: SOURCE_STIGMERIGNORE,
} as const;

/**
 * Select the files a push of `candidates` carries. `read` yields a listed
 * candidate's bytes and is called here only for the two ignore files at the
 * root, so a client may hand over a lazy reader and pay for the rest only
 * when the archive is built.
 */
export function selectPluginFiles(
  candidates: readonly CandidateFile[],
  read: (path: string) => Uint8Array,
  options: SelectPluginFilesOptions,
): PluginSelection {
  const byPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const sources: IgnoreSources = {
    includeDefaults: true,
    ...(options.respectGitignore &&
      byPath.has(IGNORE_FILE_NAMES.gitignore) && { gitignore: decode(read(IGNORE_FILE_NAMES.gitignore)) }),
    ...(byPath.has(IGNORE_FILE_NAMES.stigmerignore) && {
      stigmerignore: decode(read(IGNORE_FILE_NAMES.stigmerignore)),
    }),
    ...(options.extraIgnore !== undefined && { extraIgnore: options.extraIgnore }),
    ...(options.extraInclude !== undefined && { extraInclude: options.extraInclude }),
  };
  const matcher = buildMatcher(sources);

  const stats: SelectionStats = { filesIncluded: 0, filesIgnored: 0, dirsSkipped: 0, totalSize: 0 };
  const skippedDirs = new Set<string>();
  const entries: PluginFileEntry[] = [];

  for (const candidate of [...candidates].sort((a, b) => compareWalkOrder(a.path, b.path))) {
    if (underSkippedDir(candidate.path, matcher, skippedDirs, stats)) continue;
    if (matcher.matchWithReason(candidate.path, false).ignored) {
      stats.filesIgnored++;
      continue;
    }
    entries.push({ path: candidate.path, size: candidate.size });
    stats.filesIncluded++;
    stats.totalSize += candidate.size;
  }

  return {
    files: {
      entries,
      read(path) {
        if (!byPath.has(path)) throw new Error(`plugin file '${path}' is not listed`);
        return read(path);
      },
    },
    stats,
    matcher,
  };
}

/**
 * The order a sorted directory walk visits files: component by component,
 * each compared by code point. Two paths never share a prefix that is a
 * file in one and a directory in the other, so a shorter path is never a
 * prefix of a longer one at the point they differ.
 */
export function compareWalkOrder(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  const depth = Math.min(as.length, bs.length);
  for (let i = 0; i < depth; i++) {
    const x = as[i] ?? "";
    const y = bs[i] ?? "";
    if (x !== y) return x < y ? -1 : 1;
  }
  return as.length - bs.length;
}

/**
 * True when an ancestor directory of `path` is ignored as a directory. The
 * walk checks a directory once and skips its subtree, so each ignored
 * directory counts once whatever it holds.
 */
function underSkippedDir(path: string, matcher: Matcher, skipped: Set<string>, stats: SelectionStats): boolean {
  const parts = path.split("/");
  let dir = "";
  for (let i = 0; i < parts.length - 1; i++) {
    dir = dir === "" ? (parts[i] ?? "") : `${dir}/${parts[i] ?? ""}`;
    if (skipped.has(dir)) return true;
    if (matcher.matchWithReason(dir, true).ignored) {
      skipped.add(dir);
      stats.dirsSkipped++;
      return true;
    }
  }
  return false;
}

const decoder = new TextDecoder();

function decode(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}
