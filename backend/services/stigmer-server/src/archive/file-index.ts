/**
 * An archive's table of contents: every file a pushed skill or plugin
 * archive holds, with what a reader needs to open one file alone. Built
 * once per archive, from the archive alone, so it is content-addressed
 * beside it (`content-store.ts`, the index keys) and never migrated: a
 * later format is a new key prefix ({@link fileIndexKeyPrefix}), and an
 * index missing under it is built again from the archive on first read
 * (`file-reads.ts`).
 *
 * One entry per file: its sanitised path (the name the push gate judged,
 * `prefilter.ts`), its size, the SHA-256 of its bytes, whether it is
 * executable (the rule the runner writes trees with, `@stigmer/zip-structure`
 * `entry-mode.ts`), and where its stored bytes sit in the zip (the
 * compression method, offset, stored length and CRC), so a read fetches
 * exactly that slice and inflates it under a cap.
 *
 * Beside the files, the folders that hold the archive's eval suite, which
 * no reader may serve: an agent under test must not read the cases it is
 * graded on. They are `evals/` and the suite directory the plugin's own
 * manifest names, by the one rule the suite reader applies
 * (`@stigmer/plugin-package` `evalSuiteDir`), for every plugin archive and
 * for a skill archive that holds a plugin manifest (a plugin's root skill
 * is the whole package); a skill pushed on its own keeps its own `evals/`.
 * The runner's mounts apply the same rule (`runner` `shared/plugin-mount.ts`
 * `withoutEvalSuite`).
 *
 * A server-internal document: the wire carries a smaller view
 * (`SkillFile`, `PluginFile`), and no download lane serves its keys, which
 * sit outside the `skills/` and `plugins/` prefixes those lanes admit.
 *
 * Proven by __tests__/file-index.test.ts.
 */
import { createHash } from "node:crypto";

import { evalSuiteDir, hasPluginManifest, isContainedPath } from "@stigmer/plugin-package";
import type { PluginFiles } from "@stigmer/plugin-package";
import { isExecutableEntry } from "@stigmer/zip-structure";
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

import { InflateError, inflateEntry } from "./inflate.js";
import { MAX_ZIP_SIZE, PLATFORM_ARCHIVE_LIMITS } from "./limits.js";
import { openArchive, validateArchiveStructure } from "./open.js";

/** The index document's format; part of its key, so a new format is built afresh, never migrated. */
export const FILE_INDEX_FORMAT = 1;

/** The kinds whose archives carry an index. */
export type IndexedArchiveKind = "skill" | "plugin";

/** Where a kind's indexes live: `skill-indexes/v1/`, `plugin-indexes/v1/`. */
export function fileIndexKeyPrefix(kind: IndexedArchiveKind): string {
  return `${kind}-indexes/v${FILE_INDEX_FORMAT}/`;
}

/** The eval suite's default directory, hidden whatever a manifest names. */
const DEFAULT_SUITE_DIR = "evals";

/** One file of an archive. */
export interface ArchiveFileEntry {
  /** The sanitised path inside the archive: forward slashes, no leading slash, no `.` or `..`. */
  readonly path: string;
  /** Size of the file's bytes. */
  readonly size: number;
  /** SHA-256 of the file's bytes, lowercase hex. */
  readonly sha256: string;
  /** Whether a command may run the file directly. */
  readonly executable: boolean;
  /** ZIP compression method of the stored bytes (0 stored, 8 deflated). */
  readonly method: number;
  /** Byte offset of the stored bytes in the archive. */
  readonly offset: number;
  /** Length of the stored bytes. */
  readonly storedSize: number;
  /** The central directory's CRC-32 of the file's bytes. */
  readonly crc32: number;
}

/** An archive's table of contents. */
export interface ArchiveFileIndex {
  readonly format: typeof FILE_INDEX_FORMAT;
  /** Every file, in path order (code-unit comparison). */
  readonly files: readonly ArchiveFileEntry[];
  /** Directories holding the archive's eval suite, which no reader serves; empty for a skill pushed on its own. */
  readonly suiteDirs: readonly string[];
}

