/**
 * The OIDC userinfo client (20260911.11, T01_1_review.md A8) — the
 * infrastructure behind the identity-account domain's UserInfoClient
 * port (domain/identityaccount/provisioning.ts): the profile of the
 * bearer of an access token, from the `userinfo_endpoint` the token's
 * ISSUER publishes, fetched with that very token.
 *
 * The issuer is a per-call argument, not a construction-time binding,
 * because the composition does not know which issuer will vouch for a
 * caller: open source's own OIDC lane names one in STIGMER_OIDC_ISSUER,
 * the cloud's verifiers name theirs on the CallerIdentity they mint. The
 * one issuer whose userinfo can answer for a token is the one that issued
 * it — and a verifier already trusted it, so the token goes only where it
 * came from.
 *
 * The endpoint is the discovery document's word, never a guessed
 * `<issuer>/userinfo`: a document that names no `userinfo_endpoint` is
 * refused as a fetch failure (the domain maps it UNAVAILABLE with the
 * cloud's copy), so a misconfigured issuer fails loudly at the first
 * sign-in rather than silently against a wrong URL.
 *
 * Claims read as the cloud's client reads them: `email`, `given_name`,
 * `family_name`, `picture`; a missing or non-string claim is the empty
 * string. Any non-2xx or malformed answer throws; the domain's
 * UserInfoFetchError wraps it.
 */
import type {
  UserInfoClient,
  UserProfile,
} from "../domain/identityaccount/provisioning.js";
import type { IssuerDiscovery } from "./oidc-discovery.js";

export function newOidcUserInfoClient(
  discovery: IssuerDiscovery,
  fetchImpl: typeof fetch = fetch,
): UserInfoClient {
  return {
    async fetchUserProfile(issuer, accessToken): Promise<UserProfile> {
      const { userinfoEndpoint } = await discovery.discover(issuer);
      if (userinfoEndpoint === undefined) {
        throw new Error(
          `issuer '${issuer}' publishes no userinfo_endpoint in its discovery document`,
        );
      }
      const response = await fetchImpl(userinfoEndpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`userinfo answered ${response.status}`);
      }
      const claims = (await response.json()) as Record<string, unknown>;
      const text = (key: string): string => {
        const value = claims[key];
        return typeof value === "string" ? value : "";
      };
      return {
        email: text("email"),
        firstName: text("given_name"),
        lastName: text("family_name"),
        pictureUrl: text("picture"),
      };
    },
  };
}
