"use client";

// One git write-back as a card in the session panel's Pull requests view:
// the repository and a status pill for its phase, the branch as a tag with
// its copy control and its base, then the pull request link and the change
// counts. The suite in `__tests__/WriteBackCard.test.tsx` pins each phase's
// word, the branch tag and copy, the link, and the error rules.

import { useCallback, type ReactNode } from "react";
import type { WorkspaceWriteBack } from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";
import { cn } from "@stigmer/design-tokens";
import { DiffSummary } from "../version-history/DiffSummary.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";
import { Card } from "../internal/surface/Card.js";
import { Tag } from "../internal/surface/Tag.js";
import { StatusBadge } from "../status/StatusBadge.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import {
  parseDiffStatSummary,
  pullRequestHostName,
  trailingDiffStatLine,
  writeBackDisplayName,
} from "./write-back-utils.js";
import { IconButton } from "../button/IconButton.js";

/** Props for {@link WriteBackCard}. */
export interface WriteBackCardProps {
  /** The workspace write-back outcome to render. */
  readonly writeBack: WorkspaceWriteBack;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Renders a single workspace write-back outcome as a card, rows 8px apart:
 *
 * 1. The repository (or entry) name and, at the right, a status pill for
 *    its phase: "Committed" (not yet pushed), "Pushed", "Pull request
 *    open" when it has a pull request, or "Failed".
 * 2. The branch as a mono tag, a "Copy branch name" control, and "into
 *    {base}".
 * 3. The pull request as a link ("#482 on GitHub") that opens it on the
 *    remote in a new tab, then the change and line counts.
 *
 * The PR link and the copy control are SIBLING interactive elements, never
 * nested (axe `nested-interactive`, WCAG 4.1.2).
 *
 * Error rendering follows the record's phase honestly:
 * a FAILED record's error is destructive (the work did not reach the
 * remote), while a PUSHED record carrying an error renders it as a
 * degraded notice — the branch is live and its info stays usable; only
 * the PR step failed.
 *
 * The change counts are parsed from the record's `git diff --stat` summary
 * and rendered through the shared {@link DiffSummary} component; unparseable
 * text degrades to the raw trailing line rather than showing wrong numbers.
 *
 * Themed via standard semantic tokens — no hardcoded colors, no
 * Console dependencies. Embedders can theme this component through
 * their Tailwind/CSS configuration.
 *
 * @example
 * ```tsx
 * import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
 *
 * function RunWriteBacks({ run }: { run: Run }) {
 *   const { writeBacks } = useWorkspaceWriteBacks(run);
 *   return <>{writeBacks.map((wb) => <WriteBackCard key={wb.workspaceEntryName} writeBack={wb} />)}</>;
 * }
 * ```
 *
 * @see useWorkspaceWriteBacks — extracts write-back data from a run
 * @see writeBackDisplayName — the header's entry-name fallback chain
 */
