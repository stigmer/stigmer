/**
 * The generic OIDC identity verifier (O3, 20260827.06; DD-003: verification
 * is OSS, the issuer is configuration) — the second OSS entry on the
 * chassis's verifier chain, the TS rendering of the cloud's Nimbus
 * JwtDecoders.fromOidcIssuerLocation + audience validator stack. Stigmer
 * Cloud points STIGMER_OIDC_ISSUER at Auth0 and registers NO code here;
 * any self-host points it at their own issuer (Keycloak, Okta, Dex, …).
 *
 * Claim rule: a JWT-shaped token (three non-empty dot-separated segments)
 * whose `iss` is this lane's issuer, compared exactly, as discovery
 * compares it. API keys never look like JWTs (`stk_` + one Base64URL run),
 * so ordering after the apikey verifier keeps both claims disjoint. A JWT
 * naming another issuer PASSES, so a lane composed after this one (a
 * composition's own sign-in lane for another issuer) can claim it, and a
 * token no lane claims is refused by the verifier chain as unclaimed —
 * UNAUTHENTICATED either way. The `iss` read before verification only
 * routes the token; it grants nothing, because a claimed token is then
 * verified whole against this issuer's keys. A JWT-shaped token with no
 * readable string `iss` is malformed and THROWS "invalid token". A claimed
 * token that fails verification THROWS (identity.ts contract) with the
 * Java classifyAuthError copy, byte-pinned:
 *
 *   - expiry → "token has expired"
 *   - audience mismatch → "token audience does not match the expected audience"
 *   - signature / JWKS-key failures → "token signature verification failed"
 *   - everything else → "invalid token"
 *
 * Discovery and key handling: the issuer's /.well-known/openid-configuration
 * is read through the shared oidc-discovery module the composition root
 * builds once for every lane (20260911.11 A8 — the userinfo client reads
 * the same document, so one issuer is discovered once and validated the
 * same way wherever it is consumed: `issuer` must match exactly, RFC 8414
 * §3.3; `jwks_uri` required). The module memoizes on success only, so a
 * flaky IdP at boot never permanently bricks the lane. The JWKS client
 * (jose's createRemoteJWKSet — cached, rotation-aware) is built ONCE per
 * verifier from the discovered location and kept: discovery hands back a
 * URI, and a client rebuilt per request would refetch the keys per
 * request. Discovery/JWKS OUTAGES are infrastructure faults — thrown as
 * plain errors so the chassis maps them to INTERNAL, never a credential
 * rejection (the DD-007 unavailable doctrine).
 *
 * Identity (20260911.11 Q-IA-2, A1 — the cloud's direct-login posture):
 * after the token verifies, `sub` (rejected as invalid when absent) is
 * resolved through the identity-account domain (principalForSubject):
 * a subject with a direct account stamps the ACCOUNT id with the email
 * and display name the account row carries; a subject without one is
 * admitted idp-shaped (identityId = sub) so whoAmI can answer NOT_FOUND
 * and provisionMyAccount can run. One primary-key read per request, no
 * cache; a store fault is an infrastructure fault. The issuer is the
 * configured issuer. The standard `email` and `name` claims stand in
 * only where the row says nothing (actor.ts has the rule), and are all
 * an unprovisioned caller has:
 * the row is the platform's record, and many issuers put no profile
 * claims in access tokens (Auth0's carry none by default), which left
 * every resource such a person created naming an id and nothing else
 * (stigmer/stigmer#1226). Claim-or-pass runs before any of this: a
 * non-JWT token, and a JWT from another issuer, passes with no network.
 */
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  errors as joseErrors,
} from "jose";
import type { JWTPayload } from "jose";
import { Code, ConnectError } from "@connectrpc/connect";

import { principalForSubject } from "../domain/identityaccount/resolve.js";
import type { AccountsBySubject } from "../domain/identityaccount/resolve.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../extensions/identity.js";
import type { IssuerDiscovery } from "./oidc-discovery.js";

/** Java classifyAuthError arms — byte-pinned cross-edition copy. */
export const TOKEN_EXPIRED_MESSAGE = "token has expired";
export const TOKEN_AUDIENCE_MESSAGE =
  "token audience does not match the expected audience";
export const TOKEN_SIGNATURE_MESSAGE = "token signature verification failed";
export const INVALID_TOKEN_MESSAGE = "invalid token";

