import type { EnvVarInput, Stigmer } from "@stigmer/sdk";

// ---------------------------------------------------------------------------
// Well-known Stigmer platform environment variable keys
//
// These env vars configure MCP server subprocesses (and agents) to
// communicate back to the Stigmer backend. Because the SDK client
// already knows the server address and auth credential, the setup
// hooks can skip prompting users for these values and inject them
// automatically at session creation time.
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
 * produces a valid gRPC dial target.
 *
 * @example
 * ```ts
 * toGrpcAddress("http://localhost:7234")   // "localhost:7234"
 * toGrpcAddress("https://api.stigmer.ai")  // "api.stigmer.ai:443"
 * toGrpcAddress("https://api.stigmer.ai:8443") // "api.stigmer.ai:8443"
 * ```
 */
export function toGrpcAddress(httpUrl: string): string {
  try {
    const url = new URL(httpUrl);
    const host = url.hostname;
    const port =
      url.port || (url.protocol === "https:" ? "443" : "80");
    return `${host}:${port}`;
  } catch {
    return httpUrl;
  }
}

/**
 * Build system env var entries from raw connection parameters.
 *
 * Pure function — no side effects, no async. Suitable for unit
 * testing without a live Stigmer client.
 *
 * @param baseUrl - The Stigmer client's base URL (HTTP).
 * @param credential - Current auth credential, or `null` for
 *   unauthenticated (OSS) backends. When `null`, a placeholder
 *   value is used so the MCP server env var is always populated.
 */
export function buildSystemEnvVars(
  baseUrl: string,
  credential: string | null,
): Record<string, EnvVarInput> {
  return {
    [STIGMER_SERVER_ADDRESS]: {
      value: toGrpcAddress(baseUrl),
      isSecret: false,
      description:
        "Auto-resolved from the current Stigmer connection.",
    },
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
 * credential, then delegates to {@link buildSystemEnvVars}.
 *
 * Intended for use at session submit time — the returned values
 * are injected into `runtimeEnv` at the **lowest priority** so
 * any user-provided values (personal env, manual secrets) win.
 */
export async function resolveSystemEnvVarValues(
  stigmer: Stigmer,
): Promise<Record<string, EnvVarInput>> {
  const credential = await stigmer.getAuthCredential();
  return buildSystemEnvVars(stigmer.baseUrl, credential);
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
 * @returns Filtered system env vars (may be empty).
 */
export async function resolveDeclaredSystemEnvVars(
  stigmer: Stigmer,
  declaredEnvKeys: ReadonlySet<string> | readonly string[],
): Promise<Record<string, EnvVarInput>> {
  const keys =
    declaredEnvKeys instanceof Set
      ? declaredEnvKeys
      : new Set(declaredEnvKeys);

  const hasDeclared = [...SYSTEM_ENV_VAR_KEYS].some((k) => keys.has(k));
  if (!hasDeclared) {
    return {};
  }

  const all = await resolveSystemEnvVarValues(stigmer);
  const filtered: Record<string, EnvVarInput> = {};
  for (const [key, value] of Object.entries(all)) {
    if (keys.has(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}
