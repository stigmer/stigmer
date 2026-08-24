/**
 * CAS-blob content-integrity verification — ports filereview/cas_blob.go.
 * The runner content-addresses gitignored/non-git before/after bytes
 * under artifacts/{execution_id}/filereview/cas/blobs/{sha256}; the
 * trailing 64-char lowercase-hex segment IS the SHA-256 of the stored
 * bytes, making the key self-verifying.
 */
import { sha256HexBytes } from "./digest.js";

/**
 * Strict lowercase hex to match the producer; an off-convention key is
 * treated as non-CAS (skipped), never as a failure.
 */
const CAS_BLOB_KEY_PATTERN =
  /^artifacts\/[^/]+\/filereview\/cas\/blobs\/([0-9a-f]{64})$/;

/**
 * The single, static, user-facing reason when a CAS blob's served bytes
 * do not match the content address in its key — intentionally free of
 * interpolated hashes or keys (safe to surface; diagnostics go to the
 * caller's structured log; a static string lets the edition mirror
 * tables assert exact equality).
 */
export const CAS_BLOB_CONTENT_MISMATCH_REASON =
  "artifact content failed integrity verification: the stored bytes do not match the content address in the storage key";

/**
 * Why served bytes fail the content-address integrity check embedded in a
 * CAS blob storage key, or "" when the read may be served. A pure,
 * transport-free predicate whose non-empty reason the caller maps to a
 * DATA_LOSS status.
 *
 * Fail-open on anything that is not a CAS blob key: git-substrate
 * offloads, tool-call outputs, attachments, the CAS manifest, or any
 * future convention all return "" and are served untouched. The caller
 * MUST pass the COMPLETE object bytes (a truncated read cannot be
 * full-hash-verified, so the caller skips verification in that case).
 * Enforcement only, never a correlation key.
 */
export function casBlobContentMismatch(
  storageKey: string,
  content: Uint8Array,
): string {
  const m = CAS_BLOB_KEY_PATTERN.exec(storageKey);
  if (m === null) {
    return "";
  }
  if (sha256HexBytes(content) === m[1]) {
    return "";
  }
  return CAS_BLOB_CONTENT_MISMATCH_REASON;
}
