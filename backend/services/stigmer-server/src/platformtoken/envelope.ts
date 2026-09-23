/**
 * The platform-token envelope: the RS256 JWT every token the server signs
 * for itself rides — the PlatformClient user token in open source, and in
 * the cloud its typed lanes (guest, schedule, channel, the sandbox family)
 * as well. One envelope, byte-compatible with the tokens Stigmer Cloud has
 * signed since the Java issuer, so a token minted before the cloud serves
 * this code verifies after it.
 *
 * The envelope knows the issuer, the four claims it owns (`iss`, `iat`,
 * `exp`, `jti`, plus `aud` when the ring carries an audience) and the
 * signature. It does not know lanes: a lane's vocabulary (its claims, its
 * `token_type`, the caller class it stamps) belongs to the verifier that
 * claims it — open source verifies only the untyped PlatformClient lane
 * (domain/platformclient/verifier.ts); the typed lanes stay the cloud's.
 *
 * Verification is the cloud verifier's, exactly (its verifiers/jwt.ts and
 * platform-token.ts), because the tokens in the field were accepted by it:
 *   - A token that is not a three-part JWT with `iss: "stigmer"` is
 *     `foreign` — some other verifier's to judge, never refused here.
 *   - The signature is RS256 over every key in the ring; the header's
 *     `alg` and `kid` are never read to choose (so neither `alg: none` nor
 *     an HMAC-with-the-public-key forgery can pass, and a constant kid
 *     across a rotation still verifies).
 *   - Then `exp` (required, a number, strictly in the future; no leeway),
 *     then `aud` (tolerated when absent, refused when it names another
 *     audience), then `sub` (a non-empty string) — in that order, each with
 *     its pinned copy.
 * The refusals are returned, not thrown: the envelope has no transport,
 * and a verifier turns a refusal into the wire error with
 * `platformTokenRefusalError`.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { randomUUID, sign, verify } from "node:crypto";

import type {
  PlatformTokenKeyRing,
  SigningPlatformTokenKeyRing,
} from "./key-ring.js";

/** The `iss` of every platform token (the cloud's STIGMER_ISSUER). */
export const PLATFORM_TOKEN_ISSUER = "stigmer";

/** The claim a typed lane names itself by; absent on the PlatformClient user token. */
export const TOKEN_TYPE_CLAIM = "token_type";

/** A lane claim's value: the token carries JSON scalars only. */
export type PlatformTokenClaimValue = string | number | boolean;

/** The claims the envelope owns; a lane may not set them. */
const ENVELOPE_CLAIMS = new Set(["iss", "iat", "exp", "jti", "aud"]);

export type PlatformTokenRefusal =
  | "signature"
  | "expired"
  | "audience"
  | "subject";

/** Wire copy, byte-pinned: the cloud verifier's sentences since the Java issuer. */
export const PLATFORM_TOKEN_REFUSAL_MESSAGES: Readonly<
  Record<PlatformTokenRefusal, string>
> = {
  signature: "platform token signature verification failed",
  expired: "platform token is expired",
  audience: "platform token was minted for another environment",
  subject: "platform token carries no subject",
};

