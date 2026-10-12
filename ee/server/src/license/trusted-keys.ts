/**
 * The license signing keys this build of Stigmer Enterprise trusts: key id
 * to raw 32-byte Ed25519 public key, compiled in.
 *
 * There is no configuration path on purpose. A ring an operator could
 * extend through an environment variable or a file would let anyone mint a
 * key pair and sign their own license; the only keys that verify are the
 * ones compiled here, so a release trusts exactly the issuer it shipped
 * with. A rotation adds the new key beside the old one in a release, and an
 * old key leaves only once no customer's license names it.
 *
 * Nothing at runtime can change the ring either. The keys are kept as
 * string pairs (a string cannot be altered in place) and every read builds
 * a fresh map with fresh bytes from them, so a caller that writes to its
 * copy changes only that copy. A frozen `Map` would not do this:
 * `Object.freeze` stops new properties, not `Map.prototype.set`, and never
 * a `Uint8Array`'s bytes.
 *
 * A key is written in base64, the form the issuer's runbook records it in.
 * The decoding refuses anything but canonical base64 of exactly 32 bytes,
 * because `Buffer.from(…, "base64")` skips characters it does not know and
 * a mangled paste would otherwise decode to the wrong key in silence. A
 * kid compiled twice is refused too: the second entry would replace the
 * first, and a rotation that reused a kid would drop a trusted key.
 *
 * The ring is empty until the production issuer's key is compiled in, so
 * every license key is refused as `unknown-key` until then. Tests pass a
 * ring of their own to the verifier and never touch this one.
 */

/** One compiled key: its `kid` and its raw Ed25519 public key in base64. */
export type CompiledLicenseKey = readonly [keyId: string, publicKeyBase64: string];

/** The raw length of an Ed25519 public key. */
const ED25519_PUBLIC_KEY_BYTES = 32;

const COMPILED_LICENSE_KEYS: ReadonlyArray<CompiledLicenseKey> = Object.freeze([]);

/** The ring this build trusts, built afresh on every call. */
export function trustedLicenseKeys(): ReadonlyMap<string, Uint8Array> {
  return licenseKeyRing(COMPILED_LICENSE_KEYS);
}

/** A fresh ring from compiled entries; a malformed or repeated entry is a build defect and throws. */
export function licenseKeyRing(
  entries: ReadonlyArray<CompiledLicenseKey>,
): ReadonlyMap<string, Uint8Array> {
  const ring = new Map<string, Uint8Array>();
  for (const [keyId, publicKeyBase64] of entries) {
    if (ring.has(keyId)) {
      throw new Error(`the compiled license key '${keyId}' is listed twice`);
    }
    const raw = Buffer.from(publicKeyBase64, "base64");
    if (raw.toString("base64") !== publicKeyBase64 || raw.length !== ED25519_PUBLIC_KEY_BYTES) {
      throw new Error(
        `the compiled license key '${keyId}' is not the canonical base64 of a ${ED25519_PUBLIC_KEY_BYTES}-byte Ed25519 public key`,
      );
    }
    ring.set(keyId, new Uint8Array(raw));
  }
  return ring;
}
