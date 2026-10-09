/**
 * Stigmer's own login apps: the vendors whose OAuth app the operator
 * registered for the whole deployment, so a sign-in at their address works
 * in every organization without an admin adding one.
 *
 * Each entry is the public facts about a vendor's login (its addresses,
 * endpoints, scopes, how it takes the client secret), kept in code beside
 * the sign-in that uses them, and is switched on by two settings,
 * `STIGMER_<KEY>_CLIENT_ID` and `STIGMER_<KEY>_CLIENT_SECRET`, read as every
 * other setting is (boot/config.ts). An entry whose settings are not both
 * set is off: its addresses fall through to the address's own login server,
 * or to a refusal. Adding a vendor is one entry here and two settings where
 * the deployment is configured.
 *
 * An organization's own login app for an address comes first (login-app.ts);
 * a catalog entry is never read across organizations, because it is no
 * organization's row.
 *
 * Proven by __tests__/login-app.test.ts.
 */
import { normalizeAddress } from "./address.js";
import { GITHUB_HOST } from "./constants.js";
import { TOKEN_AUTH_METHOD_POST } from "./sign-in/token.js";

/** A vendor's login, as Stigmer's built-in app signs in to it. */
export interface LoginProvider {
  /** The catalog key: the settings' infix and the `stigmer:<key>` a sign-in records. */
  readonly key: string;
  /** Who the person signs in with, shown on the sign-in and in the saved login's description. */
  readonly name: string;
  /** The addresses this login serves, normalized. */
  readonly addresses: readonly string[];
  readonly authorizationUrl: string;
  readonly tokenUrl: string;
  /** The endpoint that answers who signed in; "" for none. */
  readonly userinfoUrl: string;
  readonly scopes: readonly string[];
  /** The authorize parameter the scopes ride in; "" for the standard `scope`. */
  readonly scopeParameterName: string;
  /** How the client secret is presented to the token endpoint (RFC 8414 vocabulary). */
  readonly tokenAuthMethod: string;
}

/** The client a deployment registered for a catalog entry. */
export interface LoginProviderCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** The catalog entries switched on, by key. */
export type LoginProviderSettings = ReadonlyMap<string, LoginProviderCredentials>;

/**
 * GitHub: its OAuth App's login. It serves the github.com Git host (clones
 * and the console's repository reads) and GitHub's own MCP server, whose
 * token is the same account's. A classic OAuth App's token does not expire,
 * so there is nothing to renew; GitHub takes PKCE and loopback redirects on
 * any port, so the sign-in needs nothing GitHub-specific.
 */
const GITHUB: LoginProvider = {
  key: "github",
  name: "GitHub",
  addresses: [GITHUB_HOST, normalizeAddress("https://api.githubcopilot.com/mcp")],
  authorizationUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userinfoUrl: "https://api.github.com/user",
  scopes: ["repo", "read:user"],
  scopeParameterName: "",
  tokenAuthMethod: TOKEN_AUTH_METHOD_POST,
};

/** Every vendor Stigmer can carry a built-in login app for. */
export const LOGIN_PROVIDERS: readonly LoginProvider[] = [GITHUB];

/** The two settings that switch an entry on. */
export function loginProviderSettingNames(key: string): { readonly clientId: string; readonly clientSecret: string } {
  const infix = key.toUpperCase();
  return {
    clientId: `STIGMER_${infix}_CLIENT_ID`,
    clientSecret: `STIGMER_${infix}_CLIENT_SECRET`,
  };
}

/**
 * The catalog entries switched on, from each entry's two settings as the
 * configuration read them (`read` answers "" for an unset one). An entry
 * with either setting empty is off.
 */
export function loginProviderSettings(read: (name: string) => string): LoginProviderSettings {
  const settings = new Map<string, LoginProviderCredentials>();
  for (const provider of LOGIN_PROVIDERS) {
    const names = loginProviderSettingNames(provider.key);
    const clientId = read(names.clientId);
    const clientSecret = read(names.clientSecret);
    if (clientId !== "" && clientSecret !== "") {
      settings.set(provider.key, { clientId, clientSecret });
    }
  }
  return settings;
}

/** The catalog entry serving a normalized address, or undefined. */
export function loginProviderFor(address: string): LoginProvider | undefined {
  return LOGIN_PROVIDERS.find((provider) => provider.addresses.includes(address));
}

/** The catalog entry with a key, or undefined. */
export function loginProviderByKey(key: string): LoginProvider | undefined {
  return LOGIN_PROVIDERS.find((provider) => provider.key === key);
}
