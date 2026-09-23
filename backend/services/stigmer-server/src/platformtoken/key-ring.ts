/**
 * The platform-token key ring: the RS256 key material every token the
 * server signs for itself rides (the envelope in envelope.ts). One ring
 * per server, supplied once:
 *
 *   - Open source composes `openSourcePlatformTokenKeyRing()`: one RSA key
 *     on the key-manager ladder (STIGMER_PLATFORM_TOKEN_KEY, else
 *     ~/.stigmer/platform-token.key, else generated and persisted — the
 *     runner-token key's convention, under the ladder's own rules). It
 *     signs and verifies with the same key; no audience; a kid derived
 *     from the key, so two installations never claim the same kid.
 *   - A composition supplies its own ring through the `platformTokenKeys`
 *     driver point, built from its configured PEMs with
 *     `platformTokenKeyRingFromPem`: the active public key first, then any
 *     still accepted (the rotation window), an optional private key (a
 *     ring without one verifies and never signs), its kid and audience.
 *
 * Only RSA keys of at least MIN_RSA_MODULUS_BITS are accepted: the
 * envelope signs PKCS#1 v1.5 over SHA-256 (RS256) and asks the key for
 * nothing else, so an EC key would silently change the algorithm.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";
import type { KeyObject } from "node:crypto";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { getOrCreateKey } from "../encryption/key-manager.js";
import type { KeyCodec, KeyLoaderOptions } from "../encryption/key-manager.js";

/** Env var carrying open source's signing key: Base64 of a PKCS#8 PEM. */
export const PLATFORM_TOKEN_KEY_ENV_VAR = "STIGMER_PLATFORM_TOKEN_KEY";

/** Key file under ~/.stigmer for the generated signing key (PKCS#8 PEM). */
export const PLATFORM_TOKEN_KEY_FILE_NAME = "platform-token.key";

/**
 * The default lifetime of a signed token: the cloud's user-token lifetime
 * since the Java issuer (STIGMER_JWT_USER_TOKEN_TTL_SECONDS' default). It
 * bounds how long a user token outlives a rotated secret or a lost key; a
 * deleted client's tokens stop at the next request regardless (the
 * verifier's liveness).
 */
export const DEFAULT_PLATFORM_TOKEN_TTL_SECONDS = 900;

/** The smallest RSA modulus the ring accepts (NIST SP 800-131A's floor). */
export const MIN_RSA_MODULUS_BITS = 2048;

/** The key that signs, and the kid its tokens' header names. */
export interface PlatformTokenSigner {
  readonly key: KeyObject;
  readonly kid: string;
}

export interface PlatformTokenKeyRing {
  /** Absent: the ring verifies and never signs (minting is disabled). */
  readonly signer?: PlatformTokenSigner;
  /** Every public key a token may verify against, the active one first. */
  readonly verificationKeys: ReadonlyArray<KeyObject>;
  /** Stamped as `aud` and checked when present; "" means none. */
  readonly audience: string;
  /**
   * The lifetime of a token signed without one of its own: the user
   * token's. A lane that lives longer or shorter passes its own to
   * `signPlatformToken`.
   */
  readonly ttlSeconds: number;
}

/** A ring that can sign — what `signPlatformToken` takes. */
export type SigningPlatformTokenKeyRing = PlatformTokenKeyRing & {
  readonly signer: PlatformTokenSigner;
};

export function canSign(
  ring: PlatformTokenKeyRing,
): ring is SigningPlatformTokenKeyRing {
  return ring.signer !== undefined;
}

/** A composition's configured key material, as PEM text. */
export interface PlatformTokenKeyMaterial {
  /** PKCS#8 or PKCS#1 private key; absent disables signing. */
  readonly privateKeyPem?: string;
  /** The header kid; defaults to one derived from the private key. */
  readonly kid?: string;
  /** SPKI public keys, the active one first; at least one. */
  readonly publicKeyPems: ReadonlyArray<string>;
  readonly audience?: string;
  readonly ttlSeconds?: number;
}

/**
 * Builds a ring from PEM text, refusing loudly at boot what would fail
 * quietly at the first request: a non-RSA or undersized key, an empty
 * verification set, a non-positive TTL, and a private key whose public
 * half is not among the verification keys (it would sign tokens nothing
 * accepts).
 */
