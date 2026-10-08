/**
 * Addresses: the one rule that says which login a tool or a Git host uses.
 *
 * A connection is saved and found by an address, so the rule must give the
 * same answer to the person saving a login, the sign-in completing, the run
 * resolving it and the console showing it. Two shapes:
 *
 *   - a tool's address is its full URL, because two tools on one host
 *     under different paths need different logins. Normalized: scheme and
 *     host lowercased, a default port dropped, one trailing slash trimmed,
 *     query and fragment dropped. `https://MCP.Linear.app:443/mcp/?x=1`
 *     is `https://mcp.linear.app/mcp`;
 *   - a Git host's address is its bare host name, lowercased
 *     (`github.com`), because every repository on a host shares a login.
 *     Only an HTTPS clone URL has one: the runner sends a token over
 *     nothing else.
 *
 * A tool's address is its `http.url` for an HTTP server, its
 * `auth.discovery_url` for a local program with a login, and none
 * otherwise; a URL holding a `${VAR}` placeholder names no fixed address.
 * A tool with no address takes only secrets, by name.
 *
 * Input that fits neither shape is refused with the rule in the sentence,
 * never repeating the input: a value pasted in the wrong field may be a
 * credential.
 * Tests: __tests__/address.test.ts pins the table (scheme, case, port,
 * slash, query, a bare host, refusals), a two-tools-one-host case, and a
 * clone URL's host for HTTPS only.
 */
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";

/** Why an address was refused, said once for every caller. */
export const ADDRESS_RULE =
  "an address is a tool's URL (https://mcp.example.com/mcp) or a Git host (github.com)";

/**
 * Thrown when input names no address; the message carries the reason and
 * the rule, never the input.
 */
export class InvalidAddressError extends Error {
  constructor(reason: string) {
    super(`the value given is not an address: ${reason}; ${ADDRESS_RULE}`);
    this.name = "InvalidAddressError";
  }
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "http:": "80",
  "https:": "443",
};

/** A bare host: labels of letters, digits and hyphens, optionally with a port. */
const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]{1,5})?$/;

/**
 * Normalizes an address in either shape. A value with a scheme is a tool's
 * URL; a value without one is a Git host.
 */
export function normalizeAddress(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new InvalidAddressError("it is empty");
  }
  if (trimmed.includes("://")) {
    return normalizeToolUrl(trimmed);
  }
  return normalizeHost(trimmed);
}

/** Normalizes a tool's URL; refuses a placeholder, a non-HTTP scheme and credentials in the URL. */
export function normalizeToolUrl(input: string): string {
  if (input.includes("${")) {
    throw new InvalidAddressError("a URL holding a ${VAR} placeholder names no fixed address");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidAddressError("it is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InvalidAddressError("its scheme is not http or https");
  }
  if (url.username !== "" || url.password !== "") {
    throw new InvalidAddressError("a URL carrying credentials is not an address");
  }
  const port = url.port !== "" && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : "";
  let path = url.pathname;
  if (path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}`;
}

/** Normalizes a bare host name. */
export function normalizeHost(input: string): string {
  const host = input.trim().toLowerCase().replace(/\/$/, "");
  if (!BARE_HOST.test(host)) {
    throw new InvalidAddressError("it is neither a URL nor a host name");
  }
  return host.replace(/:443$/, "");
}

/**
 * The Git host a clone URL points at, or undefined when the URL is not a
 * valid HTTPS URL: the runner sends a token only in an HTTPS clone URL, so
 * an http, ssh or git URL has no host a login could serve.
 */
export function gitHostOf(cloneUrl: string): string | undefined {
  try {
    const url = new URL(cloneUrl);
    if (url.protocol !== "https:" || url.hostname === "") {
      return undefined;
    }
    return normalizeHost(url.port !== "" && url.port !== DEFAULT_PORTS[url.protocol] ? `${url.hostname}:${url.port}` : url.hostname);
  } catch {
    return undefined;
  }
}

/**
 * A tool's address: its HTTP URL, else its login's discovery URL, else
 * none. A URL that cannot be normalized (a placeholder in it) is none.
 */
export function toolAddressOf(server: McpServer): string | undefined {
  const serverType = server.spec?.serverType;
  const candidate =
    serverType?.case === "http"
      ? serverType.value.url
      : (server.spec?.auth?.discoveryUrl ?? "");
  if (candidate === "") {
    return undefined;
  }
  try {
    return normalizeToolUrl(candidate);
  } catch {
    return undefined;
  }
}
