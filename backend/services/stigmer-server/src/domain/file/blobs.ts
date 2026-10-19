/**
 * A File's bytes: where they are written, how a staged upload becomes a
 * File's blob, and how blobs nobody names are deleted. The one place the
 * File domain touches the blob driver and the store's blob door
 * (store/file-blobs.ts), so the controller, a conversation's delete and the
 * organization purge share one sequence.
 *
 * Every new blob is recorded `orphaned`, with a lease, before its bytes are
 * written, and becomes `stored` when its File's row lands: a crash between
 * the bytes and the row leaves a blob the sweep deletes once the lease
 * lapses, never an untracked one. Keys are minted here
 * (`files/<org id>/<hex>`); none is ever presigned for writing.
 *
 * A staged upload is promoted by a copy inside the store, never read back
 * through the server: the upload URL's key (`files/staging/<hex>`) is
 * copied to a new final key and then deleted. On a bucket a presigned PUT
 * stays valid for its whole TTL, so the final key must be one no URL could
 * write. Claiming the staged row first makes one reference promote once.
 *
 * Bytes are deleted after the commit that orphans them, and a failed delete
 * leaves the row orphaned for the next sweep. Sweeps run on write (each
 * upload URL minted here, and each delete RPC through its chain, sweeps a
 * bounded batch first, the connect-link precedent), so nothing leaks on a
 * bucket without a lifecycle rule.
 *
 * Proven by __tests__/blobs.test.ts over the real local driver and the
 * SQLite store.
 */
import { randomBytes } from "node:crypto";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import { FileBlobUnavailableError } from "../../store/file-blobs.js";
import type { Store } from "../../store/interface.js";
import {
  BLOB_KEY_PREFIX,
  BLOB_WRITE_LEASE_MS,
  DOWNLOAD_URL_TTL_MS,
  STAGING_KEY_PREFIX,
  SWEEP_BATCH,
  UPLOAD_REF_BYTE_LEN,
  UPLOAD_REF_PREFIX,
  UPLOAD_URL_TTL_MS,
} from "./constants.js";

/** One answer for a reference that is malformed, unknown, expired or spent: a bucket cannot tell them apart. */
export const UPLOAD_REF_UNKNOWN =
  "upload reference unknown or expired — request a new upload URL with createUploadUrl";

/** A new blob, written and recorded, that a File's row may now name. */
export interface NewBlob {
  readonly blobKey: string;
  readonly org: string;
  readonly sizeBytes: number;
}

/** What createUploadUrl hands the client. */
export interface MintedUpload {
  readonly ref: string;
  readonly url: string;
  readonly ttlMs: number;
}

/** A person's link to a File's bytes. */
export interface FileDownloadLink {
  readonly url: string;
  readonly expiresAtMs: number;
}

export interface FileBlobs {
  /** The ceiling on a File's size (FILE_MAX_BYTES). */
  readonly maxBytes: number;
  /** Mints an upload URL for exactly `sizeBytes` of `org`'s, after a sweep. */
  mintUpload(org: string, sizeBytes: number): Promise<MintedUpload>;
  /** Writes inline bytes to a new blob of `org`. */
  storeInline(org: string, data: Uint8Array, contentType: string): Promise<NewBlob>;
  /** Promotes the bytes put to an upload URL into a new blob of `org`. */
  promote(org: string, ref: string): Promise<NewBlob>;
  /**
   * Commits a new File naming a new blob: its row and its ref in one
   * transaction. An id already held is a fault: the server minted it.
   */
  insertFile<Desc extends DescMessage>(
    id: string,
    schema: Desc,
    file: MessageShape<Desc>,
    blob: NewBlob,
  ): Promise<void>;
  /** Removes a File's row and ref, then its bytes when no other File shares them. */
  removeFile(fileId: string): Promise<void>;
  /** A person's download link to a File's bytes, saved under `filename`. */
  downloadUrl(fileId: string, filename: string): Promise<FileDownloadLink>;
  /** Deletes a bounded batch of expired staged and orphaned blobs; returns how many went. */
  sweep(): Promise<number>;
  /** Deletes every remaining blob of an organization, bytes before rows (its purge). */
  purgeOrganization(org: string): Promise<void>;
  /** Whether an organization still holds a blob row (the purge census). */
  holdsAny(org: string): Promise<boolean>;
}

