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
 * The clone is the agent's to write, so the token's command does not trust
 * it. Hooks and the fsmonitor are switched off at command scope, which no
 * repository setting outranks, so nothing the agent planted in `.git` runs
 * with the token in its environment. A clone whose own configuration could
 * send the request elsewhere or weaken its TLS (`http.*` and `url.*` keys,
 * includes, credential helpers, a proxy or push URL on a remote, an ssh or
 * proxy command) is refused before the command runs: a URL-scoped `http`
 * key outranks any generic one the runner could pin, so the honest answer is
 * to hand the token to none of them. And `origin` must still be the
 * workspace entry's own URL, so the token never pushes or fetches where the
 * agent pointed it.
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

/**
 * The child-process variables that hand `token` to one git command, with
 * hooks and the fsmonitor off. They are appended after any per-command
 * configuration the runner's own environment already carries (`inherited`,
 * the runner's `process.env` by default), never in its place.
 */
export function gitTokenEnv(
  token: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  const entries: ReadonlyArray<readonly [string, string]> = [
    ["core.hooksPath", "/dev/null"],
    ["core.fsmonitor", "false"],
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

/**
 * A repository's own configuration a token is not handed past: anything
 * that could send git's request elsewhere, weaken its TLS, or run a
 * program (lower-cased, as `git config --name-only` prints names).
 */
const UNTRUSTED_LOCAL_KEY =
  /^(?:https?|url|include|includeif|credential)\.|^core\.(?:sshcommand|gitproxy|askpass)$|^remote\.[^.]+\.(?:proxy|pushurl|receivepack|uploadpack|vcs)$/;

/** A clone whose own configuration a token is not handed past, named by its first offending key. */
export class UntrustedGitConfigError extends Error {
  constructor(what: string) {
    super(
      `The repository's own git configuration ${what}, so its token is not handed to git. ` +
        "Remove the setting from the clone, or start a new conversation for a fresh clone.",
    );
    this.name = "UntrustedGitConfigError";
  }
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

let versionRead: string | undefined;

/**
 * The git version this process runs ("2.39.5"; "" when it cannot be read).
 * Only a successful read is kept, so a passing spawn failure is asked again.
 */
async function gitVersion(backend: WorkspaceBackend): Promise<string> {
  if (versionRead !== undefined) return versionRead;
  let out: string;
  try {
    out = await backend.execute("git --version");
  } catch {
    return "";
  }
  const version = /(\d+\.\d+(?:\.\d+)?)/.exec(out)?.[1] ?? "";
  if (version !== "") versionRead = version;
  return version;
}

/** Forgets the version read, so a test can present another git. */
export function forgetGitVersion(): void {
  versionRead = undefined;
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
 * Refuses a clone whose own configuration could carry the token elsewhere,
 * or whose `origin` is no longer `remoteUrl` ({@link UntrustedGitConfigError}).
 */
async function refuseUntrustedClone(
  backend: WorkspaceBackend,
  cwd: string,
  remoteUrl: string,
): Promise<void> {
  const names = (await backend.execute("git config --local --name-only --list", { cwd }))
    .split("\n")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  const offending = names.find((name) => UNTRUSTED_LOCAL_KEY.test(name));
  if (offending !== undefined) {
    throw new UntrustedGitConfigError(`sets ${offending}`);
  }
  // The stored URL, not `remote get-url`: that applies the operator's own
  // global `insteadOf` rewrites, and the clone's own are refused above.
  const origin = (await backend.execute("git config --local --get remote.origin.url", { cwd })).trim();
  if (origin !== remoteUrl) {
    throw new UntrustedGitConfigError("points origin somewhere other than the conversation's repository");
  }
}

/**
 * Runs one git command that talks to the network in the repository at
 * `cwd`, handing it `token` when there is one. Without a token it is an
 * ordinary command. With one, a git older than the floor refuses before
 * anything runs ({@link GitTooOldError}), and so does a clone that does not
 * deserve the token ({@link UntrustedGitConfigError}): its `origin` must be
 * `remoteUrl`. Any message the command fails with has the token masked.
 */
export async function runNetworkGit(
  backend: WorkspaceBackend,
  command: string,
  options: { readonly cwd: string; readonly remoteUrl: string; readonly token?: string },
): Promise<string> {
  const token = options.token ?? "";
  if (token === "") {
    return backend.execute(command, { cwd: options.cwd });
  }
  const version = await gitVersion(backend);
  if (!meetsGitCredentialFloor(version)) {
    throw new GitTooOldError(version === "" ? "unreadable" : version);
  }
  await refuseUntrustedClone(backend, options.cwd, options.remoteUrl);
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
