import type { EnvVarInput, Stigmer } from "@stigmer/sdk";
import { resolvePublicBaseUrl } from "../public-base-url-context.js";

// ---------------------------------------------------------------------------
// Well-known Stigmer platform environment variable keys
//
// These env vars let MCP servers (and agents) talk back to the Stigmer
// server. The platform supplies both, so the setup hooks never prompt a
// user for them.
//
// STIGMER_SERVER_ADDRESS has two sources, each for the consumers only it
// can answer for (stigmer/stigmer#1433):
//
// - This SDK supplies the server's PUBLIC address: the host's
//   `publicBaseUrl`, else the client's `baseUrl` when it is absolute. A
//   remote HTTP MCP server receives the key only through a templated
//   header, so the public address is the one it needs, and only the host
//   knows it. With neither, the key is left out instead of guessed.
// - The runner fills a missing address for a stdio server it spawns, from
//   the endpoint it dials itself (backend/services/runner, the
//   platform-server-address module). A value present is never overridden.
// ---------------------------------------------------------------------------

const STIGMER_SERVER_ADDRESS = "STIGMER_SERVER_ADDRESS";
const STIGMER_API_KEY = "STIGMER_API_KEY";

/**
 * Environment variable keys that the SDK can resolve automatically
 * from the current {@link Stigmer} client context.
 *
 * Used by setup hooks to exclude these keys from the "missing
 * variables" prompt and by the session composer to inject their
 * values into runtime env at submit time.
 *
 * Platform builders who manage setup hooks directly can use this
 * set to extend their own `poolKeys`.
 */
export const SYSTEM_ENV_VAR_KEYS: ReadonlySet<string> = new Set([
  STIGMER_SERVER_ADDRESS,
  STIGMER_API_KEY,
]);

/**
 * Convert an HTTP(S) base URL to a gRPC host:port address.
 *
 * The Stigmer server serves both gRPC and gRPC-Web on the same
 * endpoint, so stripping the protocol and extracting host:port
 * produces a valid gRPC dial target. The port is always explicit
 * (80 for http, 443 for https, when the URL names none), because the
 * mcp-server derives TLS from it. Any input that is not an http(s) URL
 * (a scheme-less `host:port`, a relative path) is returned unchanged;
 * {@link buildSystemEnvVars} injects only an address built from an
 * absolute URL. The runner's `grpcTarget` applies the same rule.
 *
 * @example
 * ```ts
 * toGrpcAddress("http://localhost:7234")   // "localhost:7234"
 * toGrpcAddress("https://api.stigmer.ai")  // "api.stigmer.ai:443"
 * toGrpcAddress("https://api.stigmer.ai:8443") // "api.stigmer.ai:8443"
 * toGrpcAddress("localhost:7234")          // "localhost:7234"
 * ```
 */
export function toGrpcAddress(httpUrl: string): string {
  let url: URL;
  try {
    url = new URL(httpUrl);
  } catch {
    return httpUrl;
  }
  // `new URL("localhost:7234")` parses with `localhost:` as its scheme,
  // so only a real http(s) URL is taken apart.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return httpUrl;
  }
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return `${url.hostname}:${port}`;
}

/** Options for {@link resolveSystemEnvVarValues} and {@link resolveDeclaredSystemEnvVars}. */
export interface SystemEnvVarOptions {
  /**
   * The server's public base URL, the value `StigmerProvider`'s
   * `publicBaseUrl` carries. Takes precedence over the client's
   * `baseUrl`; only an absolute `http(s)` URL counts.
   */
  readonly publicBaseUrl?: string;
}

/**
 * Build system env var entries from raw connection parameters.
 *
 * Pure function — no side effects, no async. Suitable for unit
 * testing without a live Stigmer client.
 *
 * @param baseUrl - The server's base URL (HTTP), or `null` when it is
 *   unknown. `STIGMER_SERVER_ADDRESS` is included only when this is an
 *   absolute `http(s)` URL: a relative one (a same-origin proxy) or
 *   `null` names no address anything outside the page can dial, so the
 *   key is left out and the runner or the user supplies it.
 * @param credential - Current auth credential, or `null` for
 *   unauthenticated (OSS) backends. When `null`, a placeholder
 *   value is used so the MCP server env var is always populated.
 */
export function buildSystemEnvVars(
  baseUrl: string | null,
  credential: string | null,
): Record<string, EnvVarInput> {
  const absoluteBaseUrl =
    baseUrl === null ? null : resolvePublicBaseUrl(undefined, baseUrl);
  return {
    ...(absoluteBaseUrl !== null && {
      [STIGMER_SERVER_ADDRESS]: {
        value: toGrpcAddress(absoluteBaseUrl),
        isSecret: false,
        description:
          "Auto-resolved from the current Stigmer connection.",
      },
    }),
    [STIGMER_API_KEY]: {
      value: credential || "unused",
      isSecret: true,
      description:
        "Auto-resolved from the current Stigmer auth context.",
    },
  };
}

/**
 * Resolve system env var values from a live {@link Stigmer} client.
 *
 * Calls {@link Stigmer.getAuthCredential} to obtain the current
 * credential, then delegates to {@link buildSystemEnvVars} with the
 * server's public address: `options.publicBaseUrl`, else the client's
 * `baseUrl`, the order `usePublicBaseUrl` applies.
 *
 * Intended for use at session submit time. The composer merges the
 * returned values first, so values it collects in the page (setup
 * answers, session variables) win over them. On the server they ride
 * `runtime_env`, which is the top merge layer: a value saved in an
 * environment does not override them (stigmer/stigmer#1446).
 */
export async function resolveSystemEnvVarValues(
  stigmer: Stigmer,
  options?: SystemEnvVarOptions,
): Promise<Record<string, EnvVarInput>> {
  const credential = await stigmer.getAuthCredential();
  return buildSystemEnvVars(
    resolvePublicBaseUrl(options?.publicBaseUrl, stigmer.baseUrl),
    credential,
  );
}

/**
 * Resolve only the system env vars that the target resource actually
 * declares in its environment specification.
 *
 * System vars (`STIGMER_SERVER_ADDRESS`, `STIGMER_API_KEY`) should
 * only be injected when the resource needs them — blindly injecting
 * them causes `runtime_env` to be non-empty on the wire, which
 * changes the backend's missing-credential tolerance semantics.
 *
 * @param stigmer - Live Stigmer client for credential resolution.
 * @param declaredEnvKeys - The set of env var keys the target
 *   resource declares (e.g., `Object.keys(mcpServer.spec.env)`).
 *   Only system vars whose keys appear here are included.
 * @param options - The server's public base URL, as for
 *   {@link resolveSystemEnvVarValues}.
 * @returns Filtered system env vars (may be empty).
 */
export async function resolveDeclaredSystemEnvVars(
  stigmer: Stigmer,
  declaredEnvKeys: ReadonlySet<string> | readonly string[],
  options?: SystemEnvVarOptions,
): Promise<Record<string, EnvVarInput>> {
  const keys =
    declaredEnvKeys instanceof Set
      ? declaredEnvKeys
      : new Set(declaredEnvKeys);

  const hasDeclared = [...SYSTEM_ENV_VAR_KEYS].some((k) => keys.has(k));
  if (!hasDeclared) {
    return {};
  }

  const all = await resolveSystemEnvVarValues(stigmer, options);
  const filtered: Record<string, EnvVarInput> = {};
  for (const [key, value] of Object.entries(all)) {
    if (keys.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}
