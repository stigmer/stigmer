/**
 * An identity provider's routes: the pairs (canonical issuer, audience) a
 * token is routed by, and which one provider on the platform holds each.
 * Pure over the provider's payload, so the validation matrix, the
 * verifier's index and every store adapter derive a provider's routes the
 * same way; the Postgres adapter keeps them in its route side table
 * (store.ts), and the contract states the pair (`expected_audience` is
 * required, and no two providers share an issuer and audience).
 */
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";

/** One route: an issuer the provider names, with the provider's audience. */
export interface ProviderRoute {
  readonly issuer: string;
  readonly audience: string;
}

/**
 * The routes a provider claims: each of its issuers with its audience,
 * once, so an issuer the payload names twice is one route on every
 * adapter. A provider with no audience claims none, so it can never route
 * a token (the contract requires the audience on every write; only a row
 * stored before that rule can lack one).
 */
export function routesOf(provider: IdentityProvider): ReadonlyArray<ProviderRoute> {
  const audience = provider.spec?.expectedAudience ?? "";
  if (audience === "") {
    return [];
  }
  return [...new Set(provider.spec?.allowedIssuers ?? [])].map((issuer) => ({ issuer, audience }));
}