export interface FileBlobsDeps {
  readonly store: Store;
  /** The File store's driver (boot/compose.ts builds it). */
  readonly storage: ArtifactStorage;
  readonly logger: Logger;
  readonly maxBytes: number;
  /** Injectable for expiry tests; milliseconds. */
  readonly now?: () => number;
}

/** The hex an upload reference and its staging key share. */
const REF_HEX = new RegExp(`^[0-9a-f]{${UPLOAD_REF_BYTE_LEN * 2}}$`);

/** The staging key a reference's bytes land under, or undefined for a reference this server could not have minted. */
export function stagingKeyOf(ref: string): string | undefined {
  if (!ref.startsWith(UPLOAD_REF_PREFIX)) {
    return undefined;
  }
  const hex = ref.slice(UPLOAD_REF_PREFIX.length);
  return REF_HEX.test(hex) ? `${STAGING_KEY_PREFIX}${hex}` : undefined;
}

/** The reference for a staging key minted here; a foreign key is a programming error. */
export function uploadRefOf(stagingKey: string): string {
  const hex = stagingKey.startsWith(STAGING_KEY_PREFIX)
    ? stagingKey.slice(STAGING_KEY_PREFIX.length)
    : "";
  if (!REF_HEX.test(hex)) {
    throw new Error(`${stagingKey} is not a staging key the File domain minted`);
  }
  return UPLOAD_REF_PREFIX + hex;
}

/** A File's size over the limit, in the words every refusal uses. */
export function fileTooLargeMessage(sizeBytes: number, maxBytes: number): string {
  return `the file is ${sizeBytes} bytes; a File may be at most ${maxBytes} bytes (${formatMegabytes(maxBytes)})`;
}

function formatMegabytes(bytes: number): string {
  return `${Math.floor(bytes / (1024 * 1024))} MB`;
}

