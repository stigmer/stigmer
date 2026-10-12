/**
 * The OIDC /userinfo client of the federated login lane: the profile a
 * customer's IdP states for a JIT-provisioned subject, fetched with the
 * caller's own access token from the endpoint the IdentityProvider row
 * names. The federated lane is its ONLY consumer: direct-account
 * provisioning is open source's, and discovers the userinfo endpoint of
 * the issuer that vouched for the token, so it never reads this module.
 *
 * The shape is open source's own userinfo client
 * (`identity/oidc-userinfo.ts` in `@stigmer/server`): the fetch is bound
 * at construction, the endpoint arrives per call, and it is used exactly
 * as stated — the row's `userinfo_endpoint` is the full OIDC UserInfo URL
 * (the proto's own examples end in `/userinfo`), never a base to append
 * to. Two deliberate differences, both because an organization admin
 * writes the endpoint rather than an issuer the platform already trusts:
 * the fetch is the host's egress-guarded `OutboundFetch`, so a private, loopback or link-local destination is
 * refused before a request leaves the process, and every call is bounded
 * by USERINFO_FETCH_TIMEOUT_MS, so an endpoint that never answers cannot
 * hold a sign-in open.
 */
import type { OutboundFetch } from "@stigmer/outbound/egress";

/** The bound on one userinfo call; the federated lane's JWKS fetch uses the same (verifiers/jwks.ts). */
export const USERINFO_FETCH_TIMEOUT_MS = 10_000;

/** The profile an identity provider's userinfo endpoint states. */
export interface UserProfile {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly pictureUrl: string;
}

export interface UserInfoClient {
  /**
   * The profile the bearer of `accessToken` has at `endpoint`. Throws on a
   * refused destination, a timeout, any non-2xx or a malformed answer (the
   * lane maps the failure).
   */
  fetchUserProfile(endpoint: string, accessToken: string): Promise<UserProfile>;
}

export function newUserInfoClient(outboundFetch: OutboundFetch): UserInfoClient {
  return {
    async fetchUserProfile(endpoint, accessToken): Promise<UserProfile> {
      const response = await outboundFetch(endpoint, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(USERINFO_FETCH_TIMEOUT_MS),
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
