/**
 * Environment contract for the workflow `run` task (shell and script modes).
 *
 * Declare-to-receive, the same rule the stdio MCP contract adopted after
 * #256 (PR #383): the child process sees ONLY
 *
 *   1. a minimal base copied from the runner process
 *      ({@link RUN_ENV_BASE_KEYS} — the six variables the MCP SDK pins),
 *   2. the task's declared `environment` map, with `${.secrets.KEY}` /
 *      `${.env_vars.KEY}` placeholders resolved just-in-time from the
 *      workflow's runtime env. Resolution happens here in the activity,
 *      never in the deterministic workflow phase, so secret values stay
 *      out of Temporal history.
 *
 * Runner credentials (STIGMER_TOKEN, the HITL secret, provider keys) are
 * structurally absent rather than denylisted — a workflow-authored
 * `printenv` cannot read what was never passed (oss#384). A missing
 * placeholder key fails loudly: running a command with a silently-empty
 * credential produces cryptic downstream failures.
 *
 * Placeholders resolve only in declared environment VALUES, never in
 * `command` / `code` strings — argv is visible to `ps` on the host, so
 * the environment is the sanctioned channel for secrets.
 */

import { resolveRuntimePlaceholdersStrict } from "../workflow-engine/resolve.js";

/**
 * Base variables copied from the runner process when present — the same
 * six the MCP SDK provides to stdio servers, so "undeclared subprocess
 * environment" has one platform-wide answer. `PATH` keeps interpreters
 * and tools findable; the rest keep shells and language runtimes sane.
 */
export const RUN_ENV_BASE_KEYS: readonly string[] = [
  "HOME",
  "LOGNAME",
  "PATH",
  "SHELL",
  "TERM",
  "USER",
];

/**
 * Build the environment for a run task's child process: minimal base +
 * declared overlay with strict placeholder resolution (declared wins on
 * conflict with the base).
 *
 * @throws RuntimePlaceholderResolutionError when a declared value
 *   references a runtime key that does not exist.
 */
export function buildRunEnv(
  declaredEnv: Readonly<Record<string, string>> | undefined,
  runtimeEnv: Readonly<Record<string, unknown>>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of RUN_ENV_BASE_KEYS) {
    const value = baseEnv[key];
    if (value !== undefined) env[key] = value;
  }

  if (!declaredEnv || Object.keys(declaredEnv).length === 0) {
    // The only case whose behavior changed in oss#384 (previously the
    // child inherited the full runner env) — leave a trace for operators.
    console.log("run task declares no environment — child receives the minimal base env only");
    return env;
  }

  for (const [key, value] of Object.entries(declaredEnv)) {
    env[key] = resolveRuntimePlaceholdersStrict(
      value,
      runtimeEnv,
      `environment "${key}"`,
    );
  }

  return env;
}
