/**
 * Shell environment for the native harness `execute` tool.
 *
 * Two halves. The base is the runner's own process env minus the runner's
 * credentials: since #508's boot capture, runner secrets never LIVE in
 * `process.env`, so the denylist below is defense-in-depth, keeping this
 * surface safe even if something re-plants a secret after boot (a test, an
 * embedder, a future regression). The overlay is the run's values the
 * shell may hold (`shellRunValues`): the keys the agent declares, through
 * the same per-declarer filter every MCP server's environment passes,
 * less every key an MCP server of the run claims (its declared keys and
 * its OAuth token's target), plus the token a git clone of the workspace
 * consumed. Agent save copies its servers' declarations into the agent's
 * own `env` (MergeMcpServerEnvSpecs in the server), so a claimed key is
 * withheld even when the agent's `env` lists it: a value that exists for
 * an MCP server reaches that server and never the shell. An agent that
 * declares nothing gets no run values: declare to receive, the rule MCP
 * servers and workflow `run` tasks already follow.
 *
 * The git token is the one value the shell holds without a declaration,
 * because the clone has already put it in the shell's reach (the remote
 * URL locally, the repository's credential store in cloud); withholding
 * the variable would protect nothing and break `gh`.
 *
 * Still built per execution — the snapshot must reflect the env as it is
 * now, not at process start.
 */

import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { filterEnvToDeclaredKeys } from "../../shared/placeholder-resolver.js";
import { RUNNER_SECRET_ENV_KEYS } from "../../shared/runner-credential-keys.js";
import { GITHUB_TOKEN_KEY } from "../../shared/workspace/sources/git.js";
import type { ProvisionResult } from "../../shared/workspace/types.js";

/**
 * Runner-internal keys that must never reach agent shell commands: every
 * credential the runner holds for its own outbound calls (issue #385) plus
 * the runner's encryption keys (issue #508). The names — and the rules for
 * adding one — live in runner-credential-keys.ts.
 */
export const SHELL_ENV_DENYLIST: readonly string[] = RUNNER_SECRET_ENV_KEYS;

/**
 * The run values the agent's shell may hold: the agent's declared keys
 * (none for the built-in assistant, which has no agent) less every key an
 * MCP server of the run claims, plus the token a git workspace source
 * reports it consumed. Only git sources count, and only that token: a
 * provisioning-only value the provisioner folds into every result is
 * never written where the shell can read it.
 */
export function shellRunValues(
  runValues: Readonly<Record<string, string>>,
  agentEnv: Readonly<Record<string, unknown>> | undefined,
  mcpServers: readonly Pick<ResolvedMcpServer, "declaredEnvKeys">[],
  provisionResults: readonly ProvisionResult[],
): Record<string, string> {
  const values = filterEnvToDeclaredKeys(
    agentEnv,
    { ...runValues },
    "the agent's shell",
  );
  for (const server of mcpServers) {
    for (const key of server.declaredEnvKeys) {
      delete values[key];
    }
  }
  for (const result of provisionResults) {
    if (result.sourceType !== "git_repo") continue;
    for (const key of result.consumedKeys) {
      if (key === GITHUB_TOKEN_KEY && runValues[key] !== undefined) {
        values[key] = runValues[key];
      }
    }
  }
  return values;
}

/**
 * Build the environment map passed to deepagents' LocalShellBackend.
 *
 * Base: runner process env minus {@link SHELL_ENV_DENYLIST}, then overlay
 * {@link shellValues}, the run values the shell may hold
 * ({@link shellRunValues}); the overlay wins on conflict.
 */
export function buildShellEnv(
  shellValues: Readonly<Record<string, string>>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const deny = new Set(SHELL_ENV_DENYLIST);
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (deny.has(key) || value === undefined) continue;
    env[key] = value;
  }

  for (const [key, value] of Object.entries(shellValues)) {
    env[key] = value;
  }

  return env;
}
