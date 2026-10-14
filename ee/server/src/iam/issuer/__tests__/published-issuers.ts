/**
 * Issuers that publish what a provider's save reads, for the suites that
 * create providers through the real lane: every `https://*.test` name
 * resolves to a public address, every issuer's OpenID Connect discovery
 * document names `<issuer>/jwks`, and that key set serves one RSA key. A
 * create therefore passes the discovery binding and the key-set check
 * exactly as a real Auth0 or Okta tenant does, through the real guarded
 * fetch, with no DNS and no socket. The unit suite of the lane scripts its
 * answers by hand instead (handlers.test.ts), because it pins each refusal.
 */
import type { LookupFn, OutboundFetch } from "@stigmer/outbound/egress";

const DISCOVERY_PATH = "/.well-known/openid-configuration";
const KEYS = JSON.stringify({ keys: [{ kty: "RSA", kid: "k1", n: "AQAB", e: "AQAB" }] });

/** The key set every published issuer's document names. */
export function jwksOf(issuer: string): string {
  return `${issuer.replace(/\/+$/, "")}/jwks`;
}

/** A spec's issuer fields for a published issuer: the issuer and the key set its document names. */
export function publishedIssuer(issuer: string): { allowedIssuers: string[]; jwksUri: string } {
  return { allowedIssuers: [issuer], jwksUri: jwksOf(issuer) };
}

/** Every `.test` name answers a public address. */
export const publicLookup: LookupFn = (hostname) =>
  hostname.endsWith(".test")
    ? Promise.resolve(["104.16.0.1"])
    : Promise.reject(new Error(`ENOTFOUND ${hostname}`));

/** The underlying fetch: a document for every issuer, a key set for every document. */
export const publishedIssuersFetch: OutboundFetch = (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith(DISCOVERY_PATH)) {
    const issuer = `${url.origin}${url.pathname.slice(0, -DISCOVERY_PATH.length)}`;
    return Promise.resolve(
      new Response(JSON.stringify({ issuer: `${issuer}/`, jwks_uri: jwksOf(issuer) })),
    );
  }
  if (url.pathname.endsWith("/jwks")) {
    return Promise.resolve(new Response(KEYS));
  }
  return Promise.reject(new TypeError("fetch failed"));
};
