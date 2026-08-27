/**
 * API-key material — generation, hashing, fingerprinting (O3, 20260827.06;
 * DD-003 owner ruling: apikey wholly OSS). Ports the cloud Java library
 * (api-authentication/apikey/library: ApiKeyGenerator, ApiKeyHasher,
 * ApiKeyFingerprintExtractor) byte-format-for-byte-format — every value
 * this module produces is cross-edition wire/storage contract:
 *
 *   - plaintext: `stk_` + Base64URL(32 SecureRandom bytes), no padding
 *     ("stk" = stigmer-key; 256 bits of entropy).
 *   - stored hash: SHA-256 of the UTF-8 plaintext, Base64URL, no padding
 *     (NOT hex — spec.proto's "SHA-256/Bcrypt" aside is stale; the Java
 *     hasher is plain SHA-256 and stored hashes must keep matching after
 *     the cloud converges onto this module).
 *   - fingerprint: the LAST 6 characters of the plaintext (the whole
 *     plaintext when shorter — the Java extractor's degenerate arm).
 *
 * Prefix claim is case-insensitive (Java startsWithIgnoreCase): the
 * verifier chain uses it to decide "this is an API key" vs "let the next
 * verifier look" — a recognized-but-invalid key must then throw, never
 * pass (extensions/identity.ts contract).
 */
import { createHash, randomBytes } from "node:crypto";

/** The plaintext prefix — Java ApiKeyConstants.API_KEY_PREFIX. */
export const API_KEY_PREFIX = "stk_";

/** Random bytes per key — Java ApiKeyGenerator.TOKEN_BYTES (256 bits). */
export const API_KEY_TOKEN_BYTES = 32;

/** Fingerprint length — Java ApiKeyFingerprintExtractor (last 6 chars). */
export const API_KEY_FINGERPRINT_LENGTH = 6;

/** A fresh plaintext API key: `stk_` + Base64URL(32 random bytes). */
export function generateApiKeyPlaintext(): string {
  return API_KEY_PREFIX + randomBytes(API_KEY_TOKEN_BYTES).toString("base64url");
}

/**
 * The storage hash of a plaintext key — Java ApiKeyHasher.hash. Throws on
 * an empty input exactly as the Java hasher does (a programming error at
 * the call site, never a client-visible arm).
 */
export function hashApiKey(plaintext: string): string {
  if (plaintext === "") {
    throw new Error("token must not be null or empty");
  }
  return createHash("sha256").update(plaintext, "utf8").digest("base64url");
}

/** The display fingerprint — Java ApiKeyFingerprintExtractor.extract. */
export function fingerprintOf(plaintext: string): string {
  if (plaintext.length <= API_KEY_FINGERPRINT_LENGTH) {
    return plaintext;
  }
  return plaintext.slice(-API_KEY_FINGERPRINT_LENGTH);
}

/**
 * Whether a presented bearer token is an API key — the `stk_` prefix,
 * case-insensitive (Java OpaqueTokenAuthenticationProvider's
 * startsWithIgnoreCase claim rule).
 */
export function isApiKeyToken(token: string): boolean {
  return token.slice(0, API_KEY_PREFIX.length).toLowerCase() === API_KEY_PREFIX;
}
