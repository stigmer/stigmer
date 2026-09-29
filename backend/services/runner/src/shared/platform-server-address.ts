/**
 * The Stigmer server's address for user-defined MCP servers — the reserved
 * STIGMER_SERVER_ADDRESS key, and the one dial-target rule every writer of
 * that key shares (stigmer/stigmer#1433, #1446).
 *
 * The runner is the one component that supplies it, because the runner is
 * the one that knows where the consumer runs:
 *
 *   - A remote HTTP server receives the key only through a templated header,
 *     so it needs the server's PUBLIC address: STIGMER_MCP_PUBLIC_ENDPOINT,
 *     which the server hands every sandbox it provisions from its own
 *     configuration (stigmer/stigmer#1447), or an operator names to a
 *     runner it starts by hand.
 *   - A stdio server is a child of this runner (only a local runner spawns
 *     one; mcp-transport-guard.ts), so the address the runner itself dials,
 *     STIGMER_BACKEND_ENDPOINT, is right for it by construction.
 *
 * No page supplies it: a value written into a run's runtime_env sits in the
 * top merge layer, above every value the user saved (stigmer/stigmer#1446).
 *
 * The runner FILLS, it never overrides: a non-empty value already in the
 * environment (one the user saved or typed to aim a server elsewhere)
 * stands. A key nobody can supply stays missing, and a
 * header that templates it fails with the resolver's named
 * PlaceholderResolutionError instead of dialing a guess.
 *
 * Injection is opt-in exactly as for the caller-identity keys
 * (caller-identity.ts): only a server whose spec.env declares the key
 * receives it. Applied before filterEnvToDeclaredKeys at execution
 * (mcp-resolver.ts) and before placeholder resolution at discovery
 * (activities/discover-mcp-server.ts), so both phases share one rule.
 */

import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Config } from "../config.js";

/**
 * Reserved env key: the Stigmer server's gRPC dial target, host:port. The
 * name the mcp-server reads its target from (mcp-server/src/config.ts) and
 * `@stigmer/react` keeps out of its setup prompts
 * (sdk/react/src/environment/systemEnvVars.ts); a cross-package string,
 * pinned on every side.
 */
export const SERVER_ADDRESS_ENV_KEY = "STIGMER_SERVER_ADDRESS";

/** The two runner-known endpoints an address can be filled from. */
export type PlatformEndpoints = Pick<Config, "mcpPublicEndpoint" | "stigmerBackendEndpoint">;

/**
 * The gRPC dial target (host:port) for an endpoint, the shape
 * STIGMER_SERVER_ADDRESS wants.
 *
 * An http(s) URL becomes its host with an explicit port: the URL's own, else
 * 80 for http and 443 for https. The port is never left implicit, because
 * the mcp-server derives TLS from it and assumes :443 with TLS for a
 * non-loopback host that has none (mcp-server/src/config.ts). Any other
 * input (a scheme-less host:port, a bare host) is already a dial target and
 * passes through unchanged.
 */
export function grpcTarget(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return endpoint;
  }
  // `new URL("host:7234")` parses with `host:` as its scheme, so only a
  // real http(s) URL is taken apart.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return endpoint;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.hostname}:${port}`;
}

/**
 * The address the platform supplies for a server of this transport, or
 * `null` when the runner knows none: the operator's public endpoint for any
 * transport, else the runner's own backend endpoint for a stdio child.
 */
export function platformServerAddress(
  transport: McpServerTransport | undefined,
  endpoints: PlatformEndpoints,
): string | null {
  if (endpoints.mcpPublicEndpoint) {
    return grpcTarget(endpoints.mcpPublicEndpoint);
  }
  if (transport === "stdio") {
    return grpcTarget(endpoints.stigmerBackendEndpoint);
  }
  return null;
}

/**
 * Return the env map with STIGMER_SERVER_ADDRESS filled for `server` when it
 * declares the key and the map holds no non-empty value for it; otherwise the
 * map itself, unchanged. Never mutates its input.
 */
export function fillPlatformServerAddress(
  server: McpServer,
  envVars: Record<string, string>,
  endpoints: PlatformEndpoints,
): Record<string, string> {
  const declared = server.spec?.env ?? {};
  if (!(SERVER_ADDRESS_ENV_KEY in declared) || envVars[SERVER_ADDRESS_ENV_KEY]) {
    return envVars;
  }
  const value = platformServerAddress(server.spec?.serverType.case, endpoints);
  if (value === null) {
    return envVars;
  }
  const source = endpoints.mcpPublicEndpoint
    ? "STIGMER_MCP_PUBLIC_ENDPOINT"
    : "STIGMER_BACKEND_ENDPOINT";
  console.info(
    `MCP server '${server.metadata?.slug ?? ""}': ${SERVER_ADDRESS_ENV_KEY} ` +
    `filled from ${source} (no value in the execution environment)`,
  );
  return { ...envVars, [SERVER_ADDRESS_ENV_KEY]: value };
}

/** The transports a McpServer spec declares (its `serverType` oneof). */
type McpServerTransport = NonNullable<NonNullable<McpServer["spec"]>["serverType"]["case"]>;
