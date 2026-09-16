/**
 * The platform's archive limits — one home for every ZIP-bomb budget the
 * server applies to a pushed archive, whichever kind it becomes. Skills
 * carried these alone until plugins arrived (also pushed as a ZIP); the
 * values stay byte-pinned to the retired Go gate's (pkg/domain/skill/storage/
 * zip_extractor.go), because every sentence quoting them is wire contract
 * and the transfer lane refuses over-limit declarations by them before a
 * byte moves.
 *
 * A per-kind cap that is NOT an archive budget (the 1 MB SKILL.md
 * extraction cap) stays with its kind: it bounds one document, not the
 * archive.
 */

/**
 * The compressed-archive ceiling. The platform's artifact size limit, not
 * just an extraction guard: createArtifactUploadUrl enforces it before any
 * bytes move and clients quote it in fail-loud size errors (#675).
 */
export const MAX_ZIP_SIZE = 100 * 1024 * 1024;

/** Total declared-uncompressed budget across all entries (ZIP-bomb guard). */
export const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;

/** Per-file declared compression ratio ceiling (ZIP-bomb guard). */
export const MAX_COMPRESSION_RATIO = 100;

/** Entry-count ceiling. */
export const MAX_FILES = 10_000;

/** The budgets `validateArchiveStructure` applies; the platform's by default. */
export interface ArchiveLimits {
  readonly maxFiles: number;
  readonly maxUncompressedSize: number;
  readonly maxCompressionRatio: number;
}

export const PLATFORM_ARCHIVE_LIMITS: ArchiveLimits = {
  maxFiles: MAX_FILES,
  maxUncompressedSize: MAX_UNCOMPRESSED_SIZE,
  maxCompressionRatio: MAX_COMPRESSION_RATIO,
};