/**
 * Builds the index of an archive the push gate has accepted. Every entry is
 * inflated once, under its declared size as the cap and with its CRC
 * checked, to hash it; an entry that does not inflate fails the build.
 * Directory entries and names the library would refuse as uncontained are
 * left out, and of two entries sanitising to one name the first wins, as
 * the archive reader's (`open-files.ts`).
 */
export function buildArchiveFileIndex(bytes: Uint8Array, kind: IndexedArchiveKind): ArchiveFileIndex {
  const { entries } = openArchive(bytes, MAX_ZIP_SIZE);
  validateArchiveStructure(entries, PLATFORM_ARCHIVE_LIMITS);

  const byPath = new Map<string, ZipStructuralEntry>();
  for (const { name, entry } of entries) {
    if (name.endsWith("/") || !isContainedPath(name) || byPath.has(name)) continue;
    byPath.set(name, entry);
  }

  const files: ArchiveFileEntry[] = [];
  for (const [path, entry] of byPath) {
    const content = inflateNamed(path, entry);
    files.push({
      path,
      size: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
      executable: isExecutableEntry(path, content),
      method: entry.compressionMethod,
      offset: entry.compressedData.byteOffset - bytes.byteOffset,
      storedSize: entry.compressedSize,
      crc32: entry.crc32,
    });
  }
  files.sort((a, b) => compareCodeUnits(a.path, b.path));

  return { format: FILE_INDEX_FORMAT, files, suiteDirs: suiteDirsOf(kind, byPath) };
}

/** The suite directories of an archive (the module header). */
function suiteDirsOf(kind: IndexedArchiveKind, byPath: ReadonlyMap<string, ZipStructuralEntry>): readonly string[] {
  if (kind === "skill" && !hasPluginManifest(byPath.keys())) return [];
  const reader: PluginFiles = {
    entries: [...byPath].map(([path, entry]) => ({ path, size: entry.uncompressedSize })),
    read: (path) => {
      const entry = byPath.get(path);
      if (entry === undefined) throw new Error(`archive file '${path}' is not listed`);
      return inflateNamed(path, entry);
    },
  };
  return [...new Set([DEFAULT_SUITE_DIR, evalSuiteDir(reader)])];
}

/** One entry's bytes, under its declared size; a refusal names the entry. */
function inflateNamed(path: string, entry: ZipStructuralEntry): Uint8Array {
  try {
    return inflateEntry(entry, entry.uncompressedSize);
  } catch (error) {
    if (error instanceof InflateError) {
      throw new Error(`failed to read '${path}' from the archive: ${error.detail}`);
    }
    throw error;
  }
}

/** Whether `path` lies in one of the index's suite directories, which no reader serves. */
export function inSuiteDir(path: string, suiteDirs: readonly string[]): boolean {
  return suiteDirs.some((dir) => dir !== "" && path.startsWith(`${dir}/`));
}

/** The index as stored: JSON, UTF-8. */
export function encodeArchiveFileIndex(index: ArchiveFileIndex): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(index));
}

/**
 * A stored index read back, or `undefined` when it is not one this format
 * wrote (a torn write, a hand-edited object): the caller builds it again
 * from the archive rather than trust it.
 */
export function decodeArchiveFileIndex(bytes: Uint8Array): ArchiveFileIndex | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return undefined;
  }
  if (!isObject(parsed) || parsed["format"] !== FILE_INDEX_FORMAT) return undefined;
  const { files, suiteDirs } = parsed;
  if (!Array.isArray(files) || !files.every(isFileEntry)) return undefined;
  if (!Array.isArray(suiteDirs) || !suiteDirs.every((dir) => typeof dir === "string")) return undefined;
  return { format: FILE_INDEX_FORMAT, files, suiteDirs };
}

function isFileEntry(value: unknown): value is ArchiveFileEntry {
  if (!isObject(value)) return false;
  const counts = ["size", "method", "offset", "storedSize", "crc32"].every(
    (key) => Number.isSafeInteger(value[key]) && (value[key] as number) >= 0,
  );
  return (
    counts &&
    typeof value["path"] === "string" &&
    typeof value["executable"] === "boolean" &&
    typeof value["sha256"] === "string" &&
    /^[0-9a-f]{64}$/.test(value["sha256"])
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Code-unit order: stable across locales, the order a listing is answered in. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
