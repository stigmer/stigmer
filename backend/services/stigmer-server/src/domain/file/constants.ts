/**
 * File domain constants: the limits, lifetimes and key shapes the domain
 * owns, in one place. Wire-visible limits are named in the RPCs' comments
 * (apis/ai/stigmer/agentic/file/v1/command.proto).
 */

/**
 * The default ceiling on a File's size, an operator's FILE_MAX_BYTES
 * overriding it: Claude's Files API limit, 500 MB. Every driver carries
 * it, since the local lane streams an upload to disk.
 */
export const DEFAULT_FILE_MAX_BYTES = 500 * 1024 * 1024;

/**
 * The largest File uploaded inline: the transport caps a whole request
 * at 10 MiB, and the request's other fields need room.
 */
export const MAX_INLINE_FILE_BYTES = 10 * 1024 * 1024 - 64 * 1024;

/** Where an upload URL's bytes land: `files/staging/<hex>`. */
export const STAGING_KEY_PREFIX = "files/staging/";

/** Where a File's bytes live once uploaded: `files/<org id>/<blob id>`. */
export const BLOB_KEY_PREFIX = "files/";

/** The upload reference's prefix: recognizable, never a storage key. */
export const UPLOAD_REF_PREFIX = "fup_";

/** 128 random bits, hex, shared by an upload reference and its staging key. */
export const UPLOAD_REF_BYTE_LEN = 16;

/** The file-name shape of a staging key past its prefix (the slot registry's invariant). */
export const STAGED_FILE_NAME = new RegExp(`^[0-9a-f]{${UPLOAD_REF_BYTE_LEN * 2}}$`);

/**
 * How long an upload URL and its reference stay valid: long enough for
 * 500 MB on a slow link.
 */
export const UPLOAD_URL_TTL_MS = 60 * 60 * 1000;

/**
 * How long a blob being written (a new File's bytes, or a staged upload
 * being promoted) is held from the sweep before its File row lands. A
 * write that outlives it is refused at insert and its bytes are swept.
 */
export const BLOB_WRITE_LEASE_MS = 60 * 60 * 1000;

/** How long a person's download link works. */
export const DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;

/** How many expired blobs one sweep deletes, so a request pays a bounded cost. */
export const SWEEP_BATCH = 50;

/** The media type of a File whose upload declared none and whose extension says nothing. */
export const DEFAULT_MIME_TYPE = "application/octet-stream";