export interface OidcVerifierConfig {
  /** The issuer URL (already URL-validated by the config loader). */
  readonly issuer: string;
  /** The audience access tokens must carry. */
  readonly audience: string;
  /** The identity-account domain's subject lookup — REQUIRED: what identityId means depends on it. */
  readonly accounts: AccountsBySubject;
  /** The composition root's one discovery for every lane (A8). */
  readonly discovery: IssuerDiscovery;
}

type RemoteJwks = ReturnType<typeof createRemoteJWKSet>;

export function newOidcIdentityVerifier(
  config: OidcVerifierConfig,
): IdentityVerifier {
  // Set on the first successful discovery only: a failed discovery leaves
  // it unset so the next request retries (the module caches no failure).
  let jwks: RemoteJwks | undefined;

  async function jwksFor(): Promise<RemoteJwks> {
    if (jwks !== undefined) {
      return jwks;
    }
    const { jwksUri } = await config.discovery.discover(config.issuer);
    jwks = createRemoteJWKSet(new URL(jwksUri));
    return jwks;
  }

  return {
    name: "oidc",
    async verify(token: string): Promise<CallerIdentity | null> {
      if (!isJwtShaped(token)) {
        return null;
      }
      if (unverifiedIssuerOf(token) !== config.issuer) {
        return null;
      }
      const keys = await jwksFor();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, keys, {
          issuer: config.issuer,
          audience: config.audience,
        }));
      } catch (error) {
        throw classifyJoseError(error);
      }
      if (typeof payload.sub !== "string" || payload.sub === "") {
        throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
      }
      return {
        ...(await principalForSubject(config.accounts, payload.sub, {
          email: stringClaim(payload, "email"),
          displayName: stringClaim(payload, "name"),
        })),
        callerClass: "user",
        issuer: config.issuer,
        rawToken: token,
      };
    },
  };
}

/** A verified token's string claim, or undefined when it carries none. */
function stringClaim(payload: JWTPayload, name: string): string | undefined {
  const value = payload[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The `iss` a JWT-shaped token names, read without verifying it — only to
 * decide which lane verifies it. A payload that does not decode, or names
 * no string issuer, is a malformed credential this lane refuses outright.
 */
function unverifiedIssuerOf(token: string): string {
  let issuer: unknown;
  try {
    issuer = decodeJwt(token).iss;
  } catch {
    throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
  }
  if (typeof issuer !== "string" || issuer === "") {
    throw new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
  }
  return issuer;
}

/** Three non-empty dot-separated segments — the JWS compact shape. */
function isJwtShaped(token: string): boolean {
  const segments = token.split(".");
  return segments.length === 3 && segments.every((s) => s !== "");
}

/**
 * Maps jose's verification failures onto the Java classifyAuthError arms.
 * JWKS transport failures (discovery succeeded, key fetch did not) are
 * NOT credential rejections — they rethrow as plain errors for the
 * chassis's INTERNAL arm.
 */
function classifyJoseError(error: unknown): unknown {
  if (error instanceof joseErrors.JWTExpired) {
    return new ConnectError(TOKEN_EXPIRED_MESSAGE, Code.Unauthenticated);
  }
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    if (error.claim === "aud") {
      return new ConnectError(TOKEN_AUDIENCE_MESSAGE, Code.Unauthenticated);
    }
    return new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
  }
  if (
    error instanceof joseErrors.JWSSignatureVerificationFailed ||
    error instanceof joseErrors.JWKSNoMatchingKey ||
    error instanceof joseErrors.JWKSMultipleMatchingKeys ||
    error instanceof joseErrors.JWKSInvalid
  ) {
    return new ConnectError(TOKEN_SIGNATURE_MESSAGE, Code.Unauthenticated);
  }
  if (
    error instanceof joseErrors.JWTInvalid ||
    error instanceof joseErrors.JWSInvalid ||
    // A JWT whose algorithm the issuer's key set cannot serve (an HS256
    // token against an RS256 JWKS): a credential this verifier recognizes
    // but cannot verify, so a credential rejection — never the
    // infrastructure arm. Until 2026-09-16 it fell through to INTERNAL,
    // and a self-host with sign-in on failed every agent execution on its
    // own runner token (stigmer#1137).
    error instanceof joseErrors.JOSENotSupported
  ) {
    return new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
  }
  // JWKSTimeout, fetch failures, and anything unclassified: infrastructure —
  // the chassis maps a non-ConnectError throw to INTERNAL.
  return error;
}
