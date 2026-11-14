// ---------------------------------------------------------------------------
// Sign-up parameters: the deployment's extra words for "show sign-up"
//
// `/login?signup=1` asks the identity provider for its create-account screen
// instead of its sign-in screen. The OpenID Connect standard for that is
// `prompt=create`, sent only when the issuer's discovery lists it
// (oidc-manager.ts). Some providers ignore the standard and read a hint of
// their own; a deployment names that hint in configuration
// (`NEXT_PUBLIC_OIDC_SIGNUP_PARAMS`, a query-string fragment), so no
// provider is ever named in the console's code.
//
// The fragment is parsed once, here: the runtime-config loader calls it to
// refuse a bad value on the Configuration Error screen, and the auth config
// calls it to hand the redirect a ready map. A fragment that names a
// parameter the sign-in flow sets itself is refused, because oidc-client-ts
// spreads extra parameters after its own and would silently rewrite the
// flow (a different client, redirect, state or PKCE challenge, or the
// audience that makes the API's token a JWT).
// ---------------------------------------------------------------------------

/** The parameters of the authorization request the sign-in flow owns. */
export const RESERVED_SIGNUP_PARAMS: readonly string[] = [
  "client_id",
  "redirect_uri",
  "response_type",
  "response_mode",
  "scope",
  "state",
  "nonce",
  "code_challenge",
  "code_challenge_method",
  "audience",
];

/** A sign-up fragment that names a parameter the sign-in flow owns. */
export class ReservedSignupParamError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`The sign-up parameters name "${key}", which the sign-in flow sets itself.`);
    this.name = "ReservedSignupParamError";
    this.key = key;
  }
}

/**
 * Parse a sign-up fragment (`a=1&b=2`, a leading `?` allowed) into a frozen
 * map. An empty or blank fragment yields an empty map.
 *
 * @throws {ReservedSignupParamError} when a key is one the flow owns.
 */
export function parseSignupParams(raw: string): Readonly<Record<string, string>> {
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(raw.trim())) {
    if (key === "") continue;
    if (RESERVED_SIGNUP_PARAMS.includes(key)) {
      throw new ReservedSignupParamError(key);
    }
    params[key] = value;
  }
  return Object.freeze(params);
}
