/**
 * Strict placeholder resolver for ${VAR_NAME} syntax in MCP server configs.
 *
 * Port of the Python agent-runner's PlaceholderResolver (strict mode only).
 * Always raises on unresolved placeholders — sending literal ${VAR} as an
 * HTTP header value (e.g. Authorization: Bearer ${API_KEY}) produces
 * cryptic auth failures from the remote server.
 */

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
  return template.replace(PLACEHOLDER_RE, (match, varName: string) => {
    if (varName in envVars) {
      return envVars[varName];
    }
    throw new PlaceholderResolutionError(varName, context);
  });
}

/**
 * Resolve placeholders in all values of a headers map.
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

/**
 * Filter env vars to only keys declared in the MCP server's spec.env.
 *
 * Mirrors the agent-runner's _filter_env_to_declared_keys: prevents
 * secret over-sharing by restricting the subprocess/HTTP environment to
 * explicitly declared variables.
 */
export function filterEnvToDeclaredKeys(
  declaredEnv: Record<string, unknown> | undefined,
  envVars: Record<string, string>,
  serverSlug: string,
): Record<string, string> {
  if (!declaredEnv || Object.keys(declaredEnv).length === 0) {
    if (Object.keys(envVars).length > 0) {
      console.log(
        `MCP server '${serverSlug}' has no env declarations — ` +
          `dropping ${Object.keys(envVars).length} env var(s)`,
      );
    }
    return {};
  }

  const declaredKeys = new Set(Object.keys(declaredEnv));
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    if (declaredKeys.has(key)) {
      filtered[key] = value;
    }
  }

  const dropped = Object.keys(envVars).length - Object.keys(filtered).length;
  if (dropped > 0) {
    console.log(
      `MCP server '${serverSlug}': passing ${Object.keys(filtered).length} ` +
        `declared env var(s), filtered out ${dropped} undeclared key(s)`,
    );
  }

  const missing = [...declaredKeys].filter((k) => !(k in filtered));
  if (missing.length > 0) {
    console.warn(
      `MCP server '${serverSlug}': env declares [${missing.sort().join(", ")}] ` +
        `but they are not present in the resolved environment`,
    );
  }

  return filtered;
}
