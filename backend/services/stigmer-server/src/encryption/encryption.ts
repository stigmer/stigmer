/**
 * Secret encryption facade — the single entry point for sealing and
 * unsealing secret values, a versioned-codec registry behind the
 * SecretService identity every domain already holds.
 *
 * Provenance: began as a port of pkg/encryption/encryption.go (the
 * retired Go server, single static-key format); reshaped by the pre-X1
 * sealing slice (20260830.04 Stage 1, rulings Q1/Q2) into the port of the
 * cloud edition's SecretEncryptionService + SecretCodecRegistry so the
 * cloud composition can register the vault-backed enc:v2/v3 codecs
 * through the `secretCodecs` extension driver point. The v1 crypto lives
 * in v1-codec.ts; the taxonomy in errors.ts; the scope in scope.ts.
 *
 * Architecture (the Java facade's, verbatim): every stored secret is a
 * versioned string (enc:v<N>:...). READS dispatch on the value's own
 * version token, so any mix of versions in the store stays readable; a
 * version with no codec here is refused loudly as
 * EncryptionUnavailableError — the value may be perfectly valid, the
 * machinery is missing (never fail open, never mislabel it as a bad
 * value). WRITES use exactly one codec, chosen by
 * STIGMER_ENCRYPTION_WRITE_VERSION (name byte-pinned across editions; OSS
 * default v1) and resolved FAIL-FAST at construction: naming a version
 * with no registered codec refuses to boot rather than silently writing
 * something else.
 *
 * No silent version upgrades: encrypt returns an already-prefixed value
 * unchanged, whatever its version (the ***REDACTED*** round-trip copies
 * stored values back into new state before encryption re-runs, and they
 * must survive that second pass byte-identically). The ONE deliberate
 * exception is reencrypt — the explicit, auditable door the
 * secret-convergence sweep walks through: upward-only and
 * round-trip-verified.
 *
 * Policy lives HERE, never in a codec: a codec never sees an
 * already-encrypted value, never sees an unprefixed one, and never
 * decides what "disabled" means (codec.ts records the contract).
 */
import { StaticKeySecretCodec, V1_VERSION } from "./v1-codec.js";
import type { SecretCodec } from "./codec.js";
import type { EncryptionScope } from "./scope.js";
import {
  EncryptionUnavailableError,
  InvalidCiphertextError,
} from "./errors.js";
import { getOrCreateNamedKey } from "./key-manager.js";
import type { KeyLoaderOptions } from "./key-manager.js";

// The taxonomy, the v1 wire constants and the scope re-export here so the
// module keeps its historical import surface (every domain imports from
// encryption/encryption.js) — one module to import, five to maintain.
export {
  DecryptionFailedError,
  EncryptionDisabledError,
  EncryptionUnavailableError,
  InvalidCiphertextError,
} from "./errors.js";
export {
  ENCRYPTED_PREFIX,
  GCM_NONCE_SIZE,
  GCM_TAG_SIZE,
  StaticKeySecretCodec,
} from "./v1-codec.js";
export { EncryptionScope, PLATFORM_TENANT } from "./scope.js";
export type { SecretCodec } from "./codec.js";

/** Env var configuring the secrets key (Base64 32B) — Go EnvKeyName. */
export const ENCRYPTION_KEY_ENV_VAR = "STIGMER_ENCRYPTION_KEY";

/** Key file under ~/.stigmer — Go KeyFileName. */
export const ENCRYPTION_KEY_FILE_NAME = "encryption.key";

/**
 * Env var selecting the write codec — byte-pinned across editions (the
 * cloud's stigmer.encryption.write-version binds the same name). OSS
 * default: v1. A blank value normalizes to the default: this is a
 * rollback lever, and rollback levers must be robust to sloppy unsetting
 * (the Java EncryptionConfig note).
 */
export const ENCRYPTION_WRITE_VERSION_ENV_VAR =
  "STIGMER_ENCRYPTION_WRITE_VERSION";

/** The OSS default write version — the built-in static-key codec. */
export const DEFAULT_WRITE_VERSION = V1_VERSION;

