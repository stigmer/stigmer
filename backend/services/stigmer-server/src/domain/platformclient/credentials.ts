/**
 * PlatformClient credential material — byte-compatible with every client
 * Stigmer Cloud has issued since the Java service, because the rows (and
 * the secrets integrators hold) move under this code unchanged:
 *
 *   - client_id: "stgm_cid_" + 32 random bytes, base64url (43 characters).
 *     Public by design — safe in logs and client-side code — so its
 *     existence is no secret and the mint may answer an unknown id and a
 *     wrong secret with the same copy at different speeds.
 *   - client_secret: "stgm_cs_" + 48 random bytes, base64url (64
 *     characters): 384 bits, returned once and never stored.
 *   - the stored hash: SHA-256 over the whole prefixed secret, base64url
 *     (43 characters). A slow KDF defends low-entropy passwords, not
 *     384-bit random tokens — ApiKey's precedent (domain/apikey/keymaterial.ts).
 *   - the fingerprint: the secret's last six characters, for display.
 *
 * The comparison hashes the presented secret and compares the two hashes in
 * constant time, so neither the secret nor the stored hash leaks through
 * timing.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CLIENT_ID_PREFIX = "stgm_cid_";
export const CLIENT_SECRET_PREFIX = "stgm_cs_";

/** Random bytes behind a client_id. */
const CLIENT_ID_BYTES = 32;

/** Random bytes behind a client_secret: 384 bits. */
const CLIENT_SECRET_BYTES = 48;

/** Characters of the secret kept for display. */
export const SECRET_FINGERPRINT_LENGTH = 6;

export function generateClientId(): string {
  return CLIENT_ID_PREFIX + randomBytes(CLIENT_ID_BYTES).toString("base64url");
}

export function generateClientSecret(): string {
  return (
    CLIENT_SECRET_PREFIX + randomBytes(CLIENT_SECRET_BYTES).toString("base64url")
  );
}

/** SHA-256 over the whole prefixed secret, base64url — the stored form. */
export function hashClientSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

/** The secret's last six characters (the whole secret when shorter). */
export function secretFingerprint(secret: string): string {
  return secret.length <= SECRET_FINGERPRINT_LENGTH
    ? secret
    : secret.slice(-SECRET_FINGERPRINT_LENGTH);
}

/** Whether `secret` hashes to `storedHash`, compared in constant time. */
export function secretMatchesHash(secret: string, storedHash: string): boolean {
  if (storedHash === "") {
    return false;
  }
  const presented = Buffer.from(hashClientSecret(secret), "utf8");
  const stored = Buffer.from(storedHash, "utf8");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
