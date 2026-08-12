/**
 * Shell environment for the native harness `execute` tool.
 *
 * Per-execution snapshot: runner-manager rotates `STIGMER_TOKEN` in
 * `process.env` at runtime, so this must run inside setup for each execution,
 * never once at process start.
 */

import { RUNNER_CREDENTIAL_ENV_KEYS } from "../../shared/runner-credential-keys.js";

/**
 * Runner-internal keys that must never reach agent shell commands: every
 * credential the runner holds for its own outbound calls (issue #385). The
 * names — and the rule for adding one — live in runner-credential-keys.ts.
 */
export const SHELL_ENV_DENYLIST: readonly string[] = RUNNER_CREDENTIAL_ENV_KEYS;

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
