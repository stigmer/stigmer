/**
 * OIDC issuer discovery (20260911.11, T01_1_review.md A8) — the one
 * reader of `/.well-known/openid-configuration`, shared by every lane
 * that needs an issuer's endpoints: the userinfo client (oidc-userinfo.ts)
 * today, the identity verifier's JWKS location when it moves onto this
 * module (slice 2), so one issuer is discovered once and validated the
 * same way wherever it is consumed.
 *
 * The verifier's rules, kept: the document's `issuer` must equal the
 * requested issuer exactly (RFC 8414 §3.3 — a document that names another
 * issuer is a misconfiguration or a redirect to somewhere else); `jwks_uri`
 * is required (OpenID Connect Discovery 1.0 §3 says so). `userinfo_endpoint`
 * is RECOMMENDED by the spec, so it is carried when present and its
 * consumer decides what its absence means.
 *
 * Memoized per issuer ON SUCCESS only: a failed fetch is retried on the
 * next call, so a flaky IdP at boot never permanently bricks a lane. An
 * outage is an infrastructure fault thrown as a plain error — the caller
 * maps it (the chassis to INTERNAL, the provisioning handler to
 * UNAVAILABLE), never a credential rejection. The fetch is injected so
 * tests never dial out and the composition root owns the process boundary.
 */

export interface DiscoveredIssuer {
  readonly issuer: string;
  readonly jwksUri: string;
  /** Absent when the document names none. */
  readonly userinfoEndpoint: string | undefined;
}

export interface IssuerDiscovery {
  /** The validated document for `issuer`, from the cache after the first success. */
  discover(issuer: string): Promise<DiscoveredIssuer>;
}

export function discoveryUrl(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

export function newIssuerDiscovery(
  fetchImpl: typeof fetch = fetch,
): IssuerDiscovery {
  const discovered = new Map<string, DiscoveredIssuer>();
  return {
    async discover(issuer: string): Promise<DiscoveredIssuer> {
      const cached = discovered.get(issuer);
      if (cached !== undefined) {
        return cached;
      }
      const url = discoveryUrl(issuer);
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(
          `OIDC discovery failed: ${url} answered HTTP ${response.status}`,
        );
      }
      const document = (await response.json()) as {
        issuer?: unknown;
        jwks_uri?: unknown;
        userinfo_endpoint?: unknown;
      };
      if (document.issuer !== issuer) {
        throw new Error(
          `OIDC discovery failed: document issuer '${typeof document.issuer === "string" ? document.issuer : ""}' does not match configured issuer '${issuer}'`,
        );
      }
      if (typeof document.jwks_uri !== "string" || document.jwks_uri === "") {
        throw new Error(`OIDC discovery failed: ${url} carries no jwks_uri`);
      }
      const result: DiscoveredIssuer = {
        issuer,
        jwksUri: document.jwks_uri,
        userinfoEndpoint:
          typeof document.userinfo_endpoint === "string" &&
          document.userinfo_endpoint !== ""
            ? document.userinfo_endpoint
            : undefined,
      };
      discovered.set(issuer, result);
      return result;
    },
  };
}