/**
 * The sentinel replacing every non-empty secret value at every
 * resource-returning boundary — Go steps.RedactedMarker, pinned by the
 * conformance suite and byte-identical in the cloud edition. Lives with
 * the facade (the Java shape) because reencrypt must refuse it;
 * domain/environment/constants.ts re-exports it for its historical
 * importers. A client sending it BACK on a write means "keep the existing
 * secret" (the round-trip contract; see preserveRedactedSecrets).
 */
export const REDACTED_MARKER = "***REDACTED***";

/**
 * Matches ciphertext in ANY supported-or-future version of the enc:v<N>:
 * family, capturing the version digits. Anchored so a value merely
 * CONTAINING the prefix is not mistaken for ciphertext. Matching all
 * versions (not just the ones registered here) is load-bearing: an
 * unmatched version would be treated as plaintext at every dispatch site
 * and fail open (returned or re-encrypted as if it were a real value).
 * Mirrors the cloud edition's SecretEncryptionService.VERSIONED_PREFIX.
 */
const VERSIONED_PREFIX = /^enc:v(\d+):/;

/** Registered version tokens are v<digits> — the dispatchable shape. */
const VERSION_TOKEN = /^v(\d+)$/;

/**
 * Go IsCiphertextShaped: whether a value merely has the SHAPE of
 * ciphertext — the enc:v<N>: prefix — regardless of whether it is genuine.
 *
 * This is the request-boundary provenance test (oss#395, the Go twin of
 * cloud#229): the prefix is a server-reserved sentinel, so client-supplied
 * values matching it must be rejected with INVALID_ARGUMENT before they
 * reach encrypt(), whose idempotent pass-through would otherwise persist
 * them verbatim (letting a client store forged ciphertext that
 * getSecretValue later decrypts with the deployment key). Module-level,
 * like the redaction-marker constant, so boundary steps need no service
 * instance and the rejection stays unconditional on keyless deployments.
 */
export function isCiphertextShaped(value: string): boolean {
  return VERSIONED_PREFIX.test(value);
}

/** The version token a stored value carries ("v2"), or undefined. */
function versionTokenOf(value: string): string | undefined {
  const match = VERSIONED_PREFIX.exec(value);
  return match === null ? undefined : `v${match[1]}`;
}

/**
 * Encryption/decryption for environment (and other domain) secrets. Safe
 * for concurrent use; construct via one of the factories below.
 */
export class SecretService {
  private readonly codecs: ReadonlyMap<string, SecretCodec>;
  private readonly writeCodec: SecretCodec;
  /** Numeric form of the write version, for reencrypt's upward-only rule. */
  private readonly writeVersionNumber: number;

  private constructor(
    codecs: ReadonlyMap<string, SecretCodec>,
    writeCodec: SecretCodec,
    writeVersionNumber: number,
  ) {
    this.codecs = codecs;
    this.writeCodec = writeCodec;
    this.writeVersionNumber = writeVersionNumber;
  }

  /**
   * Go NewSecretService, kept signature-stable across the codec seam: a
   * v1-only facade writing v1 — the shape of every OSS deployment with no
   * extension composed, and of every test that constructs the service
   * directly. nil/empty key → disabled (pass-through) v1; a present key
   * must be exactly 32 bytes.
   */
  static create(key: Buffer | undefined): SecretService {
    return SecretService.withCodecs({
      codecs: new Map([[V1_VERSION, new StaticKeySecretCodec(key)]]),
      writeVersion: V1_VERSION,
    });
  }

  /**
   * Go NewSecretServiceFromEnv: a v1-only facade with the key from the
   * shared ladder (env var → key file → auto-generate). Throws only on
   * unusable explicit configuration; the composition root maps that to
   * the WARN-degrade posture.
   */
  static fromEnv(options: KeyLoaderOptions = {}): SecretService {
    const key = getOrCreateNamedKey(
      ENCRYPTION_KEY_ENV_VAR,
      ENCRYPTION_KEY_FILE_NAME,
      options,
    );
    return SecretService.create(key);
  }

