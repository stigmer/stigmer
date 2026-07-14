/**
 * Shell environment for the native harness `execute` tool.
 *
 * Per-execution snapshot: runner-manager rotates `STIGMER_TOKEN` in
 * `process.env` at runtime, so this must run inside setup for each execution,
 * never once at process start.
 */

/** Runner-internal keys that must never reach agent shell commands. */
export const SHELL_ENV_DENYLIST: readonly string[] = [
  // Derives HITL approval fingerprints — an agent that reads this could forge receipts.
  "STIGMER_RUNNER_HITL_SECRET",
  // Cursor harness credential; shell commands do not need direct Cursor API access.
  "CURSOR_API_KEY",
  // Stigmer control-plane auth; shell commands use ExecutionContext overlay instead.
  "STIGMER_TOKEN",
];

/**
 * Build the environment map passed to deepagents' LocalShellBackend.
 *
 * Base: runner process env minus {@link SHELL_ENV_DENYLIST}, then overlay
 * {@link mergedEnvVars} (ExecutionContext wins on conflict).
 */
export function buildShellEnv(
  mergedEnvVars: Readonly<Record<string, string>>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const deny = new Set(SHELL_ENV_DENYLIST);
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (deny.has(key) || value === undefined) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(mergedEnvVars)) {
    env[key] = value;
  }

  return env;
}
