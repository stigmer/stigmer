/**
 * Signed, expiring download links for the local blob backend: what a
 * bucket's presigned URL gives the R2 backend, given to the two lanes that
 * serve local blobs over HTTP (the artifact file server, and the skill
 * transfer lane's GET route). A link minted by `LocalArtifactStorage`
 * carries `exp` (its expiry, Unix seconds) and `sig` (an HMAC-SHA256 over
 * the key, the expiry and the download filename); a lane serves the blob
 * only when `verify` accepts both, and answers anything else the 404 a
 * missing key gets, so a refusal says nothing about what exists.
 *
 * Why it matters: a link lands in logs, chats, transcripts and Temporal
 * history, and before this it was a permanent key to its file, outliving
 * a member's removal. Now it expires, at most `MAX_SIGNED_URL_TTL_MS` after
 * it was minted, the bucket backend's own ceiling.
 *
 * The key is the server's own, on the key ladder every server key uses
 * (`STIGMER_DOWNLOAD_URL_KEY`, else `~/.stigmer/download-url.key`, else
 * generated and persisted on first boot). Losing it costs only the links
 * outstanding, the platform-token key's posture, so it has no backup
 * story. It is never the runner-token key: one key for two protocols would
 * let a rotation of either silently void the other.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  getOrCreateNamedKey,
  type KeyLoaderOptions,
} from "../encryption/key-manager.js";
import { goQueryEscape } from "../gocompat/query-escape.js";

/** The env var the signing key may be set by (Base64 of 32 bytes). */
export const DOWNLOAD_URL_KEY_ENV_VAR = "STIGMER_DOWNLOAD_URL_KEY";

/** The key file under ~/.stigmer when the env var is unset. */
export const DOWNLOAD_URL_KEY_FILE_NAME = "download-url.key";

/**
 * The longest a signed download URL lives, on every backend: the R2
 * presign maximum, and the local backend's clamp.
 */
export const MAX_SIGNED_URL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Query key carrying the desired download filename on local URLs. */
export const LOCAL_DOWNLOAD_QUERY_PARAM = "download";

/** Query key carrying a local link's expiry, Unix seconds. */
export const EXPIRES_QUERY_PARAM = "exp";

/** Query key carrying a local link's signature, base64url. */
export const SIGNATURE_QUERY_PARAM = "sig";

/** The signed message's version: a new shape gets a new tag, never a reuse. */
const SIGNATURE_VERSION = "v1";

const SIGNATURE_BYTES = 32;

export class DownloadUrlSigner {
  constructor(
    private readonly key: Buffer,
    private readonly now: () => number = Date.now,
  ) {
    if (key.length !== SIGNATURE_BYTES) {
      throw new Error(
        `a download URL signing key must be ${SIGNATURE_BYTES} bytes, got ${key.length}`,
      );
    }
  }

  /**
   * The query string a link to `key` carries: the download filename when
   * there is one, the expiry (`ttlMs` from now, clamped to
   * MAX_SIGNED_URL_TTL_MS) and the signature over all three. `key` is the
   * storage key exactly as the serving lane reads it back from the path.
   */
  signedQuery(key: string, ttlMs: number, downloadFilename: string): string {
    if (!(ttlMs > 0)) {
      throw new Error(`a signed download URL needs a positive TTL, got ${ttlMs} ms`);
    }
    const lifetimeMs = Math.min(ttlMs, MAX_SIGNED_URL_TTL_MS);
    const expires = String(Math.floor((this.now() + lifetimeMs) / 1000));
    const parts: string[] = [];
    if (downloadFilename !== "") {
      parts.push(`${LOCAL_DOWNLOAD_QUERY_PARAM}=${goQueryEscape(downloadFilename)}`);
    }
    parts.push(`${EXPIRES_QUERY_PARAM}=${expires}`);
    parts.push(
      `${SIGNATURE_QUERY_PARAM}=${this.mac(key, expires, downloadFilename).toString("base64url")}`,
    );
    return parts.join("&");
  }

  /**
   * Whether `query` carries a live signature over `key`: an expiry still in
   * the future, and a signature this key made over the key, that expiry and
   * the query's download filename (so a filename cannot be swapped onto a
   * link either). Compared in constant time.
   */
  verify(key: string, query: URLSearchParams): boolean {
    const expires = query.get(EXPIRES_QUERY_PARAM) ?? "";
    const signature = query.get(SIGNATURE_QUERY_PARAM) ?? "";
    if (!/^\d{1,12}$/.test(expires) || signature === "") {
      return false;
    }
    if (Number(expires) * 1000 <= this.now()) {
      return false;
    }
    const presented = Buffer.from(signature, "base64url");
    if (presented.length !== SIGNATURE_BYTES) {
      return false;
    }
    const downloadFilename = query.get(LOCAL_DOWNLOAD_QUERY_PARAM) ?? "";
    return timingSafeEqual(presented, this.mac(key, expires, downloadFilename));
  }

  private mac(key: string, expires: string, downloadFilename: string): Buffer {
    // JSON over the fields: no separator a key or a filename could forge.
    return createHmac("sha256", this.key)
      .update(JSON.stringify([SIGNATURE_VERSION, key, expires, downloadFilename]))
      .digest();
  }
}

/**
 * The signer a composition shares between its stores and the two lanes that
 * serve local blobs. With a local store, the key comes from the ladder. With
 * none (both stores on buckets), the composition signs nothing, so it reads
 * and writes no key file; its lanes then hold a fresh key no link was ever
 * signed with and refuse every download, which is all they are asked.
 */
export function downloadUrlSignerFor(
  anyLocalStore: boolean,
  options: KeyLoaderOptions = {},
): DownloadUrlSigner {
  return anyLocalStore
    ? loadDownloadUrlSigner(options)
    : new DownloadUrlSigner(randomBytes(SIGNATURE_BYTES));
}

/** The server's signer, its key read from the ladder (env, key file, generated). */
export function loadDownloadUrlSigner(
  options: KeyLoaderOptions = {},
): DownloadUrlSigner {
  return new DownloadUrlSigner(
    getOrCreateNamedKey(
      DOWNLOAD_URL_KEY_ENV_VAR,
      DOWNLOAD_URL_KEY_FILE_NAME,
      options,
    ),
  );
}

/**
 * A storage key as a URL path: each segment percent-encoded, the slashes
 * kept, so a serving lane that decodes its path reads back the key exactly.
 */
export function encodeKeyPath(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}