  /**
   * The parameterized construction path — the composition root's door
   * (boot/compose.ts assembles built-in v1 + extension codecs and the
   * resolved write version). Fail-fast on a write version with no codec:
   * refusing to start beats silently writing a different version (the
   * Java @PostConstruct contract). Every map key must be a dispatchable
   * v<digits> token matching its codec's own version — a registration
   * dispatch could never reach must fail loudly, not sit dark.
   */
  static withCodecs(options: {
    readonly codecs: ReadonlyMap<string, SecretCodec>;
    readonly writeVersion: string;
  }): SecretService {
    for (const [token, codec] of options.codecs) {
      if (!VERSION_TOKEN.test(token)) {
        throw new Error(
          `secret codec registered under '${token}' — version tokens must match v<digits> (the enc:v<N>: dispatch shape)`,
        );
      }
      if (codec.version !== token) {
        throw new Error(
          `secret codec registered under '${token}' declares version '${codec.version}' — the registry key must equal the codec's own version`,
        );
      }
    }
    const writeCodec = options.codecs.get(options.writeVersion);
    if (writeCodec === undefined) {
      const registered = [...options.codecs.keys()].sort().join(", ");
      throw new Error(
        `${ENCRYPTION_WRITE_VERSION_ENV_VAR} is '${options.writeVersion}' but this deployment has no codec for it (registered: ${registered}). Refusing to start rather than silently writing a different version.`,
      );
    }
    // The token shape was validated above, so the capture always matches.
    const writeVersionNumber = Number(
      VERSION_TOKEN.exec(options.writeVersion)?.[1],
    );
    return new SecretService(
      new Map(options.codecs),
      writeCodec,
      writeVersionNumber,
    );
  }

  /**
   * Whether new values can actually be sealed — delegated to the write
   * codec (absent isEnabled means enabled: registration IS the ability,
   * the Java posture; only the OSS v1 codec models a keyless state). The
   * write steps branch on this for the WARN-degrade posture (oss#394).
   */
  isEnabled(): boolean {
    return this.writeCodec.isEnabled?.() ?? true;
  }

  /**
   * Go IsEncrypted — dispatch on STORED values (decrypt, preserve,
   * re-encrypt). For CLIENT-SUPPLIED input at a request boundary use the
   * module-level isCiphertextShaped — same test, different intent.
   */
  isEncrypted(value: string): boolean {
    return isCiphertextShaped(value);
  }

  /**
   * The version number a stored value carries (enc:v<N>: → N), or
   * undefined for anything else (plaintext, markers, empty strings). The
   * public face of the dispatch parse, for callers that classify stored
   * values — the convergence sweep's upward-only rule and the
   * encryption-state gauges key on it.
   */
  versionOf(value: string): number | undefined {
    const match = VERSIONED_PREFIX.exec(value);
    return match === null ? undefined : Number(match[1]);
  }

  /**
   * Encrypts a plaintext secret under the given scope, using the
   * configured write version.
   *
   * Idempotent for already-prefixed input of ANY version — returned
   * unchanged (no silent upgrades; see the module header). The
   * pass-through TRUSTS its callers: it exists for store-restored
   * ciphertext (the ***REDACTED*** round-trip), and it is NOT a safe
   * place to validate provenance — only the request pipeline knows
   * whether a prefixed value came from the store or from a client.
   * Client-supplied enc:v<N>: input is rejected at every write boundary
   * via isCiphertextShaped (oss#395); do not "fix" smuggling here.
   */
  async encrypt(plaintext: string, scope: EncryptionScope): Promise<string> {
    if (this.isEncrypted(plaintext)) {
      return plaintext;
    }
    return this.writeCodec.encrypt(plaintext, scope);
  }

  /**
   * Encrypts many values under one scope in as few key-provider round
   * trips as the write codec allows (one, for the v2 envelope codec).
   * Per-entry semantics are identical to encrypt(): already-encrypted
   * values of any version pass through unchanged. Result keyed as the
   * input, iteration order preserved; fails as a whole (the batched
   * write paths fail the whole request on any encryption error).
   */
  async encryptAll(
    plaintexts: ReadonlyMap<string, string>,
    scope: EncryptionScope,
  ): Promise<Map<string, string>> {
    return this.encryptAllWith(this.writeCodec, plaintexts, scope);
  }

