/**
 * OpenID Connect Discovery for the composition's OIDC-class lanes: where an
 * issuer's document lives, and the document read into the facts a lane
 * trusts it for. One mechanism with two callers, the way `jwks.ts` is: a
 * host's direct-login lane discovers the platform's own tenant once at
 * boot, and the federation-issuer lane reads each issuer a provider names
 * when the provider is saved, so that the key set and the userinfo endpoint
 * it trusts are the ones the issuer itself publishes
 * (`iam/issuer/validation.ts`).
 *
 * One mechanism, one POLICY PER CALLER: the fetch is a required input
 * because the two lanes dial different kinds of URL (the tenant is the
 * operator's configuration; a provider's issuer is written by an
 * organization admin and must ride the egress-guarded fetch), and the read
 * answers a value, never a throw, because the two lanes answer a bad
 * document differently: the direct lane refuses the boot, the provider
 * lane refuses the save with fixed copy. Neither the canonical comparison
 * of the document's issuer nor any copy lives here.
 *
 * The document's `issuer`, `jwks_uri` and `userinfo_endpoint` are the
 * facts the lanes use. `endpoints` is every URL the document names at its
 * top level (the issuer, the token, authorization and userinfo endpoints
 * among them): a provider's audience may not be one of them, because an issuer
 * can add such a URL to every token it mints (Auth0 adds its userinfo URL
 * whenever `openid` is requested), and an audience every token carries
 * identifies no registration.
 */

/**
 * OIDC Discovery 1.0 §4: the issuer, without its trailing slashes, plus the
 * well-known path. The slashes are trimmed by a scan from the end, never a
 * pattern: a provider's issuer is written by an organization admin, and a
 * pattern that backtracks over a run of slashes costs the square of its
 * length.
 */
export function discoveryUrl(issuer: string): string {
  let end = issuer.length;
  while (end > 0 && issuer[end - 1] === "/") end -= 1;
  return `${issuer.slice(0, end)}/.well-known/openid-configuration`;
}

/** The facts a discovery document gives a lane. */
export interface OidcDiscoveryDocument {
  /** The issuer exactly as the document publishes it. */
  readonly issuer: string;
  readonly jwksUri: string;
  /** Absent when the document names none. */
  readonly userinfoEndpoint: string | undefined;
  /** Every string value at the document's top level that parses as an absolute URL. */
  readonly endpoints: ReadonlyArray<string>;
}

/** What reading one issuer's document found. */
export type DiscoveryRead =
  | { readonly kind: "document"; readonly url: string; readonly document: OidcDiscoveryDocument }
  | { readonly kind: "unreachable"; readonly url: string; readonly cause: unknown }
  | { readonly kind: "status"; readonly url: string; readonly status: number }
  | { readonly kind: "malformed"; readonly url: string; readonly missing: "json" | "issuer" | "jwks_uri" };

export interface DiscoveryReadOptions {
  /** The fetch this caller's documents are dialed with; its trust is the caller's statement. */
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
}

/** Reads the discovery document of `issuer`. Never throws. */
export async function readDiscoveryDocument(
  issuer: string,
  options: DiscoveryReadOptions,
): Promise<DiscoveryRead> {
  const url = discoveryUrl(issuer);
  let response: Response;
  try {
    response = await options.fetchImpl(url, {
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    return { kind: "unreachable", url, cause };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: "status", url, status: response.status };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "malformed", url, missing: "json" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { kind: "malformed", url, missing: "json" };
  }
  const fields = body as Record<string, unknown>;
  if (typeof fields.issuer !== "string" || fields.issuer === "") {
    return { kind: "malformed", url, missing: "issuer" };
  }
  if (typeof fields.jwks_uri !== "string" || fields.jwks_uri === "") {
    return { kind: "malformed", url, missing: "jwks_uri" };
  }
  const userinfo = fields.userinfo_endpoint;
  return {
    kind: "document",
    url,
    document: {
      issuer: fields.issuer,
      jwksUri: fields.jwks_uri,
      userinfoEndpoint: typeof userinfo === "string" && userinfo !== "" ? userinfo : undefined,
      endpoints: Object.values(fields).filter(isAbsoluteUrl),
    },
  };
}

function isAbsoluteUrl(value: unknown): value is string {
  return typeof value === "string" && URL.canParse(value);
}