export function platformTokenKeyRingFromPem(
  material: PlatformTokenKeyMaterial,
): PlatformTokenKeyRing {
  if (material.publicKeyPems.length === 0) {
    throw new Error(
      "a platform-token key ring needs at least one public key to verify against",
    );
  }
  const verificationKeys = material.publicKeyPems.map((pem, index) =>
    requireRsa(
      parseKey(() => createPublicKey(pem), `public key ${index + 1}`),
      `public key ${index + 1}`,
    ),
  );
  const ttlSeconds = material.ttlSeconds ?? DEFAULT_PLATFORM_TOKEN_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(
      `platform-token TTL must be a positive integer number of seconds, got ${ttlSeconds}`,
    );
  }
  const base = {
    verificationKeys,
    audience: material.audience ?? "",
    ttlSeconds,
  };
  if (material.privateKeyPem === undefined) {
    return base;
  }
  const privateKey = requireRsa(
    parseKey(
      () => createPrivateKey(material.privateKeyPem ?? ""),
      "private key",
    ),
    "private key",
  );
  const derivedPublic = spkiOf(createPublicKey(privateKey));
  if (!verificationKeys.some((key) => spkiOf(key).equals(derivedPublic))) {
    throw new Error(
      "the platform-token private key's public half is not among the verification keys — tokens it signed would verify nowhere",
    );
  }
  return {
    ...base,
    signer: { key: privateKey, kid: material.kid ?? kidOf(privateKey) },
  };
}

/**
 * The ring a composition runs with, decided once at the keys stage:
 *   - no authentication posture: none — a server that trusts every
 *     request verifies nothing, so it signs nothing (the mint refuses);
 *   - a supplied ring: that ring;
 *   - none supplied, open source: open source's own ring on the ladder;
 *   - none supplied, any other edition: a boot throw, so a hosted edition
 *     can never sign with a key generated into a pod's home directory,
 *     which no other replica shares and no restart keeps.
 */
export function resolvePlatformTokenKeys(input: {
  readonly requireAuthentication: boolean;
  readonly supplied: PlatformTokenKeyRing | undefined;
  readonly edition: ServerEdition;
  readonly options?: KeyLoaderOptions;
}): PlatformTokenKeyRing | undefined {
  if (!input.requireAuthentication) {
    return undefined;
  }
  if (input.supplied !== undefined) {
    return input.supplied;
  }
  if (input.edition !== ServerEdition.oss) {
    throw new Error(
      `the ${ServerEdition[input.edition]} edition requires authentication but registers no platform-token key ring — register drivers.platformTokenKeys; only open source generates its own key`,
    );
  }
  return openSourcePlatformTokenKeyRing(input.options);
}

/**
 * Open source's ring: one RSA key on the key-manager ladder, signing and
 * verifying, no audience, the default TTL. Throws when an explicitly
 * configured STIGMER_PLATFORM_TOKEN_KEY is unusable (the ladder's rule).
 */
export function openSourcePlatformTokenKeyRing(
  options: KeyLoaderOptions = {},
): SigningPlatformTokenKeyRing {
  const privateKey = getOrCreateKey(
    RSA_PRIVATE_KEY,
    PLATFORM_TOKEN_KEY_ENV_VAR,
    PLATFORM_TOKEN_KEY_FILE_NAME,
    options,
  );
  return {
    signer: { key: privateKey, kid: kidOf(privateKey) },
    verificationKeys: [createPublicKey(privateKey)],
    audience: "",
    ttlSeconds: DEFAULT_PLATFORM_TOKEN_TTL_SECONDS,
  };
}

/** The ladder codec for an RSA private key stored as PKCS#8 PEM. */
export const RSA_PRIVATE_KEY: KeyCodec<KeyObject> = {
  fromEnv(envVar, decoded) {
    const key = parseKey(
      () => createPrivateKey(decoded.toString("utf8")),
      envVar,
    );
    return requireRsa(key, envVar);
  },
  fromFile(content) {
    try {
      const key = createPrivateKey(content.toString("utf8"));
      return isUsableRsa(key) ? key : undefined;
    } catch {
      return undefined;
    }
  },
  generate() {
    return generateKeyPairSync("rsa", { modulusLength: MIN_RSA_MODULUS_BITS })
      .privateKey;
  },
  toFile(key) {
    return Buffer.from(key.export({ format: "pem", type: "pkcs8" }));
  },
};

/** A key's kid: the first 16 characters of its public half's SHA-256. */
function kidOf(key: KeyObject): string {
  const publicKey = key.type === "private" ? createPublicKey(key) : key;
  return createHash("sha256")
    .update(spkiOf(publicKey))
    .digest("base64url")
    .slice(0, 16);
}

function spkiOf(publicKey: KeyObject): Buffer {
  return publicKey.export({ format: "der", type: "spki" });
}

function parseKey(parse: () => KeyObject, what: string): KeyObject {
  try {
    return parse();
  } catch (error) {
    throw new Error(
      `${what} is not a readable PEM key: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireRsa(key: KeyObject, what: string): KeyObject {
  if (!isUsableRsa(key)) {
    throw new Error(
      `${what} must be an RSA key of at least ${MIN_RSA_MODULUS_BITS} bits`,
    );
  }
  return key;
}

function isUsableRsa(key: KeyObject): boolean {
  return (
    key.asymmetricKeyType === "rsa" &&
    (key.asymmetricKeyDetails?.modulusLength ?? 0) >= MIN_RSA_MODULUS_BITS
  );
}
