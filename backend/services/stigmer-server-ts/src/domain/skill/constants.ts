/**
 * Skill domain constants — every byte-pinned limit and wire-visible string
 * in one place (guidelines: errors are API surface; the CLI, console, and
 * SDK show these verbatim). Values and copy are character-for-character
 * from pkg/domain/skill/storage/zip_extractor.go, frontmatter.go, and
 * transfer/slots.go; the #452 hint is additionally byte-identical to the
 * cloud edition's.
 */

/**
 * The compressed-artifact ceiling. Exported because it is the platform's
 * skill size limit, not just an extraction guard: the transfer lane
 * (createArtifactUploadUrl) enforces it before any bytes move, and clients
 * quote it in fail-loud size errors (#675). Go: storage.MaxZipSize.
 */
export const MAX_ZIP_SIZE = 100 * 1024 * 1024;

/** Total declared-uncompressed budget across all entries (ZIP-bomb guard). */
export const MAX_UNCOMPRESSED_SIZE = 500 * 1024 * 1024;

/** Per-file declared compression ratio ceiling (ZIP-bomb guard). */
export const MAX_COMPRESSION_RATIO = 100;

/** Entry-count ceiling. */
export const MAX_FILES = 10_000;

/** SKILL.md in-memory extraction cap (memory-exhaustion guard). */
export const MAX_SKILL_MD_SIZE = 1 * 1024 * 1024;

/**
 * Upload-slot lifetime — generous enough for a 100MB upload on a slow
 * link, short enough that abandoned slots don't accumulate. Go:
 * transfer.DefaultSlotTTL (15 minutes).
 */
export const DEFAULT_SLOT_TTL_MS = 15 * 60 * 1000;

/**
 * Random capability-token size: 16 bytes = 128 bits of entropy, matching
 * the unguessability of the content-hash download keys. Go: refByteLen.
 */
export const REF_BYTE_LEN = 16;

/**
 * Upload-reference prefix — recognizable in logs, never confusable with
 * artifact storage keys. Go: refPrefix.
 */
export const REF_PREFIX = "sau_";

/**
 * Lane URL space (Go transfer/handler.go): PUT {prefix}/uploads/{ref}
 * stages bytes; GET {prefix}/{storage_key} serves them. The path prefix
 * itself lives in transport/constants.ts (SKILL_ARTIFACTS_PATH_PREFIX) —
 * the lane router owns it.
 */
export const UPLOADS_SEGMENT = "/uploads/";

/**
 * Downloads are restricted to the skill artifact store's own keys
 * ("skills/<hash>.zip"); everything else under the storage root — should
 * the two ever share one — stays unreachable from this lane.
 */
export const DOWNLOAD_KEY_PREFIX = "skills/";

/**
 * The #452 nested-only-SKILL.md hint — the "zipped the folder instead of
 * its contents" mistake. Byte-identical to the cloud edition's copy.
 */
export const NESTED_SKILL_MD_HINT =
  "SKILL.md must be at the archive root — zip the skill folder's contents, not the folder itself";

/**
 * FailedPrecondition copy for the three lane-dependent surfaces when the
 * transfer lane was not configured (Go: identical string at all three
 * sites).
 */
export const TRANSFER_LANE_NOT_CONFIGURED =
  "skill artifact transfer lane is not configured on this server";