export function WriteBackCard({ writeBack, className }: WriteBackCardProps) {
  const isFailed =
    writeBack.phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED;
  const hasPR = !!writeBack.pullRequestUrl;
  const displayName = writeBackDisplayName(writeBack);
  const pill = phasePill(writeBack.phase, hasPR);
  const stats = statLine(writeBack.diffSummary);

  return (
    <Card
      role="article"
      aria-label={`Write-back: ${displayName}`}
      className={cn("stg:flex stg:flex-col stg:gap-2 stg:p-3", className)}
    >
      {/* Row 1: the repository and its phase */}
      <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
        <TruncatedText
          text={displayName}
          className="stg:min-w-0 stg:flex-1 stg:text-sm stg:font-semibold stg:text-foreground"
        />
        {pill && <StatusBadge phase={pill.phase} label={pill.label} />}
      </div>

      {/* Row 2: the branch, the user's handle on the pushed work */}
      {writeBack.branchName && (
        <BranchRow
          branchName={writeBack.branchName}
          baseBranch={writeBack.baseBranch}
        />
      )}

      {/* Row 3: the pull request and the change counts */}
      {(hasPR || stats) && (
        <div className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1 stg:text-xs stg:text-muted-foreground">
          {hasPR && (
            <PullRequestLink
              url={writeBack.pullRequestUrl}
              number={writeBack.pullRequestNumber}
            />
          )}
          {hasPR && stats && <span aria-hidden="true">&middot;</span>}
          {stats}
        </div>
      )}

      {/* Error message: destructive when the write-back itself failed,
          degraded when the branch pushed but a later step (the PR) did not. */}
      {writeBack.error && (
        <div
          className={cn(
            "stg:rounded-md stg:px-2 stg:py-1 stg:text-xs",
            isFailed
              ? "stg:bg-destructive-subtle stg:text-destructive"
              : "stg:bg-status-degraded-subtle stg:text-status-degraded",
          )}
        >
          {writeBack.error}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Phase pill
// ---------------------------------------------------------------------------

/**
 * The status pill for a phase, in a word that is true of it: a commit not
 * yet pushed is pending, a pushed branch or an open pull request is ready,
 * a failure is failed. A record with a pull request reads "Pull request
 * open" unless it failed. `null` for a phase the record does not name.
 */
function phasePill(
  phase: WorkspaceWriteBackPhase,
  hasPR: boolean,
): { readonly phase: StatusPhase; readonly label: string } | null {
  if (phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED) {
    return { phase: "failed", label: "Failed" };
  }
  if (hasPR || phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED) {
    return { phase: "ready", label: "Pull request open" };
  }
  switch (phase) {
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED:
      return { phase: "ready", label: "Pushed" };
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_COMMITTED:
      return { phase: "pending", label: "Committed" };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pull-request link
// ---------------------------------------------------------------------------

function PullRequestLink({ url, number }: { url: string; number: number }) {
  const host = pullRequestHostName(url);
  const text =
    number > 0
      ? host ? `#${number} on ${host}` : `#${number}`
      : host ? `Pull request on ${host}` : "Pull request";
  // The name carries "Pull request" for a screen reader, and keeps the
  // visible words inside it (WCAG 2.5.3, label in name).
  const name = number > 0 ? `Pull request ${text}` : text;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={name}
      className={cn(
        "stg:inline-flex stg:min-w-0 stg:items-center stg:gap-1 stg:rounded-sm stg:text-foreground stg:underline-offset-2 stg:hover:underline",
        FOCUS_RING_CLASSES,
      )}
    >
      <span className="stg:truncate">{text}</span>
      <ExternalLinkIcon />
    </a>
  );
}

// ---------------------------------------------------------------------------
// Branch row — the branch tag, its sibling copy control, and its base
// ---------------------------------------------------------------------------

function BranchRow({
  branchName,
  baseBranch,
}: {
  branchName: string;
  baseBranch: string;
}) {
  const { copy, copied } = useCopyFeedback();
  const handleCopy = useCallback(() => {
    void copy(branchName);
  }, [copy, branchName]);

  return (
    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-1">
      {/* Only the branch name can clip, so it alone carries the
          overflow-gated tooltip. */}
      <Tag mono className="stg:min-w-0 stg:shrink">
        <span className="stg:shrink-0 stg:text-muted-foreground">
          <GitBranchIcon />
        </span>
        <TruncatedText text={branchName} className="stg:min-w-0" />
      </Tag>
      <IconButton
        size="xs"
        label={copied ? "Branch name copied" : "Copy branch name"}
        icon={copied ? <CheckIcon /> : <CopyIcon />}
        onClick={handleCopy}
        className="stg:shrink-0"
      />
      {baseBranch && (
        <span className="stg:min-w-0 stg:truncate stg:text-xs stg:text-muted-foreground">
          into {baseBranch}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat line — parsed --stat summary through the shared DiffSummary
// ---------------------------------------------------------------------------

/** The change counts for row 3, or `null` when the record has none to show. */
function statLine(diffSummary: string): ReactNode {
  if (!diffSummary) return null;
  const stats = parseDiffStatSummary(diffSummary);

  if (stats) {
    return (
      <DiffSummary
        fileCount={stats.filesChanged}
        additions={stats.insertions}
        deletions={stats.deletions}
        // The counts read as one line, never broken between their parts.
        className="stg:min-w-0 stg:whitespace-nowrap"
      />
    );
  }

  // Unparseable text (format drift): the raw trailing line is still honest;
  // structured-looking wrong numbers would not be.
  const raw = trailingDiffStatLine(diffSummary);
  if (!raw) return null;

  return (
    <span className="stg:min-w-0 stg:truncate stg:font-mono">{raw}</span>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring";

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (SDK
// independence — no icon-library dependency)
// ---------------------------------------------------------------------------

function GitBranchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="10.5" r="1.5" />
      <circle cx="10" cy="5.5" r="1.5" />
      <path d="M4 5V9" />
      <path d="M10 7V5.5" />
      <path d="M4 5C4 5 4 7 7 7C10 7 10 5.5 10 5.5" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <path d="M9 3L3 9" />
      <path d="M5 3H9V7" />
      <path d="M9 8V10H2V3H4" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5C8 1.95 7.55 1.5 7 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V7C1.5 7.55 1.95 8 2.5 8H4" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <path d="M2.5 6.5L5 9L9.5 3.5" />
    </svg>
  );
}
