/**
 * The one way a repository's token reaches git: handed to each git command
 * that talks to the network, for the length of that command, and stored
 * nowhere.
 *
 * The token rides the child process's environment as git's own
 * per-command configuration (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`,
 * `GIT_CONFIG_VALUE_0`), setting an `http.<url>.extraheader` scoped to
 * https://github.com/, the one host a token is for: the header
 * `actions/checkout` sends, never written to `.git/config`. Never in argv
 * (`-c` would put it there, and every user on a host can read a process's
 * arguments), never in a remote URL, never in a credential store. What a
 * shell command of the agent can read afterwards holds no token: the
 * remote URL is clean and `.git` holds nothing. While one git command runs,
 * its environment is readable by processes of the same OS user; that is
 * the residual, and which user that is belongs to the runner's process
 * layout.
 *
 * The network commands are the five the workspace runs: the clone's fetch
 * and `remote set-head --auto` (sources/git.ts), and write-back's
 * `ls-remote`, `fetch` and `push` (writeback-coordinator.ts). Every other
 * git command runs without the token.
 *
 * Per-command configuration needs git 2.31 or newer. The version is read
 * once per process; on an older git a command that needs a token refuses
 * with one sentence naming the floor, instead of an authentication failure
 * from GitHub.
 */

import type { WorkspaceBackend } from "./types.js";

/** The oldest git that reads configuration from the environment. */
export const GIT_CREDENTIAL_FLOOR = { major: 2, minor: 31 } as const;

/** The configuration key the token's header is set under: GitHub only. */
const GITHUB_EXTRAHEADER_KEY = "http.https://github.com/.extraheader";

/** The child-process variables that hand `token` to one git command. */
export function gitTokenEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: GITHUB_EXTRAHEADER_KEY,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
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

let versionOnce: Promise<string> | undefined;

/** The git version this process runs, read once ("2.39.5"; "" when it cannot be read). */
function gitVersion(backend: WorkspaceBackend): Promise<string> {
  versionOnce ??= backend.execute("git --version").then(
    (out) => /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? "",
    () => "",
  );
  return versionOnce;
}

/** Forgets the version read, so a test can present another git. */
export function forgetGitVersion(): void {
  versionOnce = undefined;
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

/**
 * Runs one git command that talks to the network, handing it `token` when
 * there is one. Without a token it is an ordinary command. With one, a git
 * older than the floor refuses before anything runs ({@link GitTooOldError}).
 * Any message the command fails with has the token masked.
 */
export async function runNetworkGit(
  backend: WorkspaceBackend,
  command: string,
  options: { readonly cwd?: string; readonly token?: string },
): Promise<string> {
  const token = options.token ?? "";
  if (token === "") {
    return backend.execute(command, options.cwd === undefined ? undefined : { cwd: options.cwd });
  }
  const version = await gitVersion(backend);
  if (!meetsGitCredentialFloor(version)) {
    throw new GitTooOldError(version === "" ? "unreadable" : version);
  }
  try {
    return await backend.execute(command, { cwd: options.cwd, env: gitTokenEnv(token) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No `cause`: the original error's text is the unmasked one.
    throw new Error(maskToken(message, token));
  }
}

/** `text` with the token, and its basic-auth form, masked. */
export function maskToken(text: string, token: string): string {
  if (token === "") return text;
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  return text.replaceAll(token, "***").replaceAll(basic, "***");
}
