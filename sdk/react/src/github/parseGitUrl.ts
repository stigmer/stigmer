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

const GITHUB_URL_RE = /github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/;

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
  const match = url.match(GITHUB_URL_RE);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}
