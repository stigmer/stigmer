"use client";

import type { WorkspaceWriteBack } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link WriteBackCard}. */
export interface WriteBackCardProps {
  /** The workspace write-back outcome to render. */
  readonly writeBack: WorkspaceWriteBack;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Renders a single workspace write-back outcome as a compact card.
 *
 * Shows the workspace entry name, branch, diff summary, phase
 * indicator, and a "View PR" link when the pull request was
 * successfully created.
 *
 * Error rendering follows the record's phase honestly (DD-006):
 * a FAILED record's error is destructive (the work did not reach the
 * remote), while a PUSHED record carrying an error renders it as a
 * degraded notice — the branch is live and its info stays usable; only
 * the PR step failed.
 *
 * Themed via standard semantic tokens — no hardcoded colors, no
 * Console dependencies. Embedders can theme this card through
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
 */
export function WriteBackCard({ writeBack, className }: WriteBackCardProps) {
  const isFailed =
    writeBack.phase === WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED;
  const hasPR = !!writeBack.pullRequestUrl;

  return (
    <div
      role="article"
      aria-label={`Write-back: ${writeBack.workspaceEntryName}`}
      className={cn(
        "rounded-md border p-3",
        isFailed ? "border-destructive/40" : "border-border",
        className,
      )}
    >
      {/* Header: icon + workspace name + phase badge */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          <GitBranchIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {writeBack.workspaceEntryName}
            </span>
            <PhaseBadge phase={writeBack.phase} />
          </div>
          {writeBack.branchName && (
            <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {writeBack.branchName}
              {writeBack.baseBranch && (
                <span className="text-muted-foreground-subtle">
                  {" \u2190 "}
                  {writeBack.baseBranch}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Diff summary */}
      {writeBack.diffSummary && (
        <div className="mt-1.5 whitespace-pre-wrap font-mono text-xs text-muted-foreground">
          {writeBack.diffSummary}
        </div>
      )}

      {/* Error message: destructive when the write-back itself failed,
          degraded when the branch pushed but a later step (the PR) did not. */}
      {writeBack.error && (
        <div
          className={cn(
            "mt-1.5 rounded px-2 py-1 text-xs",
            isFailed
              ? "bg-destructive-subtle text-destructive"
              : "bg-status-degraded-subtle text-status-degraded",
          )}
        >
          {writeBack.error}
        </div>
      )}

      {/* PR link */}
      {hasPR && (
        <div className="mt-2">
          <a
            href={writeBack.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary-muted",
              FOCUS_RING_CLASSES,
            )}
          >
            <ExternalLinkIcon />
            View PR #{writeBack.pullRequestNumber}
          </a>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase badge
// ---------------------------------------------------------------------------

const PHASE_CONFIG: Record<
  number,
  { label: string; className: string }
> = {
  [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_COMMITTED]: {
    label: "Committed",
    className: "bg-muted text-muted-foreground",
  },
  [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PUSHED]: {
    label: "Pushed",
    className: "bg-muted text-muted-foreground",
  },
  [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED]: {
    label: "PR Created",
    className: "bg-primary-subtle text-primary",
  },
  [WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_FAILED]: {
    label: "Failed",
    className: "bg-destructive-subtle text-destructive",
  },
};

function PhaseBadge({ phase }: { phase: number }) {
  const config = PHASE_CONFIG[phase];
  if (!config) return null;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        config.className,
      )}
    >
      {config.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared style constants
// ---------------------------------------------------------------------------

const FOCUS_RING_CLASSES =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

// ---------------------------------------------------------------------------
// Inline SVG icons
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
