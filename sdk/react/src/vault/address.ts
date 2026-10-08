/**
 * The address a vault connection is saved at, by the server's one rule, so
 * the console matches a tool to its saved login exactly as a run does.
 *
 * A tool's address is its full URL: scheme and host lowercased, a default
 * port dropped, one trailing slash trimmed, query and fragment dropped; only
 * an http or https URL without credentials in it is one. Two tools on one
 * host under different paths need different logins, so the host alone is
 * never a tool's address. A Git host's address is its bare host name,
 * lowercased, its default port dropped (`github.com`); only an HTTPS clone
 * URL has one, because the runner sends a token over nothing else. The
 * server normalizes every saved address itself; this mirror exists for
 * display and for readiness checks that compare a tool against the
 * connections a vault already holds.
 *
 * Pinned by __tests__/address.test.ts.
 */
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { VaultConnection } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

/** The Git host every GitHub repository clones from. */
export const GITHUB_HOST = "github.com";

/**
 * GitHub's own API hosts: the github.com login also fills the login of an
 * HTTP tool served over HTTPS from one of these (the GitHub MCP server),
 * the server's GITHUB_API_HOSTS.
 */
const GITHUB_API_HOSTS: ReadonlySet<string> = new Set(["api.github.com", "api.githubcopilot.com"]);

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "http:": "80",
  "https:": "443",
};

/** A bare host: labels of letters, digits and hyphens, optionally with a port. */
const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;

/**
 * Normalizes an address in either shape: a URL (`https://mcp.linear.app/mcp/`)
 * becomes a tool address, anything else a bare host. Returns `null` for input
 * the server would refuse (an unparseable URL, a scheme other than http or
 * https, credentials in the URL, a placeholder, a blank).
 */
export function normalizeAddress(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.includes("${")) return null;
  if (!trimmed.includes("://")) return normalizeHost(trimmed);
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  const port = url.port !== "" && DEFAULT_PORTS[url.protocol] !== url.port ? `:${url.port}` : "";
  let path = url.pathname;
  if (path.endsWith("/")) path = path.slice(0, -1);
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`;
}

/** A bare host name, lowercased, one trailing slash and the HTTPS port dropped; `null` when it is not one. */
function normalizeHost(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/\/$/, "");
  return BARE_HOST.test(host) ? host.replace(/:443$/, "") : null;
}

/**
 * The address a tool's login is saved at: its URL for an HTTP server, its
 * discovery URL for a local program with a login, and none otherwise (a
 * tool with no address takes only secrets).
 */
export function toolAddressOf(server: McpServer | null | undefined): string | null {
  const spec = server?.spec;
  if (!spec) return null;
  if (spec.serverType.case === "http") {
    return normalizeAddress(spec.serverType.value.url);
  }
  const discovery = spec.auth?.discoveryUrl ?? "";
  return discovery === "" ? null : normalizeAddress(discovery);
}

/**
 * Whether the connections a vault holds fill a tool's login, by the run's
 * rule: the connection saved at the tool's address, when it is a sign-in
 * started from this very server (by id) while the server is still the kind
 * it was at sign-in (an HTTP server or a local program), or a pasted login
 * for an HTTP tool, whose requests carry the token to that address; and,
 * for an HTTP tool served over HTTPS from GitHub's own API, the github.com
 * login. A sign-in made for another server, or a pasted login at a local
 * program's discovery URL, fills nothing: a local program takes values only
 * as secrets by name. Reads only the connection's kind and minter; no read
 * returns a token.
 */
export function vaultLoginServes(
  connections: Readonly<Record<string, VaultConnection>>,
  server: McpServer | null | undefined,
): boolean {
  const address = toolAddressOf(server);
  if (!server || address === null) return false;
  const sendsToAddress = server.spec?.serverType.case === "http";
  const connection = connections[address];
  if (connection) {
    if (connection.source === VaultConnectionSource.sign_in) {
      const minter = connection.signIn?.mcpServerId ?? "";
      const signedInAsLocalProgram = connection.signIn?.localProgram === true;
      if (minter !== "" && minter === (server.metadata?.id ?? "") && signedInAsLocalProgram === !sendsToAddress) {
        return true;
      }
    } else if (sendsToAddress) {
      return true;
    }
  }
  return sendsToAddress && onGitHubApi(address) && connections[GITHUB_HOST] !== undefined;
}

/** Whether a tool's address is an HTTPS URL on one of GitHub's own API hosts, at its default port. */
function onGitHubApi(address: string): boolean {
  const url = URL.canParse(address) ? new URL(address) : undefined;
  return url?.protocol === "https:" && url.port === "" && GITHUB_API_HOSTS.has(url.hostname);
}

/**
 * The Git host of a clone URL (`https://github.com/acme/app.git` →
 * `github.com`), or `null` when it is not a valid HTTPS URL: the runner
 * sends a token only in an HTTPS clone URL, so an http, ssh or git URL has
 * no host a login could serve.
 */
export function gitHostOf(cloneUrl: string): string | null {
  try {
    const url = new URL(cloneUrl);
    if (url.protocol !== "https:" || url.hostname === "") return null;
    return normalizeHost(url.port !== "" ? `${url.hostname}:${url.port}` : url.hostname);
  } catch {
    return null;
  }
}

const BEARER_PLACEHOLDER = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i;

/**
 * The variable a tool's login fills: its sign-in's `auth.target_env_var`,
 * else the variable its `Authorization: Bearer ${VAR}` header names (the
 * slot the platform writes for a URL-only tool, and authors write by hand
 * for API-key tools). A login saved at the tool's address fills it; `null`
 * when the tool has no login slot and takes only secrets by name.
 */
export function toolLoginKeyOf(server: McpServer | null | undefined): string | null {
  const spec = server?.spec;
  if (!spec) return null;
  const target = spec.auth?.targetEnvVar ?? "";
  if (target !== "") return target;
  if (spec.serverType.case !== "http") return null;
  for (const [name, value] of Object.entries(spec.serverType.value.headers)) {
    if (name.toLowerCase() !== "authorization") continue;
    const match = BEARER_PLACEHOLDER.exec(value.trim());
    if (match) return match[1];
  }
  return null;
}