export function newFileBlobs(deps: FileBlobsDeps): FileBlobs {
  const { store, storage, logger, maxBytes } = deps;
  const nowMs = deps.now ?? Date.now;
  const nowSeconds = (): number => Math.floor(nowMs() / 1000);
  const leaseUntil = (): number => nowSeconds() + Math.ceil(BLOB_WRITE_LEASE_MS / 1000);

  const refuseOverLimit = (sizeBytes: number): void => {
    if (sizeBytes > maxBytes) {
      throw invalidArgumentError(fileTooLargeMessage(sizeBytes, maxBytes));
    }
  };

  /** Records a new blob of `org` before its bytes exist, leased from the sweep. */
  const recordNewBlob = async (org: string, sizeBytes: number): Promise<string> => {
    const blobKey = `${BLOB_KEY_PREFIX}${org}/${randomBytes(16).toString("hex")}`;
    try {
      await store.files.recordBlob({
        blobKey,
        org,
        state: "orphaned",
        sizeBytes,
        expiresAt: leaseUntil(),
      });
    } catch (error) {
      throw internalError(error, "failed to record the file's storage");
    }
    return blobKey;
  };

  /** Deletes a blob's bytes, then forgets its row; a failure stays for the next sweep. */
  const deleteOrphan = async (blobKey: string): Promise<boolean> => {
    try {
      await storage.delete(blobKey);
      await store.files.forgetBlob(blobKey, nowSeconds());
      return true;
    } catch (error) {
      logger.warn("file blob delete failed; the next sweep retries it", {
        blobKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  };

  const sweep = async (): Promise<number> => {
    let keys: string[];
    try {
      keys = await store.files.listSweepable(nowSeconds(), SWEEP_BATCH);
    } catch (error) {
      logger.warn("file blob sweep could not list expired blobs", {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
    let deleted = 0;
    for (const key of keys) {
      if (await deleteOrphan(key)) {
        deleted++;
      }
    }
    return deleted;
  };

  return {
    maxBytes,

    async mintUpload(org, sizeBytes) {
      refuseOverLimit(sizeBytes);
      await sweep();
      const hex = randomBytes(UPLOAD_REF_BYTE_LEN).toString("hex");
      const ref = UPLOAD_REF_PREFIX + hex;
      const stagingKey = STAGING_KEY_PREFIX + hex;
      try {
        // Recorded before the URL exists, so bytes put to it are always
        // tracked and swept once it expires.
        await store.files.recordBlob({
          blobKey: stagingKey,
          org,
          state: "staged",
          sizeBytes,
          expiresAt: nowSeconds() + Math.ceil(UPLOAD_URL_TTL_MS / 1000),
        });
        const presigned = await storage.presignPut(stagingKey, sizeBytes, UPLOAD_URL_TTL_MS);
        return { ref, url: presigned.url, ttlMs: presigned.ttlMs };
      } catch (error) {
        throw internalError(error, "failed to mint an upload URL");
      }
    },

    async storeInline(org, data, contentType) {
      refuseOverLimit(data.length);
      const blobKey = await recordNewBlob(org, data.length);
      try {
        await storage.upload(blobKey, data, contentType);
      } catch (error) {
        throw internalError(error, "failed to store the file");
      }
      return { blobKey, org, sizeBytes: data.length };
    },

    async promote(org, ref) {
      const stagingKey = stagingKeyOf(ref);
      if (stagingKey === undefined) {
        throw failedPreconditionError(UPLOAD_REF_UNKNOWN);
      }
      let claimed;
      try {
        claimed = await store.files.claimStaged(stagingKey, org, nowSeconds(), leaseUntil());
      } catch (error) {
        throw internalError(error, "failed to read the upload reference");
      }
      if (claimed === undefined) {
        throw failedPreconditionError(UPLOAD_REF_UNKNOWN);
      }
      // From here the staged row is orphaned under a lease: whatever
      // happens below, its bytes are swept once the lease lapses.
      let sizeBytes: number;
      try {
        sizeBytes = await storage.size(stagingKey);
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          throw failedPreconditionError(UPLOAD_REF_UNKNOWN);
        }
        throw internalError(error, "failed to read the uploaded file");
      }
      if (sizeBytes !== claimed.sizeBytes) {
        throw failedPreconditionError(
          `the uploaded file is ${sizeBytes} bytes, not the ${claimed.sizeBytes} bytes createUploadUrl was given`,
        );
      }
      refuseOverLimit(sizeBytes);
      const blobKey = await recordNewBlob(org, sizeBytes);
      try {
        await storage.copy(stagingKey, blobKey);
      } catch (error) {
        throw internalError(error, "failed to store the uploaded file");
      }
      try {
        await storage.delete(stagingKey);
      } catch (error) {
        logger.warn("staged file delete failed; the next sweep retries it", {
          stagingKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return { blobKey, org, sizeBytes };
    },

    async insertFile(id, schema, file, blob) {
      let inserted: boolean;
      try {
        inserted = await store.files.insert(ApiResourceKind.file, id, schema, file, blob, nowSeconds());
      } catch (error) {
        if (error instanceof FileBlobUnavailableError) {
          // The write outlived its lease and the bytes are being swept.
          throw failedPreconditionError("the upload took too long to complete; upload the file again");
        }
        throw internalError(error, "failed to save file");
      }
      if (!inserted) {
        throw internalError(new Error(`file id ${id} is already held`), "failed to save file");
      }
    },

    async removeFile(fileId) {
      let removal;
      try {
        removal = await store.files.remove(ApiResourceKind.file, fileId);
      } catch (error) {
        throw internalError(error, "failed to delete file");
      }
      if (removal.orphanedBlobKey !== undefined) {
        await deleteOrphan(removal.orphanedBlobKey);
      }
    },

    async downloadUrl(fileId, filename) {
      let blobKey: string | undefined;
      try {
        blobKey = await store.files.blobKeyOf(fileId);
      } catch (error) {
        throw internalError(error, "failed to read the file's storage");
      }
      if (blobKey === undefined) {
        throw internalError(new Error(`file ${fileId} names no stored blob`), "the file's bytes are missing");
      }
      const expiresAtMs = nowMs() + DOWNLOAD_URL_TTL_MS;
      try {
        const url = await storage.getSignedUrl(blobKey, DOWNLOAD_URL_TTL_MS, filename, "person");
        return { url, expiresAtMs };
      } catch (error) {
        throw internalError(error, "failed to sign a download link");
      }
    },

    sweep,

    async purgeOrganization(org) {
      const page = 200;
      for (let after = ""; ; ) {
        const keys = await store.files.listBlobKeysByOrg(org, after, page);
        for (const key of keys) {
          await storage.delete(key);
        }
        if (keys.length < page) {
          break;
        }
        after = keys[keys.length - 1] ?? "";
      }
      await store.files.deleteByOrg(org);
    },

    async holdsAny(org) {
      return (await store.files.listBlobKeysByOrg(org, "", 1)).length > 0;
    },
  };
}
