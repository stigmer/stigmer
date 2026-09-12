/**
 * The generic OIDC identity verifier (O3, 20260827.06; DD-003: verification
 * is OSS, the issuer is configuration) — the second OSS entry on the
 * chassis's verifier chain, the TS rendering of the cloud's Nimbus
 * JwtDecoders.fromOidcIssuerLocation + audience validator stack. Stigmer
 * Cloud points STIGMER_OIDC_ISSUER at Auth0 and registers NO code here;
 * any self-host points it at their own issuer (Keycloak, Okta, Dex, …).
 *
 * Claim rule: any JWT-shaped token (three non-empty dot-separated
 * segments). API keys never look like JWTs (`stk_` + one Base64URL run),
 * so ordering after the apikey verifier keeps both claims disjoint; a
 * JWT-shaped token that fails verification THROWS (identity.ts contract)
 * with the Java classifyAuthError copy, byte-pinned:
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
 * resolved through the identity-account domain (identityIdForSubject):
 * a subject with a direct account stamps the ACCOUNT id; a subject
 * without one is admitted idp-shaped (identityId = sub) so whoAmI can
 * answer NOT_FOUND and provisionMyAccount can run. One primary-key read
 * per request, no cache; a store fault is an infrastructure fault. The
 * issuer is the configured issuer; email/displayName come from the
 * standard `email`/`name` claims when present (the DD-007 Q5 addendum
 * added the fields for exactly these claims), whichever way the subject
 * resolved. Claim-or-pass runs before any of this: a non-JWT token
 * passes with no network.
 */
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { JWTPayload } from "jose";
import { Code, ConnectError } from "@connectrpc/connect";

import { identityIdForSubject } from "../domain/identityaccount/resolve.js";
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
        identityId: await identityIdForSubject(config.accounts, payload.sub),
        callerClass: "user",
        issuer: config.issuer,
        rawToken: token,
        ...(typeof payload["email"] === "string" && payload["email"] !== ""
          ? { email: payload["email"] }
          : {}),
        ...(typeof payload["name"] === "string" && payload["name"] !== ""
          ? { displayName: payload["name"] }
          : {}),
      };
    },
  };
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
    error instanceof joseErrors.JWSInvalid
  ) {
    return new ConnectError(INVALID_TOKEN_MESSAGE, Code.Unauthenticated);
  }
  // JWKSTimeout, fetch failures, and anything unclassified: infrastructure —
  // the chassis maps a non-ConnectError throw to INTERNAL.
  return error;
}
