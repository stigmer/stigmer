/**
 * Parsed owner and repository name from a GitHub URL.
 *
 * Returned by {@link parseGitUrl} when the URL is a valid GitHub
 * repository reference.
 */
export interface ParsedGitRepo {
  readonly owner: string;
  readonly repo: string;
}

const GITHUB_HOST = "github.com";

/**
 * Extract the owner and repository name from a GitHub URL.
 *
 * Supports both HTTPS and SSH-style URLs:
 * - `https://github.com/acme/api`
 * - `https://github.com/acme/api.git`
 * - `git@github.com:acme/api.git`
 *
 * Returns `null` for non-GitHub or unparseable URLs.
 */
export function parseGitUrl(url: string): ParsedGitRepo | null {
  // Read by position rather than by a pattern: the lazy repository group of
  // `github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$` backtracks on a long input.
  const at = url.indexOf(GITHUB_HOST);
  if (at === -1) return null;
  const separator = url[at + GITHUB_HOST.length];
  if (separator !== "/" && separator !== ":") return null;
  const parts = url.slice(at + GITHUB_HOST.length + 1).split("/");
  if (parts.length !== 2) return null;
  const [owner, name] = parts as [string, string];
  const repo = name.endsWith(".git") ? name.slice(0, -".git".length) : name;
  if (owner === "" || repo === "" || repo.includes(".")) return null;
  return { owner, repo };
}
