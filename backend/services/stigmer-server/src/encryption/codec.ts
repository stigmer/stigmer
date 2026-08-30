/**
 * One version of the secret-value wire format (enc:v<N>:...) — ports the
 * cloud edition's ai.stigmer.infra.encryption.SecretCodec: the whole
 * mapping between the stored string and the plaintext, including where
 * the bytes live, but NO policy.
 *
 * SecretService is the only caller: it owns every policy decision —
 * idempotency short-circuits, unprefixed pass-through, which codec new
 * writes use, unknown-version refusal — so a codec never sees a value
 * that is already encrypted and never decides what "disabled" means.
 * Registration flows through exactly one door: the built-in v1 codec is
 * installed at the boot/compose.ts consumption site, extension codecs
 * through the `secretCodecs` ExtensionDrivers field (never a module-level
 * side registry — the DD-006 one-registry doctrine).
 *
 * In the Java original a codec was pure crypto over the stored string
 * alone until v3; the v3 codec stores the secret's value in the vault KV
 * store and keeps only an authenticated pointer in the string, so
 * encrypt/decrypt there include store I/O (the vault project's DD-005
 * widening). That is why every verb here is async even though the
 * built-in v1 codec never awaits anything.
 *
 * TS shape note: Java's interface carries default methods; here the
 * batch/lifecycle verbs are OPTIONAL and the facade owns the fallbacks
 * (loop the singular verbs; delete is a no-op) — a codec implements them
 * only when it can do better (the v2 envelope codec batches all data-key
 * wraps into one Transit round trip).
 */
import type { EncryptionScope } from "./scope.js";

export interface SecretCodec {
  /**
   * The version token this codec serves — the literal text between
   * `enc:` and the second colon (e.g. "v1"). Dispatch compares tokens
   * literally: "v01" is not "v1" and resolves to no codec, by design.
   */
  readonly version: string;

  /**
   * Encrypts a plaintext value, producing `enc:<version>:...`.
   *
   * @param plaintext never already encrypted (the facade short-circuits)
   * @param scope the tenancy scope whose key seals this value; the v1
   *   codec ignores it, vault-backed codecs key (and, when located,
   *   place) the value by it
   * @throws EncryptionUnavailableError when the codec's key provider
   *   cannot be reached
   */
  encrypt(plaintext: string, scope: EncryptionScope): Promise<string>;

  /**
   * Decrypts a value carrying this codec's prefix. No scope parameter:
   * the sealed value self-describes (the envelope carries its tenant and,
   * for v3, its KV pointer).
   *
   * @throws InvalidCiphertextError when the value itself is bad
   *   (tampered, truncated, malformed, wrong key)
   * @throws EncryptionUnavailableError when the machinery to decrypt an
   *   otherwise-plausible value is missing
   */
  decrypt(encrypted: string): Promise<string>;

  /**
   * Encrypts many values under one scope, key names from the map keys.
   * OPTIONAL — absent, the facade loops encrypt(), which is correct for
   * any codec; the v2 envelope codec implements it to wrap all data keys
   * in ONE KEK round trip. Fails as a whole: callers of the batched
   * paths fail the whole request on any encryption error, so per-entry
   * partial results would go unused. Result keyed as the input,
   * iteration order preserved.
   */
  encryptAll?(
    plaintexts: ReadonlyMap<string, string>,
    scope: EncryptionScope,
  ): Promise<Map<string, string>>;

  /**
   * Decrypts many values carrying this codec's prefix. OPTIONAL — same
   * fallback and whole-batch failure contract as encryptAll; the v2
   * envelope codec implements it to unwrap all data keys in one KEK
   * round trip per key id.
   */
  decryptAll?(
    encrypted: ReadonlyMap<string, string>,
  ): Promise<Map<string, string>>;

  /**
   * Destroys any external state backing a stored value — the lifecycle
   * hook v3 introduced (a resource deletion or secret-key removal must
   * remove the value from the KV store, or it leaks there forever).
   * OPTIONAL — absent means no-op, which is CORRECT for v1/v2: their
   * stored string IS the (encrypted) value, so deleting the resource row
   * deletes everything. Idempotent by contract. Call sites are delete
   * paths whose database write already succeeded, so the facade's
   * callers treat failures as best-effort (Stage 3 wires them).
   *
   * @throws InvalidCiphertextError when the value is bad (nothing
   *   derivable to clean up)
   * @throws EncryptionUnavailableError when the external state is
   *   unreachable
   */
  delete?(encrypted: string): Promise<void>;

  /**
   * Whether this codec can actually seal new values. OPTIONAL — absent
   * means enabled (the Java posture: a codec bean exists exactly when its
   * key machinery does, so registration IS the ability to encrypt). Only
   * the OSS v1 codec implements it: its keyless WARN-degrade state
   * (oss#394) is a deliberate, modeled condition the write steps branch
   * on.
   */
  isEnabled?(): boolean;
}
