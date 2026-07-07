// Strict placeholder resolver for ${VAR_NAME} syntax in MCP server configs.
//
// The MCP server spec (StdioServerConfig.args, HttpServerConfig.headers) allows
// values to reference declared env vars with ${VAR_NAME}. The proto contract is
// explicit that resolution is strict: a missing variable must produce a clear
// error rather than passing a literal "${VAR}" to the subprocess/server.
//
// This mirrors the runner's shared resolver (backend/services/runner/src/shared/
// placeholder-resolver.ts) so `connect --dry-run` (which discovers locally)
// behaves identically to real connect (which resolves on the runner). Kept
// intentionally dependency-free and semantically identical so the two can be
// collapsed into one shared package later without any behavior change.

const PLACEHOLDER_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export class PlaceholderResolutionError extends Error {
  constructor(
    public readonly variableName: string,
    public readonly context?: string,
  ) {
    const where = context ? ` in ${context}` : "";
    super(
      `Unresolved placeholder \${${variableName}}${where}: ` +
        `variable is not present in the execution environment`,
    );
    this.name = "PlaceholderResolutionError";
  }
}

/**
 * Resolve all ${VAR_NAME} placeholders in a template string.
 *
 * @throws PlaceholderResolutionError if any placeholder cannot be resolved.
 */
export function resolvePlaceholders(
  template: string,
  envVars: Record<string, string>,
  context?: string,
): string {
  return template.replace(PLACEHOLDER_RE, (_match, varName: string) => {
    if (varName in envVars) {
      return envVars[varName];
    }
    throw new PlaceholderResolutionError(varName, context);
  });
}

/**
 * Resolve placeholders in every value of a headers map.
 *
 * @throws PlaceholderResolutionError if any header value contains an
 *   unresolvable placeholder.
 */
export function resolveHeaders(
  headers: Record<string, string>,
  envVars: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolved[key] = resolvePlaceholders(value, envVars, `header "${key}"`);
  }
  return resolved;
}
