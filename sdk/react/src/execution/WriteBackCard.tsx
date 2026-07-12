"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { cn } from "@stigmer/theme";
import { DiffSummary } from "../version-history/DiffSummary.js";
import {
  parseDiffStatSummary,
  trailingDiffStatLine,
  writeBackDisplayName,
} from "./write-back-utils.js";

/** Props for {@link WriteBackCard}. */
export interface WriteBackCardProps {
  /** The workspace write-back outcome to render. */
  readonly writeBack: WorkspaceWriteBack;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Renders a single workspace write-back outcome as a dense, VS Code
 * Source-Control-style row group: a header (workspace name + quiet phase
 * caption), a pull-request row that opens the PR on the remote, a branch row
 * with a hover-revealed copy control, and an aggregate change-stat line.
 *
 * Row geometry, hover, and focus treatment match {@link ArtifactRow}, so the
 * session panel's Changes and Artifacts facets read as one surface. The PR
 * link and the copy control are SIBLING interactive elements, never nested
 * (axe `nested-interactive`, WCAG 4.1.2).
 *
 * Error rendering follows the record's phase honestly (DD-006):
 * a FAILED record's error is destructive (the work did not reach the
 * remote), while a PUSHED record carrying an error renders it as a
 * degraded notice — the branch is live and its info stays usable; only
 * the PR step failed.
 *
 * The stat line is parsed from the record's `git diff --stat` summary and
 * rendered through the shared {@link DiffSummary} component; unparseable
 * text degrades to the raw trailing line rather than showing wrong numbers.
 *
 * Themed via standard semantic tokens — no hardcoded colors, no
 * Console dependencies. Embedders can theme this component through
 * their Tailwind/CSS configuration.
 *
 * @example
 * ```tsx
 * const { writeBacks } = useWorkspaceWriteBacks(execution);
 *
 * {writeBacks.map((wb) => (
 *   <WriteBackCard
 *     key={wb.workspaceEntryName}
 *     writeBack={wb}
 *   />
 * ))}
 * ```
 *
 * @see useWorkspaceWriteBacks — extracts write-back data from an execution
 * @see writeBackDisplayName — the header's entry-name fallback chain
 */
