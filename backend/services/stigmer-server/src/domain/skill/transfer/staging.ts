/**
 * Archive staging — how an artifact above the gRPC message cap travels,
 * on every blob driver, through one code path (#675, stigmer#1219).
 *
 * The domain owns the two identities and the mapping between them: the
 * wire reference a client is handed (`sau_<hex>`, the capability the
 * push presents) and the staging key the bytes land under in the blob
 * store (`skills/staging/<hex>.zip`, the surface a sweep targets). A
 * driver is asked only to sign or stage a PUT for a key it is given, to
 * read the key back, and to delete it — so the local driver rides the
 * transfer lane's slot registry and a bucket driver signs a PUT straight
 * to the bucket, and nothing above this module can tell which.
 *
 * Consume reads then deletes: the delete is what keeps a reference
 * single-use on a bucket, whose signed URL is otherwise repeatable within
 * its TTL. The delete is best effort and loud — the bytes are already in
 * hand, a replay of the same reference is a content-addressed no-op, and
 * the bucket lifecycle rule on the staging prefix sweeps what the delete
 * missed. On the local driver the same delete retires the staged file the
 * slot registry would otherwise sweep at expiry.
 *
 * A reference the driver cannot read — malformed, never uploaded,
 * expired, already consumed — is one condition on every driver
 * ("unknown or expired"): a bucket cannot distinguish them, so neither
 * does the wire.
 *
 * Proven by __tests__/staging.test.ts over a fake driver and over the
 * real local driver with its slot registry; the conformance suite's
 * transfer-lane block pins the wire behaviour on both editions.
 */
import { randomBytes } from "node:crypto";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../../boot/logger.js";
import {
  DEFAULT_SLOT_TTL_MS,
  DOWNLOAD_URL_TTL_MS,
  MAX_ZIP_SIZE,
  REF_BYTE_LEN,
  REF_PREFIX,
  STAGING_KEY_PREFIX,
} from "../constants.js";
import { SlotUnknownError } from "./slots.js";

/** The hex the reference and the staging key share; 128 bits, lowercase. */
const HEX = new RegExp(`^[0-9a-f]{${REF_BYTE_LEN * 2}}$`);
const STAGED_ARCHIVE_SUFFIX = ".zip";

/** The shared hex of a well-formed reference or key, else undefined. */
function hexBetween(
  value: string,
  prefix: string,
  suffix: string,
): string | undefined {
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) {
    return undefined;
  }
  const hex = value.slice(prefix.length, value.length - suffix.length);
  return HEX.test(hex) ? hex : undefined;
}

/** A fresh upload reference: the prefix and 128 random bits, hex. */
export function newUploadRef(): string {
  return REF_PREFIX + randomBytes(REF_BYTE_LEN).toString("hex");
}

/**
 * The staging key a reference's bytes land under, or undefined when the
 * reference is not one this server could have minted. Refs arrive from
 * clients (the push request, the lane's URL path), so the shape is
 * checked before it becomes a storage key.
 */
export function stagingKeyOf(ref: string): string | undefined {
  const hex = hexBetween(ref, REF_PREFIX, "");
  return hex === undefined
    ? undefined
    : `${STAGING_KEY_PREFIX}${hex}${STAGED_ARCHIVE_SUFFIX}`;
}

/**
 * The reference for a staging key this module minted. Keys reach here from
 * the domain's own mint, never from a client, so a foreign shape is a
 * programming error and throws.
 */
export function uploadRefOf(stagingKey: string): string {
  const hex = hexBetween(stagingKey, STAGING_KEY_PREFIX, STAGED_ARCHIVE_SUFFIX);
  if (hex === undefined) {
    throw new Error(`${stagingKey} is not a staging key this domain minted`);
  }
  return REF_PREFIX + hex;
}

/** What createArtifactUploadUrl hands the client. */
export interface StagedUpload {
  /** The single-use reference the push presents. */
  readonly ref: string;
  /** Accepts one HTTP PUT of exactly the declared byte count. */
  readonly url: string;
  /** How long the reference and the URL stay valid. */
  readonly ttlMs: number;
}

/** What getArtifactDownloadUrl hands the client. */
export interface DownloadCapability {
  readonly url: string;
  /** The floor of the URL's validity (DOWNLOAD_URL_TTL_MS). */
  readonly ttlMs: number;
}

/** The staging port both archive kinds (skills, plugins) push through. */
export interface ArchiveStaging {
  /** Mints a reference and the URL its bytes are PUT to. */
  mint(declaredSizeBytes: number): Promise<StagedUpload>;
  /**
   * Reads the staged bytes for a reference and retires it. Throws
   * SlotUnknownError when the driver holds nothing under the reference;
   * any other failure is the driver's and propagates as an infrastructure
   * fault.
   */
  consume(ref: string): Promise<Uint8Array>;
  /** A time-limited download URL for a stored archive key. */
  downloadUrl(storageKey: string): Promise<DownloadCapability>;
}

export function newArchiveStaging(
  driver: ArtifactStorage,
  logger: Logger,
): ArchiveStaging {
  return {
    async mint(declaredSizeBytes) {
      // The controllers refuse over-limit declarations with the limit in
      // the message before reaching here; this is the module's own
      // invariant, so no driver is ever asked to stage more than the
      // archive ceiling.
      if (declaredSizeBytes <= 0 || declaredSizeBytes > MAX_ZIP_SIZE) {
        throw new Error(
          `declared size ${declaredSizeBytes} outside (0, ${MAX_ZIP_SIZE}]`,
        );
      }
      const ref = newUploadRef();
      const key = stagingKeyOf(ref);
      if (key === undefined) {
        throw new Error(`minted reference ${ref} has no staging key`);
      }
      const presigned = await driver.presignPut(
        key,
        declaredSizeBytes,
        DEFAULT_SLOT_TTL_MS,
      );
      return { ref, url: presigned.url, ttlMs: presigned.ttlMs };
    },

    async consume(ref) {
      const key = stagingKeyOf(ref);
      if (key === undefined) {
        throw new SlotUnknownError();
      }
      let data: Uint8Array;
      try {
        // The allocation is bounded by construction: a bucket accepts only
        // the signed Content-Length, the slot registry only the reserved
        // size, and both were checked against MAX_ZIP_SIZE at mint.
        data = await driver.download(key);
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          throw new SlotUnknownError();
        }
        throw error;
      }
      try {
        await driver.delete(key);
      } catch (error) {
        logger.error("failed to delete consumed staged artifact", {
          stagingKey: key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return data;
    },

    async downloadUrl(storageKey) {
      const url = await driver.getSignedUrl(
        storageKey,
        DOWNLOAD_URL_TTL_MS,
        "",
      );
      return { url, ttlMs: DOWNLOAD_URL_TTL_MS };
    },
  };
}
