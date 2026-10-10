/**
 * The agent shell's environment, and what an agent's hooks run with: the
 * native harness's `execute` tool, and both engines' hooks (`hooks/setup.ts`).
 *
 * Two halves. The base is the runner's own process env minus the runner's
 * credentials: since #508's boot capture, runner secrets never LIVE in
 * `process.env`, so the denylist below is defense-in-depth, keeping this
 * surface safe even if something re-plants a secret after boot (a test, an
 * embedder, a future regression). The overlay is the run's values the
 * shell may hold (`shellRunValues`): the agent's own group of the run's
 * value fetch, as the server delivered it (shared/run-values.ts). The server
 * plans for the agent only the keys the agent declares and no tool of the
 * run declares, and fills them only from secrets by name and plain
 * defaults: a login, a repository's token and a tool's key never reach the
 * shell, whether or not the tool that declares it resolves this turn. An
 * agent that declares nothing gets no run values. An agent whose shell runs
 * `gh` saves a GITHUB_TOKEN secret for it; the clone's token is handed to
 * each network git command alone (workspace/git-credential.ts), whose own
 * environment the agent's processes can read while it runs (#2095).
 *
 * Still built per execution — the snapshot must reflect the env as it is
 * now, not at process start.
 */

import { RUNNER_SECRET_ENV_KEYS } from "./runner-credential-keys.js";
import type { RunValues } from "./run-values.js";

/**
 * Runner-internal keys that must never reach agent shell commands: every
 * credential the runner holds for its own outbound calls (issue #385) plus
 * the runner's encryption keys (issue #508). The names — and the rules for
 * adding one — live in runner-credential-keys.ts.
 */
export const SHELL_ENV_DENYLIST: readonly string[] = RUNNER_SECRET_ENV_KEYS;

/**
 * Settings of the agent host's own process that are no agent's business:
 * `CURSOR_BACKEND_URL` points the host's Cursor SDK at the runner's Cursor
 * lane (`agent-host/entry.ts`), which the SDK reads per call, so it stays in
 * the host's environment. Commands the Cursor SDK starts itself inherit it
 * from there; the shells and hooks the runner's code starts do not.
 */
const HOST_ONLY_ENV_KEYS: readonly string[] = ["CURSOR_BACKEND_URL"];

/** The run values the agent's shell and hooks hold: the agent's own group, as delivered. */
export function shellRunValues(runValues: Pick<RunValues, "agent">): Record<string, string> {
  return { ...runValues.agent };
}

/**
 * Build the environment map passed to deepagents' LocalShellBackend.
 *
 * Base: runner process env minus {@link SHELL_ENV_DENYLIST} and the host's
 * own settings ({@link HOST_ONLY_ENV_KEYS}), then overlay
 * {@link shellValues}, the run values the shell may hold
 * ({@link shellRunValues}); the overlay wins on conflict.
 */
export function buildShellEnv(
  shellValues: Readonly<Record<string, string>>,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const deny = new Set([...SHELL_ENV_DENYLIST, ...HOST_ONLY_ENV_KEYS]);
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
