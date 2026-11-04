/**
 * What the runtime's own git in the agent's clone never runs: the clone's
 * hooks and its fsmonitor (stigmer#2962). The clone and its configuration
 * are the agent's, so either would run a command the agent wrote, with no
 * approval, the next time review captures a change, write-back adds,
 * commits, checks out or pushes, or the clone fetches from the runner.
 * Every git the runtime runs there carries these two settings: the review
 * substrate's (filereview/git-substrate.ts), as arguments, and the commands
 * write-back and provisioning send through the workspace backend, as git's
 * per-command configuration in the environment ({@link runtimeGitEnv}), so
 * the command text is unchanged. The runner's own git with a token switches
 * off the same two the same way (git-credential.ts).
 */

/** The per-command configuration, as git arguments. */
export const RUNTIME_GIT_CONFIG: readonly string[] = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.hooksPath=/dev/null",
];

/** The same two settings as key and value. */
const RUNTIME_GIT_SETTINGS: ReadonlyArray<readonly [string, string]> = [
  ["core.fsmonitor", "false"],
  ["core.hooksPath", "/dev/null"],
];

/**
 * The environment variables that give every git in a command these
 * settings (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`,
 * git 2.31 and newer), appended after any per-command configuration the
 * inherited environment already carries, never in its place.
 */
export function runtimeGitEnv(inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const parsed = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10);
  const start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const env: Record<string, string> = { GIT_CONFIG_COUNT: String(start + RUNTIME_GIT_SETTINGS.length) };
  RUNTIME_GIT_SETTINGS.forEach(([key, value], i) => {
    env[`GIT_CONFIG_KEY_${start + i}`] = key;
    env[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return env;
}
