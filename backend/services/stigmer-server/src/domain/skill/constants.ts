/**
 * Skill domain constants — every byte-pinned limit and wire-visible string
 * in one place (guidelines: errors are API surface; the CLI, console, and
 * SDK show these verbatim). Values and copy are character-for-character
 * from pkg/domain/skill/storage/zip_extractor.go, frontmatter.go, and
 * transfer/slots.go; the #452 hint is additionally byte-identical to the
 * cloud edition's.
 */

/**
 * The archive budgets (compressed ceiling, uncompressed total, ratio, file
 * count) are the platform's, shared with every archive-shaped push since
 * plugins arrived; they live in src/archive/limits.ts and are re-exported
 * here so the skill domain's consumers keep their names. Go:
 * storage.MaxZipSize and its three siblings.
 */
export {
  MAX_COMPRESSION_RATIO,
  MAX_FILES,
  MAX_UNCOMPRESSED_SIZE,
  MAX_ZIP_SIZE,
} from "../../archive/limits.js";

/** SKILL.md in-memory extraction cap (memory-exhaustion guard). */
export const MAX_SKILL_MD_SIZE = 1 * 1024 * 1024;

/**
 * Upload-slot lifetime — generous enough for a 100MB upload on a slow
 * link, short enough that abandoned slots don't accumulate. Go:
 * transfer.DefaultSlotTTL (15 minutes). The same lifetime is asked of a
 * bucket driver's presigned PUT, so the reference and the URL it names
 * expire together whichever driver serves them.
 */
export const DEFAULT_SLOT_TTL_MS = 15 * 60 * 1000;

/**
 * Download capability lifetime — the floor of a minted download URL's
 * validity, reported as ttl_seconds. A bucket driver signs its GET for
 * exactly this long, the lifetime the cloud edition already grants
 * execution-artifact downloads; the local lane's URL is a content-hash
 * capability that never expires, so the floor holds there trivially. An
 * hour outlives any mount the runner performs while staying short enough
 * that a leaked URL is not a standing grant.
 */
export const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;

/**
 * Where staged uploads live in the blob store, under the skill store's own
 * prefix: `skills/staging/<hex>.zip`. The retired cloud service staged
 * under this exact prefix, so the bucket lifecycle rule that sweeps
 * abandoned uploads is written for it, and on the local driver the boot
 * wipe targets the same directory. Every staged object is a random
 * 128-bit key, so its exposure through the download lane is the same
 * capability the upload reference already grants.
 */
export const STAGING_KEY_PREFIX = "skills/staging/";

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
 * ("skills/<hash>.zip", and the staged uploads under STAGING_KEY_PREFIX);
 * everything else under the storage root — should the two ever share one
 * — stays unreachable from this lane.
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
