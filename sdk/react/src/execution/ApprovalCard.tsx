"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import {
  resolveToolCategory,
  extractPrimaryArgFromPreview,
  extractWriteContentFromPreview,
} from "./tool-categories";
import { FilePathLink } from "./FilePathLink";

export interface ApprovalCardProps {
  readonly pendingApproval: PendingApproval;
  /**
   * Called when the user clicks Approve, Skip, or Reject.
   * The consumer (typically {@link MessageThread} or a platform
   * builder's custom thread) handles the RPC via
   * {@link useSubmitApproval}.
   */
  readonly onSubmit: (action: ApprovalAction, comment?: string) => void;
  /** True while the RPC for this specific tool call is in flight. */
  readonly isSubmitting?: boolean;
  readonly className?: string;
}

const TRUNCATION_LINE_LIMIT = 8;

/**
 * Renders a pending tool-call approval request as a prominent card
 * with Approve, Skip, and Reject action buttons.
 *
 * Tool-type-aware: shell tools render the command in a terminal-style
 * block, file tools show the path prominently, and destructive tools
 * (delete) use warning styling. Falls back to generic JSON args
 * display for unrecognized tools.
 *
 * @example
 * ```tsx
 * <ApprovalCard
 *   pendingApproval={approval}
 *   onSubmit={(action) => submitApproval(executionId, approval.toolCallId, action)}
 *   isSubmitting={submittingIds.has(approval.toolCallId)}
 * />
 * ```
 */
