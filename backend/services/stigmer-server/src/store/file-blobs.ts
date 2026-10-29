/**
 * The File blob store's contract: where a File's bytes live, kept off the
 * File's row so no message ever carries a storage key, and how a blob's
 * life follows the Files that name it.
 *
 * Two tables. `file_blobs` has one row per blob the server minted, keyed
 * by its storage key, with its organization, its state, its size and the
 * instant after which a sweep may delete it. `file_blob_refs` has one row
 * per File, naming the blob its bytes are in; several Files may share one
 * blob (a conversation's copy of an organization File), so a blob goes
 * only with the last File that names it.
 *
 * A blob's states:
 *   - `staged`: an upload URL was minted for it; its bytes may or may not
 *     have arrived. It expires with the URL.
 *   - `stored`: at least one File names it. It never expires.
 *   - `orphaned`: no File names it. Either it is being written (a new
 *     File's bytes, or a staged upload being promoted, recorded before the
 *     bytes so a crash never leaves an untracked blob), and it expires
 *     after a lease; or its last File was deleted, and it expires at once
 *     (`expiresAt` 0, so no server's clock, however far behind, reads it
 *     as live).
 *
 * A sweep deletes the bytes of every staged or orphaned blob past its
 * expiry, then forgets the row, only while it is still past its expiry and
 * unnamed: nothing can name an expired blob, because `insert` refuses one.
 * That is what keeps a blob being orphaned from gaining a new File, and a
 * new File from landing on bytes a sweep is deleting.
 *
 * Both writes that change who names a blob (`insert`, `remove`) lock the
 * blob's row first (Postgres `FOR UPDATE`; SQLite serializes every writer
 * under `BEGIN IMMEDIATE`), so two deletes of a blob's last two Files see
 * each other and exactly one orphans it. Each commits the File's resource
 * row (and its list keys) with the ref, in one transaction: the
 * `writeResourceAppendingEvents` precedent (README.md, "File blobs").
 *
 * Times are Unix seconds. The kit both drivers pass is
 * `__tests__/file-blobs-contract.ts`.
 */
import type { DescMessage, MessageShape } from "@bufbuild/protobuf";

import type { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

/** A blob's state (module header). */
export type FileBlobState = "staged" | "stored" | "orphaned";

/** One blob row as stored. */
export interface FileBlobRecord {
  /** The storage key the bytes live under: server-minted, never on the wire. */
  readonly blobKey: string;
  /** The organization whose Files may name it. */
  readonly org: string;
  readonly state: FileBlobState;
  /** A staged blob's declared size; a stored blob's size; 0 while unknown. */
  readonly sizeBytes: number;
  /** When a staged or orphaned blob may be swept; 0 for a stored blob. */
  readonly expiresAt: number;
}

/** What `remove` did. */
export interface FileRemoval {
  /** Whether a File row was removed. */
  readonly removed: boolean;
  /** The blob's key when this removal orphaned it (no File names it now), else undefined. */
  readonly orphanedBlobKey: string | undefined;
}

/**
 * `insert` was asked to name a blob no File may name: absent, still
 * staged, or orphaned past its expiry (being swept, or its last File was
 * deleted).
 */
export class FileBlobUnavailableError extends Error {
  constructor(blobKey: string, why: string) {
    super(`file blob ${blobKey} cannot be named: ${why}`);
    this.name = "FileBlobUnavailableError";
  }
}

/**
 * The refusal `insert` answers for a blob row (both drivers read it under
 * the row's lock): absent, of another organization, staged, or orphaned
 * past its expiry at `now`; undefined when a File may name it.
 */
export function fileBlobRefusal(
  blobKey: string,
  row: FileBlobRecord | undefined,
  org: string,
  now: number,
): FileBlobUnavailableError | undefined {
  if (row === undefined) {
    return new FileBlobUnavailableError(blobKey, "it is not recorded");
  }
  if (row.org !== org) {
    return new FileBlobUnavailableError(blobKey, "it belongs to another organization");
  }
  if (row.state === "staged") {
    return new FileBlobUnavailableError(blobKey, "it is still staged");
  }
  if (row.state === "orphaned" && row.expiresAt <= now) {
    return new FileBlobUnavailableError(blobKey, "it is orphaned past its expiry");
  }
  return undefined;
}

export interface FileBlobStore {
  /**
   * Records a blob before its bytes exist: `orphaned` with a lease for a
   * new File's bytes, `staged` with the URL's expiry for an upload URL.
   * Refuses a key already recorded.
   */
  recordBlob(blob: FileBlobRecord): Promise<void>;

  /** The blob's row, else undefined. */
  getBlob(blobKey: string): Promise<FileBlobRecord | undefined>;

  /**
   * Takes a staged blob for promotion, atomically: a staged row of `org`
   * that has not expired at `now` becomes `orphaned` until `leaseUntil`
   * (so a sweep removes its bytes if the promotion dies) and is returned
   * as it was. Undefined when the blob is absent, of another
   * organization, expired, or no longer staged, so one reference is
   * promoted once.
   */
  claimStaged(
    blobKey: string,
    org: string,
    now: number,
    leaseUntil: number,
  ): Promise<FileBlobRecord | undefined>;

  /**
   * Writes a new File's resource row and its ref in one transaction, the
   * blob's row locked first, and marks the blob `stored` with `sizeBytes`
   * (a blob already stored keeps its size: another File shares it).
   * Throws FileBlobUnavailableError when the blob is absent, staged, of
   * another organization, or orphaned past its expiry at `now`. Answers
   * false, writing nothing, when the File's id is already held.
   */
  insert<Desc extends DescMessage>(
    kind: ApiResourceKind,
    id: string,
    schema: Desc,
    msg: MessageShape<Desc>,
    blob: { readonly blobKey: string; readonly org: string; readonly sizeBytes: number },
    now: number,
  ): Promise<boolean>;

  /** The key of the blob a File's bytes live in, else undefined. */
  blobKeyOf(fileId: string): Promise<string | undefined>;

  /**
   * Removes a File's resource row and its ref in one transaction, the
   * blob's row locked first; when no other File names the blob, it
   * becomes `orphaned`, expiring at once (`expiresAt` 0), and its key is returned so the
   * caller deletes the bytes after the commit. Removing an absent File is
   * not an error.
   */
  remove(kind: ApiResourceKind, id: string): Promise<FileRemoval>;

  /** Keys a sweep may delete: staged or orphaned blobs expired at `now`, at most `limit`. */
  listSweepable(now: number, limit: number): Promise<string[]>;

  /**
   * Forgets a swept blob's row, only while it is still staged or orphaned
   * and expired at `now`; true when the row went.
   */
  forgetBlob(blobKey: string, now: number): Promise<boolean>;

  /** An organization's blob keys after `after`, in key order, at most `limit` (its purge). */
  listBlobKeysByOrg(org: string, after: string, limit: number): Promise<string[]>;

  /**
   * Removes every blob and ref row of an organization (its
   * purge, once the bytes and the Files are gone); returns the count of
   * blob rows.
   */
  deleteByOrg(org: string): Promise<number>;

}