  /**
   * Encrypts a batch capped at the v2 envelope format: the write codec
   * when the write version is v1 or v2, the v2 codec when the write
   * version is above it. The generalization of the Java facade's
   * encryptAllV2 pin (vault project DD-005) for a family that includes
   * v1-only OSS deployments — see the executioncontext rationale:
   * ephemeral values on a latency-budgeted read path, sealed where v2
   * costs one batched Transit round trip and v3 (no KV batch endpoint,
   * located-scope requirement) cannot follow. At write=v1 this is the
   * write codec (OSS today); at write=v2 it equals Java's pin; at a
   * future write=v3 flip it keeps these lanes on v2 instead of breaking
   * them.
   */
  async encryptAllAtMostV2(
    plaintexts: ReadonlyMap<string, string>,
    scope: EncryptionScope,
  ): Promise<Map<string, string>> {
    const codec =
      this.writeVersionNumber <= 2 ? this.writeCodec : this.codecFor("v2");
    return this.encryptAllWith(codec, plaintexts, scope);
  }

  /**
   * Decrypts an encrypted secret value, dispatching on the value's own
   * version token. Unprefixed values pass through unchanged (legacy
   * plaintext compatibility, pre-oss#405 rows); prefixed values decrypt
   * or fail with the two-armed taxonomy (errors.ts). A version with no
   * codec here is EncryptionUnavailableError — before the codec seam
   * this build failed such values CLOSED as invalid base64 (the literal
   * v1 prefix never stripped); the refusal stays closed, now with the
   * honest arm and copy (a deliberate, recorded change — no wire test
   * observes it).
   */
  async decrypt(encrypted: string): Promise<string> {
    const token = versionTokenOf(encrypted);
    if (token === undefined) {
      return encrypted;
    }
    return this.codecFor(token).decrypt(encrypted);
  }

  /**
   * Decrypts many values in as few key-provider round trips as their
   * codecs allow, grouping by each value's own version token. Per-entry
   * semantics are identical to decrypt(): non-encrypted values pass
   * through. Fails as a whole — callers needing per-key skip semantics
   * (the resolution lanes) loop decrypt() instead.
   */
  async decryptAll(
    encrypted: ReadonlyMap<string, string>,
  ): Promise<Map<string, string>> {
    const byVersion = new Map<string, Map<string, string>>();
    for (const [key, value] of encrypted) {
      const token = versionTokenOf(value);
      if (token === undefined) {
        continue;
      }
      let group = byVersion.get(token);
      if (group === undefined) {
        group = new Map<string, string>();
        byVersion.set(token, group);
      }
      group.set(key, value);
    }

    const decrypted = new Map<string, string>();
    for (const [token, group] of byVersion) {
      const codec = this.codecFor(token);
      const groupResult =
        codec.decryptAll !== undefined
          ? await codec.decryptAll(group)
          : await loopDecryptAll(codec, group);
      for (const [key, value] of groupResult) {
        decrypted.set(key, value);
      }
    }

    const result = new Map<string, string>();
    for (const [key, value] of encrypted) {
      result.set(key, decrypted.get(key) ?? value);
    }
    return result;
  }

  /**
   * Destroys any external state backing a stored value, dispatching on
   * the value's own version token — the lifecycle counterpart of
   * decrypt(). Plaintext and marker values are no-ops by construction;
   * v1/v2 values are no-ops by codec contract (their stored string IS
   * the value). Call sites are resource-delete and key-removal paths
   * whose database write already succeeded, so callers treat failures as
   * best-effort (the Stage 3 wiring owns that posture).
   */
  async delete(storedValue: string): Promise<void> {
    const token = versionTokenOf(storedValue);
    if (token === undefined) {
      return;
    }
    await this.codecFor(token).delete?.(storedValue);
  }