export function ApprovalCard({
  pendingApproval,
  onSubmit,
  isSubmitting = false,
  className,
}: ApprovalCardProps) {
  const [activeAction, setActiveAction] = useState<ApprovalAction | null>(null);

  const handleAction = useCallback(
    (action: ApprovalAction) => {
      setActiveAction(action);
      onSubmit(action);
    },
    [onSubmit],
  );

  useEffect(() => {
    if (!isSubmitting) {
      setActiveAction(null);
    }
  }, [isSubmitting]);

  const categoryInfo = resolveToolCategory(pendingApproval.toolName);
  const primaryArg = extractPrimaryArgFromPreview(
    pendingApproval.toolName,
    pendingApproval.argsPreview,
  );

  const { header, headerIcon, borderClass } = getApprovalHeader(
    categoryInfo.category,
    pendingApproval.fromSubAgent,
  );

  return (
    <div
      role="alert"
      aria-label={`Approval required for ${pendingApproval.toolName}`}
      className={cn(
        "rounded-lg border px-4 py-3",
        borderClass,
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 text-sm font-medium text-warning">
        {headerIcon}
        <span>{header}</span>
      </div>

      {/* Sub-agent attribution */}
      {pendingApproval.fromSubAgent && pendingApproval.subAgentName && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Sub-agent{" "}
          <span className="font-medium text-foreground">
            {pendingApproval.subAgentName}
          </span>{" "}
          wants to execute a tool
        </p>
      )}

      {/* Tool name badge */}
      <div className="mt-2 flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
          {categoryInfo.label}
        </span>
        <WaitingDuration requestedAt={pendingApproval.requestedAt} />
      </div>

      {/* Approval message */}
      {pendingApproval.message && (
        <p className="mt-2 text-sm text-foreground">
          {pendingApproval.message}
        </p>
      )}

      {/* Category-specific args preview */}
      <div className="mt-2">
        <CategoryArgsPreview
          category={categoryInfo.category}
          primaryArg={primaryArg}
          argsPreview={pendingApproval.argsPreview}
        />
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex items-center gap-2">
        <ActionButton
          label="Approve"
          action={ApprovalAction.APPROVE}
          activeAction={activeAction}
          isSubmitting={isSubmitting}
          onClick={handleAction}
          variant="approve"
        />
        <ActionButton
          label="Skip"
          action={ApprovalAction.SKIP}
          activeAction={activeAction}
          isSubmitting={isSubmitting}
          onClick={handleAction}
          variant="skip"
        />
        <ActionButton
          label="Reject"
          action={ApprovalAction.REJECT}
          activeAction={activeAction}
          isSubmitting={isSubmitting}
          onClick={handleAction}
          variant="reject"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category-aware header
// ---------------------------------------------------------------------------

function getApprovalHeader(
  category: string,
  fromSubAgent: boolean,
): {
  header: string;
  headerIcon: React.JSX.Element;
  borderClass: string;
} {
  if (fromSubAgent) {
    return {
      header: "Sub-agent approval required",
      headerIcon: <ShieldIcon />,
      borderClass: "border-warning/30 bg-warning/5",
    };
  }

  switch (category) {
    case "shell":
      return {
        header: "Execute command",
        headerIcon: <TerminalApprovalIcon />,
        borderClass: "border-warning/30 bg-warning/5",
      };
    case "delete":
      return {
        header: "Delete file",
        headerIcon: <ShieldIcon />,
        borderClass: "border-destructive/30 bg-destructive/5",
      };
    default:
      return {
        header: "Approval required",
        headerIcon: <ShieldIcon />,
        borderClass: "border-warning/30 bg-warning/5",
      };
  }
}

// ---------------------------------------------------------------------------
// Category-specific args preview
// ---------------------------------------------------------------------------

function CategoryArgsPreview({
  category,
  primaryArg,
  argsPreview,
}: {
  category: string;
  primaryArg: string | null;
  argsPreview: string;
}) {
  if (category === "shell" && primaryArg) {
    return <ShellArgsPreview command={primaryArg} />;
  }

  if ((category === "read" || category === "write" || category === "edit" || category === "delete") && primaryArg) {
    return <FileArgsPreview path={primaryArg} category={category} argsPreview={argsPreview} />;
  }

  if ((category === "search" || category === "list") && primaryArg) {
    return <SearchArgsPreview pattern={primaryArg} />;
  }

  if (!argsPreview) return null;
  return <GenericArgsPreview content={argsPreview} />;
}

function ShellArgsPreview({ command }: { command: string }) {
  return (
    <div className="rounded-md border border-border bg-[var(--stgm-terminal-bg,#1a1a2e)] p-2.5">
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-[var(--stgm-terminal-fg,#e0e0e0)]">
        <span className="select-none text-[var(--stgm-terminal-prompt,#6b7280)]">$ </span>
        {command}
      </pre>
    </div>
  );
}

function FileArgsPreview({
  path,
  category,
  argsPreview,
}: {
  path: string;
  category: string;
  argsPreview: string;
}) {
  const writeContent = useMemo(
    () =>
      category === "write" || category === "edit"
        ? extractWriteContentFromPreview(argsPreview)
        : null,
    [category, argsPreview],
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-xs">
        <FilePathIcon />
        <FilePathLink path={path} className="text-xs" />
      </div>
      {writeContent && (
        <CollapsibleCodePreview
          label="Content"
          content={writeContent}
        />
      )}
    </div>
  );
}

function SearchArgsPreview({ pattern }: { pattern: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">Pattern:</span>
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
        {pattern}
      </code>
    </div>
  );
}

function GenericArgsPreview({ content }: { content: string }) {
  const formatted = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return content;
    }
  }, [content]);

  const lines = formatted.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
      : formatted;

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        Arguments
      </span>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-foreground">
        {displayContent}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          {isExpanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

function CollapsibleCodePreview({
  label,
  content,
}: {
  label: string;
  content: string;
}) {
  const lines = content.split("\n");
  const needsTruncation = lines.length > TRUNCATION_LINE_LIMIT;
  const [isExpanded, setIsExpanded] = useState(false);

  const displayContent =
    needsTruncation && !isExpanded
      ? lines.slice(0, TRUNCATION_LINE_LIMIT).join("\n") + "\n\u2026"
      : content;

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/40 p-2 font-mono text-xs text-foreground">
        {displayContent}
      </pre>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setIsExpanded((v) => !v)}
          className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          {isExpanded ? "Show less" : `Show all ${lines.length} lines`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  action,
  activeAction,
  isSubmitting,
  onClick,
  variant,
}: {
  label: string;
  action: ApprovalAction;
  activeAction: ApprovalAction | null;
  isSubmitting: boolean;
  onClick: (action: ApprovalAction) => void;
  variant: "approve" | "skip" | "reject";
}) {
  const isActive = activeAction === action;
  const disabled = isSubmitting;

  const variantClasses: Record<typeof variant, string> = {
    approve: cn(
      "bg-success text-success-foreground hover:bg-success/90",
      "disabled:bg-success/50 disabled:text-success-foreground/70",
    ),
    skip: cn(
      "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      "disabled:bg-muted/30 disabled:text-muted-foreground/50",
    ),
    reject: cn(
      "bg-destructive text-destructive-foreground hover:bg-destructive/90",
      "disabled:bg-destructive/50 disabled:text-destructive-foreground/70",
    ),
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(action)}
      aria-label={label}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed",
        variantClasses[variant],
      )}
    >
      {isActive && isSubmitting ? <SpinnerIcon /> : null}
      {label}
    </button>
  );
}

/**
 * Live-ticking elapsed time since the approval was requested.
 */
function WaitingDuration({ requestedAt }: { requestedAt: string }) {
  const startMs = useMemo(() => {
    if (!requestedAt) return null;
    const t = new Date(requestedAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [requestedAt]);

  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null) {
      setElapsed(null);
      return;
    }
    setElapsed(Math.max(0, Date.now() - startMs));
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startMs));
    }, 1000);
    return () => clearInterval(id);
  }, [startMs]);

  if (elapsed === null) return null;

  return (
    <span className="text-xs text-muted-foreground">
      waiting {formatElapsed(elapsed)}
    </span>
  );
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return "just now";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function ShieldIcon() {
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
      <path d="M7 1L2 3.5V6.5C2 9.75 4.1 12.35 7 13C9.9 12.35 12 9.75 12 6.5V3.5L7 1Z" />
      <path d="M7 5V8" />
      <circle cx="7" cy="10" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TerminalApprovalIcon() {
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
      <rect x="1" y="2" width="12" height="10" rx="2" />
      <path d="M4 5.5L6 7.5L4 9.5" />
      <path d="M7.5 9.5H10" />
    </svg>
  );
}

function FilePathIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M7 1H3C2.45 1 2 1.45 2 2V10C2 10.55 2.45 11 3 11H9C9.55 11 10 10.55 10 10V4L7 1Z" />
      <path d="M7 1V4H10" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}
