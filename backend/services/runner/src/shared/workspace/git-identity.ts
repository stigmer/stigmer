/**
 * The public git identity for commits the agent authors on the user's behalf.
 *
 * Write-back commits (branch/commit/push/PR — see WriteBackCoordinator) land
 * on real branches in the user's repository, so they carry a dedicated,
 * recognizable agent identity in every mode — local and cloud alike. This is
 * deliberate: a commit authored by the agent should never be silently
 * attributed to whatever identity happens to live in the host's `~/.gitconfig`
 * (local), and the cloud sandbox has no identity at all, which makes a bare
 * `git commit` fail with "Author identity unknown".
 *
 * Distinct from the *internal* snapshot identity in
 * `../filereview/git-substrate.ts` (`stigmer-runner <runner@stigmer.local>`):
 * those commit objects are never on a branch and never pushed — they exist
 * only to pin trees against GC. This identity is the public-facing one that
 * appears in `git log`, on GitHub, and in pull requests.
 */
export const AGENT_GIT_AUTHOR_NAME = "Stigmer Agent";
export const AGENT_GIT_AUTHOR_EMAIL = "noreply@stigmer.ai";

/**
 * `git -c` config flags that pin the agent identity for a single command.
 *
 * Per-command `-c` flags (rather than repo-local or global `git config`) keep
 * the identity deterministic in every environment without mutating the user's
 * repository config — the same never-mutate reasoning documented on
 * `SNAPSHOT_IDENTITY_ENV` in `git-substrate.ts`. Env-var injection is not an
 * option here: `WorkspaceBackend.execute()` takes no env parameter, and
 * widening that contract for one caller would be a larger change than the
 * problem deserves.
 */
export const AGENT_GIT_IDENTITY_FLAGS =
  `-c user.name='${AGENT_GIT_AUTHOR_NAME}' -c user.email='${AGENT_GIT_AUTHOR_EMAIL}'`;

/**
 * Build a `git commit` command that is always authored by the agent identity,
 * regardless of what identity (if any) the surrounding environment provides.
 */
export function gitCommitAsAgent(commitMsg: string): string {
  return `git ${AGENT_GIT_IDENTITY_FLAGS} commit -m "${commitMsg}"`;
}
