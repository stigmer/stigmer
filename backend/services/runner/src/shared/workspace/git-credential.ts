/**
 * How a repository's token reaches git: handed to one git command that
 * talks to GitHub, for the length of that command, and stored nowhere.
 *
 * The token rides the child process's environment as git's own
 * per-command configuration (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`,
 * `GIT_CONFIG_VALUE_0`), setting an `http.<url>.extraheader` scoped to
 * https://github.com/, the one host a token is for: the header
 * `actions/checkout` sends, never written to a configuration file. Never in
 * argv (`-c` would put it there, and every user on a host can read a
 * process's arguments), never in a remote URL, never in a credential store.
 * Hooks, the fsmonitor and submodule recursion are switched off beside it.
 *
 * The only git that receives it is the runner's own, in the runner's own
 * repository (`runner-git.ts`): never a command in the agent's clone, which
 * on a separating runner runs as the agent user, whose other processes
 * could read the command's environment while it runs (#2095). The agent's
 * clone receives git data from the runner, never the token.
 *
 * Per-command configuration needs git 2.31 or newer. On an older git a
 * command that needs a token refuses with one sentence naming the floor
 * ({@link GitTooOldError}), instead of an authentication failure from
 * GitHub.
 */

/** The oldest git that reads configuration from the environment. */
export const GIT_CREDENTIAL_FLOOR = { major: 2, minor: 31 } as const;

/** The configuration key the token's header is set under: GitHub only. */
const GITHUB_EXTRAHEADER_KEY = "http.https://github.com/.extraheader";

/**
 * The child-process variables that hand `token` to one git command, with
 * hooks and the fsmonitor off. They are appended after any per-command
 * configuration the command's environment already carries (`inherited`:
 * by default this process's, which the runner's own git runs with), never
 * in its place: a container's `safe.directory`, for one, is kept.
 */
export function gitTokenEnv(
  token: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  const entries: ReadonlyArray<readonly [string, string]> = [
    ["core.hooksPath", "/dev/null"],
    ["core.fsmonitor", "false"],
    ["fetch.recurseSubmodules", "false"],
    ["push.recurseSubmodules", "no"],
    [GITHUB_EXTRAHEADER_KEY, `AUTHORIZATION: basic ${basic}`],
  ];
  const parsed = Number.parseInt(inherited.GIT_CONFIG_COUNT ?? "0", 10);
  const start = Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  const env: Record<string, string> = {
    GIT_CONFIG_COUNT: String(start + entries.length),
  };
  entries.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${start + index}`] = key;
    env[`GIT_CONFIG_VALUE_${start + index}`] = value;
  });
  return env;
}

/** A git older than {@link GIT_CREDENTIAL_FLOOR}: a token cannot be handed to it without storing it. */
export class GitTooOldError extends Error {
  constructor(found: string) {
    super(
      `This runner's git is ${found}; handing a repository's token to git without storing it needs ` +
        `git ${GIT_CREDENTIAL_FLOOR.major}.${GIT_CREDENTIAL_FLOOR.minor} or newer. Install a newer git on the runner.`,
    );
    this.name = "GitTooOldError";
  }
}

/** Whether `version` ("2.39.5") is at least the floor; an unreadable version is not. */
export function meetsGitCredentialFloor(version: string): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > GIT_CREDENTIAL_FLOOR.major ||
    (major === GIT_CREDENTIAL_FLOOR.major && minor >= GIT_CREDENTIAL_FLOOR.minor);
}

/** `text` with the token, and its basic-auth form, masked. */
export function maskToken(text: string, token: string): string {
  if (token === "") return text;
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  return text.replaceAll(token, "***").replaceAll(basic, "***");
}