export function WriteBackCard({ writeBack, className }: WriteBackCardProps) {
  const isFailed =
    writeBack.phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED;
  const hasPR = !!writeBack.pullRequestUrl;
  const displayName = writeBackDisplayName(writeBack);

  return (
    <div
      role="article"
      aria-label={`Write-back: ${displayName}`}
      className={cn("flex flex-col", className)}
    >
      {/* Header: workspace name + quiet phase caption */}
      <div className="flex items-center gap-2 px-2 py-1">
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium text-foreground"
          title={displayName}
        >
          {displayName}
        </span>
        <PhaseCaption
          phase={writeBack.phase}
          pullRequestNumber={writeBack.pullRequestNumber}
        />
      </div>

      {/* Pull-request row — the primary action when the PR exists */}
      {hasPR && (
        <PullRequestRow
          url={writeBack.pullRequestUrl}
          number={writeBack.pullRequestNumber}
        />
      )}

      {/* Branch row — primary when no PR was created; the branch is still
          the user's handle on the pushed work */}
      {writeBack.branchName && (
        <BranchRow
          branchName={writeBack.branchName}
          baseBranch={writeBack.baseBranch}
        />
      )}

      {/* Error message: destructive when the write-back itself failed,
          degraded when the branch pushed but a later step (the PR) did not. */}
      {writeBack.error && (
        <div
          className={cn(
            "mx-2 my-1 rounded px-2 py-1 text-xs",
            isFailed
              ? "bg-destructive-subtle text-destructive"
              : "bg-status-degraded-subtle text-status-degraded",
          )}
        >
          {writeBack.error}
        </div>
      )}

      {/* Aggregate change stats */}
      {writeBack.diffSummary && <StatLine diffSummary={writeBack.diffSummary} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase caption — quiet header text, replacing the retired pill badge
// ---------------------------------------------------------------------------

function PhaseCaption({
  phase,
  pullRequestNumber,
}: {
  phase: WorkspaceWriteBackPhase;
  pullRequestNumber: number;
}) {
  let label: string;
  switch (phase) {
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_COMMITTED:
      label = "Committed";
      break;
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED:
      label = "Pushed";
      break;
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED:
      label = pullRequestNumber > 0 ? `PR #${pullRequestNumber}` : "PR created";
      break;
    case WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED:
      label = "Failed";
      break;
    default:
      return null;
  }

  return (
    <span
      className={cn(
        "shrink-0 text-[10px] font-medium tabular-nums",
        phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED
          ? "text-destructive"
          : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pull-request row
// ---------------------------------------------------------------------------

function PullRequestRow({ url, number }: { url: string; number: number }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "group flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        FOCUS_RING_CLASSES,
      )}
    >
      <span className="shrink-0">
        <PullRequestIcon />
      </span>
      <span className="min-w-0 flex-1 truncate text-foreground">
        {number > 0 ? `Pull Request #${number}` : "Pull Request"}
      </span>
      <span
        className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        aria-hidden="true"
      >
        <ExternalLinkIcon />
      </span>
    </a>
  );
}

// ---------------------------------------------------------------------------
// Branch row — info + sibling hover-revealed copy control
// ---------------------------------------------------------------------------

/** How long the copy control shows its "copied" confirmation. */
const COPIED_FEEDBACK_MS = 2000;

function BranchRow({
  branchName,
  baseBranch,
}: {
  branchName: string;
  baseBranch: string;
}) {
  const [copied, setCopied] = useState(false);

  // Clear the pending feedback timer on unmount so a resolved copy never
  // sets state on an unmounted component (same guard as useArtifactCopy).
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    };
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(branchName).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(
        () => setCopied(false),
        COPIED_FEEDBACK_MS,
      );
    });
  }, [branchName]);

  return (
    <div className="group flex items-stretch">
      <div
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-xs"
        title={baseBranch ? `${branchName} \u2190 ${baseBranch}` : branchName}
      >
        <span className="shrink-0 text-muted-foreground">
          <GitBranchIcon />
        </span>
        <span className="min-w-0 truncate font-mono text-foreground">
          {branchName}
        </span>
        {baseBranch && (
          <span className="shrink-0 font-mono text-muted-foreground-faint">
            {"\u2190 "}
            {baseBranch}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Branch name copied" : `Copy branch name ${branchName}`}
        title={copied ? "Copied" : "Copy branch name"}
        className={cn(
          "flex shrink-0 items-center px-2 text-muted-foreground transition-opacity",
          copied
            ? "opacity-100"
            : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat line — parsed --stat summary through the shared DiffSummary
// ---------------------------------------------------------------------------

function StatLine({ diffSummary }: { diffSummary: string }) {
  const stats = parseDiffStatSummary(diffSummary);

  if (stats) {
    return (
      <DiffSummary
        fileCount={stats.filesChanged}
        additions={stats.insertions}
        deletions={stats.deletions}
        className="px-2 py-1"
      />
    );
  }

  // Unparseable text (format drift): the raw trailing line is still honest;
  // structured-looking wrong numbers would not be.
  const raw = trailingDiffStatLine(diffSummary);
  if (!raw) return null;

  return (
    <div className="px-2 py-1 font-mono text-xs text-muted-foreground">
      {raw}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

// ---------------------------------------------------------------------------
// Inline SVG icons — monochrome, `currentColor`-tinted (DD-005; SDK
// independence — no icon-library dependency)
// ---------------------------------------------------------------------------

function GitBranchIcon() {
  return (
    <svg
      width="14"
      height="14"
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

/** Git pull-request glyph: base branch line joined to the merge commit. */
function PullRequestIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="3.5" cy="3.5" r="1.5" />
      <circle cx="3.5" cy="10.5" r="1.5" />
      <circle cx="10.5" cy="10.5" r="1.5" />
      <path d="M3.5 5V9" />
      <path d="M7 3.5H8.5C9.6 3.5 10.5 4.4 10.5 5.5V9" />
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
      className="shrink-0"
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
      className="shrink-0"
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
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M2.5 6.5L5 9L9.5 3.5" />
    </svg>
  );
}
