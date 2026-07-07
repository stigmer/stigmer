import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";

// ---------------------------------------------------------------------------
// diff --stat summary parsing
// ---------------------------------------------------------------------------

/**
 * Aggregate change statistics parsed from a `git diff --stat` summary line.
 *
 * @see parseDiffStatSummary
 */
export interface DiffStatSummary {
  /** Number of files with changes. */
  readonly filesChanged: number;
  /** Total inserted lines across all files. */
  readonly insertions: number;
  /** Total deleted lines across all files. */
  readonly deletions: number;
}

/**
 * The trailing summary line git appends to `--stat` output. All three count
 * segments are optional-but-ordered in git's formatting; an insertions-only
 * diff omits the deletions segment entirely (and vice versa).
 */
const DIFF_STAT_SUMMARY_RE =
  /^(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?$/;

/**
 * Parses the trailing summary line of a `git diff --stat` output into
 * structured counts.
 *
 * `WorkspaceWriteBack.diff_summary` stores the raw `--stat` text (see the
 * runner's `WriteBackCoordinator.updateStatus`). The per-file lines above the
 * summary are NOT parseable honestly — git truncates long paths — but the
 * trailing "N files changed, M insertions(+), K deletions(-)" line is stable
 * and locale-independent, so it is the one part safe to structure.
 *
 * Returns `null` when the text has no recognizable summary line (empty
 * string, or a format drift), letting callers fall back to rendering the raw
 * text rather than showing wrong numbers.
 *
 * @example
 * ```ts
 * parseDiffStatSummary(" notes.md | 55 +++\n 1 file changed, 55 insertions(+)");
 * // { filesChanged: 1, insertions: 55, deletions: 0 }
 * ```
 */
export function parseDiffStatSummary(
  diffSummary: string,
): DiffStatSummary | null {
  const line = trailingDiffStatLine(diffSummary);
  if (line === null) return null;

  const match = DIFF_STAT_SUMMARY_RE.exec(line);
  if (!match) return null;

  return {
    filesChanged: Number(match[1]),
    insertions: Number(match[2] ?? 0),
    deletions: Number(match[3] ?? 0),
  };
}

/**
 * The last non-empty line of a `diff --stat` text — the summary line when the
 * text is well-formed, and the honest single-line fallback to display when
 * {@link parseDiffStatSummary} cannot structure it. `null` for blank input.
 */
export function trailingDiffStatLine(diffSummary: string): string | null {
  const lines = diffSummary.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Display name resolution
// ---------------------------------------------------------------------------

/** Matches `https://github.com/{owner}/{repo}/pull/{n}` (any git host). */
const PULL_REQUEST_URL_RE = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/\d+/;

/**
 * Resolves the human-facing name for a write-back's header.
 *
 * A write-back names its workspace entry, but single-entry sessions can
 * legitimately write back under an EMPTY `workspace_entry_name` — the runner's
 * `WriteBackCoordinator.resolveEntry` convention, mirrored by
 * `useWorkspaceReadRefs`. (The Console derives entry names from the git URL,
 * so this mostly surfaces for CLI/SDK-created sessions.) Rather than render a
 * blank title, fall back through what the record can still prove:
 *
 * 1. `workspace_entry_name` — the configured name, when present.
 * 2. `owner/repo` parsed from `pull_request_url` — the repository identity.
 * 3. `"Workspace"` — the honest generic label when neither exists.
 */
export function writeBackDisplayName(writeBack: WorkspaceWriteBack): string {
  if (writeBack.workspaceEntryName) return writeBack.workspaceEntryName;

  const match = PULL_REQUEST_URL_RE.exec(writeBack.pullRequestUrl);
  if (match) return `${match[1]}/${match[2]}`;

  return "Workspace";
}
