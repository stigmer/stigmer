/**
 * The `${VAR}` vocabulary: what counts as a variable reference, what counts
 * as a reference to the plugin's own files, and the Claude rewrite.
 *
 * `PLACEHOLDER_PATTERN` is the runner's own scanner, verbatim: the runner
 * resolves `${VAR}` strictly in a server's headers and arguments and refuses
 * to start a server with an unresolved one, so this is the definition of "a
 * reference" in every dialect, including the open format whose text forbids
 * expansion in headers. A plugin's `${API_KEY}` in a header means "the
 * caller's API_KEY" on Stigmer whichever tool wrote it.
 *
 * Claude's `${user_config.KEY}` carries a dot the runner's scanner would
 * never match, so it is rewritten to `${KEY}` before anything reads it; the
 * rewrite is what makes a Claude plugin's server start, not a courtesy.
 *
 * The plugin-root placeholders are the one class the library refuses: the
 * runner mounts nothing from a plugin, so a server that reaches for
 * `${PLUGIN_ROOT}` (any dialect's spelling) can never find what it points
 * at. The set is checked before the generic scan because `${PLUGIN_ROOT}`
 * also matches the generic pattern.
 */

/** The runner's `${VAR_NAME}` scanner (`shared/placeholder-resolver.ts`). */
export const PLACEHOLDER_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** A variable name the runner's scanner can reference. */
export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const USER_CONFIG_PATTERN = /\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Every spelling of "the plugin's own directory" across the dialects:
 * the open format's, Claude Code's (plus its project directory), Cursor's.
 */
export const PLUGIN_ROOT_PLACEHOLDERS: ReadonlySet<string> = new Set([
  "${PLUGIN_ROOT}",
  "${PLUGIN_DATA}",
  "${CLAUDE_PLUGIN_ROOT}",
  "${CLAUDE_PLUGIN_DATA}",
  "${CLAUDE_PROJECT_DIR}",
  "${CURSOR_PLUGIN_ROOT}",
]);

/** The reserved environment names the open format forbids a server's `env` to set. */
export const PLUGIN_ROOT_ENV_NAMES: ReadonlySet<string> = new Set(["PLUGIN_ROOT", "PLUGIN_DATA"]);

/** `${user_config.KEY}` -> `${KEY}`. */
export function rewriteUserConfig(value: string): string {
  return value.replace(USER_CONFIG_PATTERN, (_match, key: string) => `\${${key}}`);
}

/** The first plugin-root placeholder in `value`, or `undefined`. */
export function findPluginRootPlaceholder(value: string): string | undefined {
  for (const placeholder of PLUGIN_ROOT_PLACEHOLDERS) {
    if (value.includes(placeholder)) return placeholder;
  }
  return undefined;
}

/** The variable names referenced in `value`, in order of appearance, deduplicated. */
export function referencedVariables(value: string): readonly string[] {
  const names: string[] = [];
  for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The variable name when `value` is exactly one placeholder and nothing else; otherwise `undefined`. */
export function singlePlaceholderName(value: string): string | undefined {
  const match = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
  return match?.[1];
}
