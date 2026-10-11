// The address a vault connection is saved at, by the server's one rule, so
// `connect plugin` can tell whether My vault already holds the login a
// server's tools are reached with before it asks for a sign-in.
//
// A tool's address is its full URL: scheme and host lowercased, a default
// port dropped, one trailing slash trimmed, query and fragment dropped. A URL
// holding a `${VAR}` placeholder, with credentials in it, or on another
// scheme names no address. The server normalizes every saved address itself
// and decides at each call; this mirror only spares a sign-in the caller has
// already made. The github.com login also fills a tool served over HTTPS
// from GitHub's own API hosts, as the server's rule says.

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "http:": "80",
  "https:": "443",
};

/** The Git host whose login also fills GitHub's API-hosted tools. */
const GITHUB_HOST = "github.com";

/** GitHub's own API hosts, served by the github.com login. */
const GITHUB_API_HOSTS: ReadonlySet<string> = new Set(["api.github.com", "api.githubcopilot.com"]);

/** A tool URL's address, or undefined when the URL names none. */
export function toolAddress(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === "" || trimmed.includes("${")) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  const port = parsed.port !== "" && parsed.port !== DEFAULT_PORTS[parsed.protocol] ? `:${parsed.port}` : "";
  let path = parsed.pathname;
  if (path.endsWith("/")) path = path.slice(0, -1);
  return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${path}`;
}

/** Whether a vault's connections, by address, hold a login for the tool at `address`. */
export function holdsLoginFor(connections: Readonly<Record<string, unknown>>, address: string): boolean {
  if (Object.hasOwn(connections, address)) return true;
  const url = new URL(address);
  return url.protocol === "https:" && GITHUB_API_HOSTS.has(url.hostname) && Object.hasOwn(connections, GITHUB_HOST);
}
