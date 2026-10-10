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
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
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
 * The address a tool's login is saved at: the URL of a plugin's HTTP
 * server, and none for a local program, which takes its keys as secrets by
 * name (as it does for a URL holding a placeholder).
 */
export function toolAddressOf(server: McpServerEntry | null | undefined): string | null {
  const transport = server?.transport;
  if (transport?.case !== "http") return null;
  return normalizeAddress(transport.value.url);
}

/**
 * Whether the connections a vault holds fill a tool's login, by the run's
 * rule: the connection saved at the tool's address, a sign-in and a pasted
 * login alike (both fill every HTTP tool at the address, whichever tool or
 * page signed in); and, for an HTTP tool served over HTTPS from GitHub's
 * own API, the github.com login. A local program has no address and takes
 * values only as secrets by name. No read returns a token.
 */
export function vaultLoginServes(
  connections: Readonly<Record<string, VaultConnection>>,
  server: McpServerEntry | null | undefined,
): boolean {
  const address = toolAddressOf(server);
  if (address === null) return false;
  if (Object.hasOwn(connections, address)) return true;
  return onGitHubApi(address) && Object.hasOwn(connections, GITHUB_HOST);
}

/** Whether a connection was saved by a sign-in, which "Sign in again" can renew. */
export function isSignInConnection(connection: VaultConnection): boolean {
  return connection.source === VaultConnectionSource.sign_in;
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
 * The variable a tool's login fills: the one its `Authorization: Bearer
 * ${VAR}` header names (the slot install writes for a server that signs
 * in, and authors write by hand for API-key servers), the server's own
 * rule. A login saved at the tool's address fills it; `null` when the tool
 * has no login slot and takes only secrets by name.
 */
export function toolLoginKeyOf(server: McpServerEntry | null | undefined): string | null {
  const transport = server?.transport;
  if (transport?.case !== "http") return null;
  for (const [name, value] of Object.entries(transport.value.headers)) {
    if (name.toLowerCase() !== "authorization") continue;
    const match = BEARER_PLACEHOLDER.exec(value.trim());
    if (match) return match[1];
  }
  return null;
}
