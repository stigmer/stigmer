"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { describeApprovalPolicySource } from "./approval-provenance";
import {
  resolveToolCategoryFromKind,
  extractPrimaryArgFromPreview,
  type ToolCategory,
} from "./tool-categories";
import { CATEGORY_ICON } from "./ToolCallItem";
import { ToolArgsView } from "./ToolArgsView";
import { FileChangeDiff } from "./FileChangesView";

/** Props for {@link ApprovalCard}. */
export interface ApprovalCardProps {
  /** The pending approval request to render. */
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
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a pending tool-call approval request with the same visual
 * structure as an expanded {@link ToolCallItem} in the history list.
 *
 * The compact header row matches the ToolCallItem layout:
 *   [CategoryIcon] Label  primaryArg  [⏳ waiting Xm]
 *
 * The body shows the most decision-relevant preview: when the
 * approval carries the runner's `file_changes` capture, a real
 * before/after {@link FileChangeDiff} (one per changed file);
 * otherwise the shared {@link ToolArgsView} dispatch, keeping
 * pixel-level parity with the post-execution detail view.
 *
 * Wrapped in `React.memo` — structural sharing (T04) preserves the
 * `PendingApproval` reference when unchanged, so approval cards
 * skip re-renders during unrelated stream updates.
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
export const ApprovalCard = memo(function ApprovalCard({
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

  // Prefer the denormalized wire tool_kind (populated by the server-side
  // PendingApproval projection); fall back to the name for legacy executions.
  const categoryInfo = resolveToolCategoryFromKind(
    pendingApproval.toolKind,
    pendingApproval.toolName,
    pendingApproval.mcpServerSlug,
  );

  const CategoryIcon = CATEGORY_ICON[categoryInfo.category];

  const primaryArg = useMemo(
    () =>
      extractPrimaryArgFromPreview(
        pendingApproval.toolName,
        pendingApproval.argsPreview,
        pendingApproval.mcpServerSlug,
      ),
    [
      pendingApproval.toolName,
      pendingApproval.argsPreview,
      pendingApproval.mcpServerSlug,
    ],
  );

  const parsedArgs = useMemo<Record<string, unknown> | null>(() => {
    if (!pendingApproval.argsPreview) return null;
    try {
      const parsed = JSON.parse(pendingApproval.argsPreview);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }, [pendingApproval.argsPreview]);

  // APPROVE_ALL now grants a run-lifetime lease scoped to the clicked tool's
  // CLASS — its MCP server for an MCP tool, else its approval category (where
  // write and edit collapse to one "file edits" class, mirroring the runner's
  // toolApprovalCategory). The label must name that exact class so the button
  // never over-promises: it does NOT silence other classes.
  const approveAllLabel = useMemo(
    () => buildApproveAllLabel(categoryInfo.category, pendingApproval.mcpServerSlug),
    [categoryInfo.category, pendingApproval.mcpServerSlug],
  );

  // Why-gated: the authorization provenance the server projected onto the
  // PendingApproval (approval_policy_source). Explains which policy layer is
  // holding this call for approval ("required by agent override") so the user
  // understands the gate without guessing. Empty for legacy executions.
  const gateReason = useMemo(
    () => describeApprovalPolicySource(pendingApproval.approvalPolicySource),
    [pendingApproval.approvalPolicySource],
  );

  const borderClass =
    categoryInfo.category === "delete"
      ? "border-destructive/30 bg-destructive-subtle"
      : "border-warning/30 bg-warning/5";

  return (
    <div
      role="alert"
      aria-label={`Approval required for ${pendingApproval.toolName}`}
      className={cn("rounded-lg border", borderClass, className)}
    >
      {/* Compact header row — matches ToolCallItem layout */}
      <div
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 text-xs",
          "border-b border-border-muted",
        )}
      >
        <span className="shrink-0 text-warning" aria-hidden="true">
          <CategoryIcon />
        </span>

        <span className="min-w-0 flex-1 flex items-baseline gap-1.5 overflow-hidden">
          <span className="shrink-0 font-medium text-foreground">
            {categoryInfo.label}
          </span>
          {primaryArg && (
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {primaryArg}
            </span>
          )}
        </span>

        {pendingApproval.fromSubAgent && pendingApproval.subAgentName && (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-muted-foreground">
            via {pendingApproval.subAgentSubject || pendingApproval.subAgentName}
          </span>
        )}

        <WaitingDuration requestedAt={pendingApproval.requestedAt} />

        <span className="shrink-0 text-warning" aria-hidden="true">
          <ClockIcon />
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        {pendingApproval.message && categoryInfo.category !== "shell" && (
          <p className="text-xs text-foreground">
            {pendingApproval.message}
          </p>
        )}

        {gateReason && (
          <p className="text-xs italic text-muted-foreground" data-cursor-target="approval-gate-reason">
            {gateReason}
          </p>
        )}

        {/* A file-modifying approval carries the runner's before/after capture
            on file_changes; render the diff as the primary preview. It already
            names the file and quantifies the change, so the ToolArgsView args
            (path + raw content) would only duplicate it — the same composition
            ToolCallDetail uses for its `edit` case. Non-file tools (or a file
            tool whose capture is absent) fall back to the shared args view. */}
        {pendingApproval.fileChanges.length > 0
          ? pendingApproval.fileChanges.map((fileChange) => (
              <FileChangeDiff key={fileChange.path} change={fileChange} />
            ))
          : parsedArgs && (
              <ToolArgsView
                toolName={pendingApproval.toolName}
                args={parsedArgs}
                mcpServerSlug={pendingApproval.mcpServerSlug}
              />
            )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 pt-1">
          <ActionButton
            label="Approve"
            action={ApprovalAction.APPROVE}
            activeAction={activeAction}
            isSubmitting={isSubmitting}
            onClick={handleAction}
            variant="approve"
            cursorTarget="approve-button"
          />
          {/* Subordinate escalation: approve this call and stop asking for THIS
              CLASS of tool for the rest of the run (its MCP server, or its file
              edit / delete / shell category) — other classes keep prompting. The
              label names the leased class so the scope is never a surprise. Kept
              visually quieter than the primary Approve so it never competes with
              the per-call decision the user is making. */}
          <ActionButton
            label={approveAllLabel}
            action={ApprovalAction.APPROVE_ALL}
            activeAction={activeAction}
            isSubmitting={isSubmitting}
            onClick={handleAction}
            variant="approveAll"
            cursorTarget="approve-all-button"
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
    </div>
  );
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the truthful APPROVE_ALL button label for a tool's lease class.
 *
 * The lease an APPROVE_ALL grants is scoped to ONE class: the MCP server for an
 * MCP tool, otherwise the approval category (write/delete/shell) — where the
 * presentation "write" and "edit" categories collapse to a single "file edits"
 * class, exactly as the runner's `toolApprovalCategory` collapses FILE_WRITE and
 * FILE_EDIT to "write". The label names that class so the button never implies a
 * broader effect than the lease actually has. The generic fallback only applies
 * to a tool with no leasable class, which is not normally gated for approval.
 */
function buildApproveAllLabel(
  category: ToolCategory,
  mcpServerSlug: string,
): string {
  if (mcpServerSlug) {
    return `Approve all ${mcpServerSlug} tools`;
  }
  switch (category) {
    case "shell":
      return "Approve all shell commands";
    case "delete":
      return "Approve all file deletions";
    case "write":
    case "edit":
      return "Approve all file edits";
    default:
      return "Approve all of this kind";
  }
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
  cursorTarget,
}: {
  label: string;
  action: ApprovalAction;
  activeAction: ApprovalAction | null;
  isSubmitting: boolean;
  onClick: (action: ApprovalAction) => void;
  variant: "approve" | "approveAll" | "skip" | "reject";
  cursorTarget?: string;
}) {
  const isActive = activeAction === action;
  const disabled = isSubmitting;

  const variantClasses: Record<typeof variant, string> = {
    approve: cn(
      "bg-success text-success-foreground hover:bg-success/90",
      "disabled:bg-success/50 disabled:text-success-foreground/70",
    ),
    approveAll: cn(
      "text-success hover:bg-success/10",
      "disabled:text-success/50",
    ),
    skip: cn(
      "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      "disabled:bg-muted-faint disabled:text-muted-foreground-faint",
    ),
    reject: cn(
      "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
      "disabled:bg-destructive-subtle0 disabled:text-destructive-foreground/70",
    ),
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick(action)}
      aria-label={label}
      data-cursor-target={cursorTarget}
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
    <span className="shrink-0 text-xs text-muted-foreground">
      {formatElapsed(elapsed)}
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

function ClockIcon() {
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
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
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