/** A verified token: its subject, its lane discriminator, its payload. */
export interface VerifiedPlatformToken {
  readonly subject: string;
  /** The `token_type` claim when it is a non-empty string; undefined for the untyped lane. */
  readonly tokenType: string | undefined;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type PlatformTokenVerification =
  | { readonly outcome: "foreign" }
  | { readonly outcome: "refused"; readonly refusal: PlatformTokenRefusal }
  | { readonly outcome: "verified"; readonly token: VerifiedPlatformToken };

/**
 * Signs `claims` inside the envelope: header `{alg, typ, kid}`, then `iss`,
 * `iat`, `exp` (iat + the ring's TTL), `jti` and `aud` when the ring has
 * one, then the lane's claims. Throws when a lane claim collides with an
 * envelope claim — a programming error, never a request's.
 */
export function signPlatformToken(
  ring: SigningPlatformTokenKeyRing,
  claims: Readonly<Record<string, PlatformTokenClaimValue>>,
  now: Date = new Date(),
): string {
  for (const name of Object.keys(claims)) {
    if (ENVELOPE_CLAIMS.has(name)) {
      throw new Error(
        `platform-token claim '${name}' belongs to the envelope and cannot be set by a lane`,
      );
    }
  }
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: ring.signer.kid };
  const payload = {
    iss: PLATFORM_TOKEN_ISSUER,
    iat: issuedAt,
    exp: issuedAt + ring.ttlSeconds,
    jti: randomUUID(),
    ...(ring.audience !== "" ? { aud: ring.audience } : {}),
    ...claims,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = sign("sha256", Buffer.from(signingInput), ring.signer.key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Verifies a bearer token against the ring (see the header for the order). */
export function verifyPlatformToken(
  ring: PlatformTokenKeyRing,
  token: string,
  now: Date = new Date(),
): PlatformTokenVerification {
  const decoded = decode(token);
  if (decoded === undefined || decoded.payload.iss !== PLATFORM_TOKEN_ISSUER) {
    return { outcome: "foreign" };
  }
  const signingInput = Buffer.from(
    `${decoded.encodedHeader}.${decoded.encodedPayload}`,
  );
  const signatureValid = ring.verificationKeys.some((key) =>
    verify("sha256", signingInput, key, decoded.signature),
  );
  if (!signatureValid) {
    return { outcome: "refused", refusal: "signature" };
  }
  const exp = decoded.payload.exp;
  if (typeof exp !== "number" || exp * 1000 <= now.getTime()) {
    return { outcome: "refused", refusal: "expired" };
  }
  const aud = decoded.payload.aud;
  if (
    ring.audience !== "" &&
    aud !== undefined &&
    !audienceMatches(aud, ring.audience)
  ) {
    return { outcome: "refused", refusal: "audience" };
  }
  const sub = decoded.payload.sub;
  if (typeof sub !== "string" || sub === "") {
    return { outcome: "refused", refusal: "subject" };
  }
  return {
    outcome: "verified",
    token: {
      subject: sub,
      tokenType: stringClaim(decoded.payload, TOKEN_TYPE_CLAIM),
      payload: decoded.payload,
    },
  };
}

/** The UNAUTHENTICATED error a verifier answers for a refused platform token. */
export function platformTokenRefusalError(
  refusal: PlatformTokenRefusal,
): ConnectError {
  return new ConnectError(
    PLATFORM_TOKEN_REFUSAL_MESSAGES[refusal],
    Code.Unauthenticated,
  );
}

/**
 * The payload of a platform token WITHOUT verifying it — for a caller
 * guard reading the claims of a token the verifier chain already verified
 * on this request (caller-guards.ts: guards decode `rawToken`). Undefined
 * for anything that is not a platform token, an API key or an empty
 * trusted-local token included. Never a substitute for
 * `verifyPlatformToken`.
 */
export function decodeVerifiedPlatformTokenPayload(
  token: string,
): Readonly<Record<string, unknown>> | undefined {
  const decoded = decode(token);
  return decoded !== undefined && decoded.payload.iss === PLATFORM_TOKEN_ISSUER
    ? decoded.payload
    : undefined;
}

/** A payload claim when it is a non-empty string; undefined otherwise. */
export function stringClaim(
  payload: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = payload[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

interface DecodedToken {
  readonly encodedHeader: string;
  readonly encodedPayload: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signature: Buffer;
}

/** A three-part JWT whose header and payload are JSON objects; anything else is undefined. */
function decode(token: string): DecodedToken | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return undefined;
  }
  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] =
    parts;
  const header = parseJsonObject(encodedHeader);
  const payload = parseJsonObject(encodedPayload);
  if (header === undefined || payload === undefined) {
    return undefined;
  }
  return {
    encodedHeader,
    encodedPayload,
    payload,
    signature: Buffer.from(encodedSignature, "base64url"),
  };
}

function parseJsonObject(segment: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(segment, "base64url").toString("utf8"),
    );
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === "string") {
    return aud === expected;
  }
  return Array.isArray(aud) && aud.includes(expected);
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
