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
 * is fetched once (memoized on success, retried on the next request after
 * a failure — a flaky IdP at boot must not permanently brick the lane),
 * its `issuer` field must match the configured issuer exactly (RFC 8414
 * §3.3), and the JWKS rides jose's createRemoteJWKSet (cached, rotation-
 * aware). Discovery/JWKS OUTAGES are infrastructure faults — thrown as
 * plain errors so the chassis maps them to INTERNAL, never a credential
 * rejection (the DD-007 unavailable doctrine).
 *
 * Identity: identityId = `sub` (rejected as invalid when absent), issuer =
 * the configured issuer, email/displayName from the standard `email`/`name`
 * claims when present (the DD-007 Q5 addendum added the fields for exactly
 * these claims).
 */
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import type { JWTPayload } from "jose";
import { Code, ConnectError } from "@connectrpc/connect";

import type {
  CallerIdentity,
  IdentityVerifier,
} from "../extensions/identity.js";

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
}

interface DiscoveredIssuer {
  readonly jwks: ReturnType<typeof createRemoteJWKSet>;
}

export function newOidcIdentityVerifier(
  config: OidcVerifierConfig,
): IdentityVerifier {
  let discovered: DiscoveredIssuer | undefined;

  async function discover(): Promise<DiscoveredIssuer> {
    if (discovered !== undefined) {
      return discovered;
    }
    const url = discoveryUrl(config.issuer);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `OIDC discovery failed: ${url} answered HTTP ${response.status}`,
      );
    }
    const document = (await response.json()) as {
      issuer?: string;
      jwks_uri?: string;
    };
    if (document.issuer !== config.issuer) {
      throw new Error(
        `OIDC discovery failed: document issuer '${document.issuer ?? ""}' does not match configured issuer '${config.issuer}'`,
      );
    }
    if (typeof document.jwks_uri !== "string" || document.jwks_uri === "") {
      throw new Error(`OIDC discovery failed: ${url} carries no jwks_uri`);
    }
    discovered = { jwks: createRemoteJWKSet(new URL(document.jwks_uri)) };
    return discovered;
  }

  return {
    name: "oidc",
    async verify(token: string): Promise<CallerIdentity | null> {
      if (!isJwtShaped(token)) {
        return null;
      }
      const issuer = await discover();
      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(token, issuer.jwks, {
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
        identityId: payload.sub,
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

/** issuer + /.well-known/openid-configuration (trailing-slash tolerant). */
function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
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