  /**
   * Re-encrypts a stored value to the current write version — the ONE
   * deliberate exception to the no-silent-upgrades doctrine, built for
   * the secret-convergence sweep and the future v3 migration pass. Three
   * rules, each load-bearing (the Java facade's, verbatim):
   *
   *   - UPWARD-ONLY: a value already at (or above) the write version is
   *     returned unchanged. Rolling the write-version lever down must
   *     never trigger a mass downgrade — in a v3 world that would mean
   *     mass KV destruction on a config change.
   *   - ROUND-TRIP-VERIFIED: the new ciphertext is decrypted and compared
   *     to the plaintext before being returned, so a codec bug can never
   *     hand the caller an unreadable value to persist.
   *   - NO EXTERNAL-STATE DESTRUCTION: an old value's backing state (v3
   *     KV entries) is NOT destroyed here — the caller persists the new
   *     value first and only then cleans up, or a failed persist would
   *     leave the stored pointer dangling.
   *
   * A non-encrypted, non-marker value is treated as plaintext and sealed
   * — stored plaintext secrets are damage from the fail-open era (the
   * cloud's #226 lesson; OSS keyless windows leave the same rows) and
   * sealing them is strictly an improvement. The literal redaction
   * marker is refused as InvalidCiphertextError: a stored marker is
   * corruption from a marker-persist bug, and sealing it would hide the
   * corruption behind valid ciphertext.
   *
   * @throws InvalidCiphertextError value-scoped (callers may skip)
   * @throws EncryptionUnavailableError infrastructure (callers must abort)
   */
  async reencrypt(
    storedValue: string,
    scope: EncryptionScope,
  ): Promise<string> {
    if (storedValue === "") {
      return storedValue;
    }
    if (storedValue === REDACTED_MARKER) {
      throw new InvalidCiphertextError(
        "stored value is the literal redaction marker — corruption from a marker-persist bug, not a secret; refusing to seal it",
      );
    }

    const version = this.versionOf(storedValue);
    let plaintext: string;
    if (version !== undefined) {
      if (version >= this.writeVersionNumber) {
        return storedValue;
      }
      plaintext = await this.decrypt(storedValue);
    } else {
      plaintext = storedValue;
    }

    const reencrypted = await this.writeCodec.encrypt(plaintext, scope);
    // Round-trip proof BEFORE the caller can persist anything: decrypt
    // the new value through the normal read path, require an exact match.
    const verification = await this.decrypt(reencrypted);
    if (verification !== plaintext) {
      throw new InvalidCiphertextError(
        `re-encryption round-trip verification failed for a ${
          version !== undefined ? `v${version}` : "plaintext"
        } value: the freshly written ${this.writeCodec.version} ciphertext did not decrypt back to the original plaintext — nothing was persisted; this is a codec bug, stop the migration`,
      );
    }
    return reencrypted;
  }

  /** The batch-encrypt mechanics shared by encryptAll and the v2 cap. */
  private async encryptAllWith(
    codec: SecretCodec,
    plaintexts: ReadonlyMap<string, string>,
    scope: EncryptionScope,
  ): Promise<Map<string, string>> {
    const toEncrypt = new Map<string, string>();
    for (const [key, value] of plaintexts) {
      if (!this.isEncrypted(value)) {
        toEncrypt.set(key, value);
      }
    }

    const encrypted =
      toEncrypt.size === 0
        ? new Map<string, string>()
        : codec.encryptAll !== undefined
          ? await codec.encryptAll(toEncrypt, scope)
          : await loopEncryptAll(codec, toEncrypt, scope);

    const result = new Map<string, string>();
    for (const [key, value] of plaintexts) {
      result.set(key, encrypted.get(key) ?? value);
    }
    return result;
  }

  /**
   * The codec for a stored value's version token, or the loud unavailable
   * refusal — the Java registry's "no codec for this version" contract.
   */
  private codecFor(token: string): SecretCodec {
    const codec = this.codecs.get(token);
    if (codec === undefined) {
      const registered = [...this.codecs.keys()].sort().join(", ");
      throw new EncryptionUnavailableError(
        `unsupported encrypted-value version '${token}' - this deployment decrypts only [${registered}]. The value was written by a format this deployment has no codec for; fix the deployment before reading it.`,
      );
    }
    return codec;
  }
}

/** The facade-owned fallback for codecs without a native batch encrypt. */
async function loopEncryptAll(
  codec: SecretCodec,
  plaintexts: ReadonlyMap<string, string>,
  scope: EncryptionScope,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const [key, value] of plaintexts) {
    result.set(key, await codec.encrypt(value, scope));
  }
  return result;
}

/** The facade-owned fallback for codecs without a native batch decrypt. */
async function loopDecryptAll(
  codec: SecretCodec,
  encrypted: ReadonlyMap<string, string>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const [key, value] of encrypted) {
    result.set(key, await codec.decrypt(value));
  }
  return result;
}
