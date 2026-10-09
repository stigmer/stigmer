/**
 * The environment the agent host starts with — and so the base environment
 * of every process the agent's turn starts there: the native shell
 * (`shared/shell-env.ts` builds it from the host's `process.env`), the
 * hooks, the MCP servers' base.
 *
 * Today it is the environment the agent's tools have always seen: the
 * runner's own, without the runner's secrets. The boot capture has already
 * moved every one of them out of `process.env`
 * (`shared/runner-credential-store.ts`); the names are dropped here too, as
 * the shell's environment drops them (`SHELL_ENV_DENYLIST`), so a secret
 * planted after the capture still never reaches the host. The operator's
 * settings, the user's own environment on a local runner (their cloud CLI
 * logins among them), and the engines' non-secret settings all pass, as
 * they did when the engines ran in the runner's process.
 *
 * Where the runner starts the host as a separate user, this becomes an
 * allow-list instead, with an operator-named pass-through; that is the
 * change that makes the host hold nothing the agent may not have (#2016).
 */

import { RUNNER_SECRET_ENV_KEYS } from "../shared/runner-credential-keys.js";

const RUNNER_SECRETS: ReadonlySet<string> = new Set(RUNNER_SECRET_ENV_KEYS);

/** The host's environment, from this process's current one. */
export function agentHostEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !RUNNER_SECRETS.has(name)) out[name] = value;
  }
  return out;
}
