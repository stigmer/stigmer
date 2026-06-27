"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { ApprovalAction, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import {
  describeApprovalPolicySource,
  isInformativePolicySource,
} from "./approval-provenance";
import {
  resolveToolCategoryFromKind,
  extractPrimaryArgFromPreview,
  extractWriteContentFromPreview,
  isFileCategory,
  type ToolCategory,
} from "./tool-categories";
import { CATEGORY_ICON } from "./ToolCallItem";
import { ToolArgsView } from "./ToolArgsView";
import { FileChangeDiff } from "./FileChangesView";
import { EmptyChangeNotice } from "./EmptyChangeNotice";
import { FilePathLink } from "./FilePathLink";
import { DecisionButton } from "../internal/DecisionButton";

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
  // Prefer the denormalized wire tool_kind (populated by the server-side
  // PendingApproval projection); fall back to the name for legacy executions.
  const categoryInfo = resolveToolCategoryFromKind(
    pendingApproval.toolKind,
    pendingApproval.toolName,
    pendingApproval.mcpServerSlug,
  );

  // Cursor-grade chrome: a thin neutral card (no amber "brown" fill), with the
  // gate's "needs your decision" signal carried by one restrained cue — a 2px
  // left accent bar — plus the warning-colored clock/elapsed in the header. A
  // destructive (delete) gate keeps a red accent as a hard safety signal.
  const accentClass =
    categoryInfo.category === "delete"
      ? "border-l-2 border-l-destructive"
      : "border-l-2 border-l-warning";

  return (
    <div
      role="alert"
      aria-label={`Approval required for ${pendingApproval.toolName}`}
      className={cn(
        "rounded-lg border border-border-prominent",
        accentClass,
        className,
      )}
    >
      <ApprovalCardHeader pendingApproval={pendingApproval} bordered />
      <ApprovalCardBody
        pendingApproval={pendingApproval}
        onSubmit={onSubmit}
        isSubmitting={isSubmitting}
      />
    </div>
  );
});

/** Props for {@link ApprovalCardHeader}. */
export interface ApprovalCardHeaderProps {
  /** The pending approval to summarize. */
  readonly pendingApproval: PendingApproval;
  /** Adds a bottom divider, for use above {@link ApprovalCardBody}. */
  readonly bordered?: boolean;
}

/**
 * The compact summary row of an approval — `[icon] Label primaryArg [via sub]
 * [⏳ Xm]`. Used as the standalone {@link ApprovalCard}'s header. Not rendered
 * inline on a {@link ToolCallItem}, whose own row already serves as the header.
 */
export function ApprovalCardHeader({
  pendingApproval,
  bordered = false,
}: ApprovalCardHeaderProps) {
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
        pendingApproval.toolKind,
      ),
    [
      pendingApproval.toolName,
      pendingApproval.argsPreview,
      pendingApproval.mcpServerSlug,
      pendingApproval.toolKind,
    ],
  );

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2.5 py-1.5 text-xs",
        bordered && "border-b border-border-muted",
      )}
    >
      <span className="shrink-0 text-warning" aria-hidden="true">
        <CategoryIcon />
      </span>

      <span className="min-w-0 flex-1 flex items-center gap-1.5 overflow-hidden">
        <span className="shrink-0 font-medium text-foreground">
          {categoryInfo.label}
        </span>
        {primaryArg &&
          categoryInfo.category !== "shell" &&
          (isFileCategory(categoryInfo.category) ? (
            // A file tool's primary arg is a path — render it filename-first
            // with the full path on hover, matching the ToolCallItem header.
            <FilePathLink
              path={primaryArg}
              className="min-w-0 text-xs text-muted-foreground"
            />
          ) : (
            // Shell is the exception: its command is shown in the body's
            // terminal session, so the header stays minimal (icon + label).
            <span className="min-w-0 truncate font-mono text-muted-foreground">
              {primaryArg}
            </span>
          ))}
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
  );
}

/** Props for {@link ApprovalCardBody}. */
export interface ApprovalCardBodyProps {
  /** The pending approval to render a decision panel for. */
  readonly pendingApproval: PendingApproval;
  /** Called when the user picks Approve / Approve-all / Skip / Reject. */
  readonly onSubmit: (action: ApprovalAction, comment?: string) => void;
  /** True while the RPC for this tool call is in flight. */
  readonly isSubmitting?: boolean;
  /** Additional CSS class names for the body container. */
  readonly className?: string;
}

/**
 * The decision panel of an approval: the optional message and gate reason, the
 * file-changes / args preview, and the action buttons. Reused in two places —
 * the standalone {@link ApprovalCard} (with {@link ApprovalCardHeader} above
 * it) and inline inside a gated {@link ToolCallItem}'s expanded panel, where
 * the item's own row is the header. One body, identical preview in both.
 */
export function ApprovalCardBody({
  pendingApproval,
  onSubmit,
  isSubmitting = false,
  className,
}: ApprovalCardBodyProps) {
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

  const categoryInfo = resolveToolCategoryFromKind(
    pendingApproval.toolKind,
    pendingApproval.toolName,
    pendingApproval.mcpServerSlug,
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
  // PendingApproval (approval_policy_source). Smart-suppressed — the everyday
  // "this category needs approval" default is noise next to the action it gates,
  // so only a genuinely informative provenance (an explicit override, a
  // server-marked destructive tighten) earns a line; the full phrase is on hover.
  const gateReason = useMemo(
    () => describeApprovalPolicySource(pendingApproval.approvalPolicySource),
    [pendingApproval.approvalPolicySource],
  );
  const showGateReason =
    gateReason != null &&
    isInformativePolicySource(pendingApproval.approvalPolicySource);

  // The runner's message for a file tool ("Write file: <path>") only restates
  // the header + diff, so it is suppressed; a message is shown only when it adds
  // information (e.g. an MCP tool's human-authored prompt). Shell shows its
  // command in the args view, never a message.
  const showMessage =
    Boolean(pendingApproval.message) &&
    categoryInfo.category !== "shell" &&
    !isFileCategory(categoryInfo.category);

  const isWriteEdit =
    categoryInfo.category === "write" || categoryInfo.category === "edit";

  // The proposed write/edit content from the args preview, when the gate carries
  // no authoritative file_changes capture. Drives the three-way fallback below.
  const writeContent = useMemo(
    () => extractWriteContentFromPreview(pendingApproval.argsPreview),
    [pendingApproval.argsPreview],
  );

  // The decision-relevant preview. A file-modifying approval carries the
  // runner's before/after capture on file_changes; render that diff as the
  // primary preview — the card header already names the file, so the per-file
  // header is suppressed for a single change to avoid restating the path. When
  // no capture is present, fall back honestly: show the proposed write/edit
  // content if the args carry it (path suppressed — the header has it); show a
  // neutral "no preview" notice when only a path is known (the resume
  // placeholder case); otherwise the shared args view for non-file tools.
  const fileChanges = pendingApproval.fileChanges;
  let preview: ReactNode = null;
  if (fileChanges.length > 0) {
    const single = fileChanges.length === 1;
    preview = fileChanges.map((fileChange) => (
      <FileChangeDiff
        key={fileChange.path}
        change={fileChange}
        showFileName={!single}
        // The gate is a decision moment, not a full editor — cap the diff so a
        // large change cannot push the action buttons off-screen.
        bodyClassName="max-h-80"
      />
    ));
  } else if (isWriteEdit && writeContent === null) {
    // No capture and no proposed content. A whole-file write is modeled as a
    // create throughout the runner (FILE_WRITE -> CREATE), so the authoritative
    // toolKind lets the gate say plainly that a new file is being written rather
    // than the misleading non-committal "no preview". An edit (modify) cannot be
    // proven a create, so it keeps the non-committal notice.
    const kind =
      pendingApproval.toolKind === ToolKind.FILE_WRITE ? "create" : "no-preview";
    preview = <EmptyChangeNotice kind={kind} />;
  } else if (parsedArgs) {
    preview = (
      <ToolArgsView
        toolName={pendingApproval.toolName}
        args={parsedArgs}
        mcpServerSlug={pendingApproval.mcpServerSlug}
        showFileName={!isWriteEdit}
      />
    );
  }

  return (
    <div className={cn("px-3 py-2.5 space-y-2", className)}>
      {showMessage && (
        <p className="text-xs text-foreground">{pendingApproval.message}</p>
      )}

      {preview}

      {/* Decision actions — quiet, Cursor-grade hierarchy: one neutral-chip
          primary (Approve), ghost Skip, ghost-danger Reject. The broad
          run-lifetime lease (Approve all) is demoted to the far right via
          `ml-auto` so it never competes with — or is mis-clicked for — the
          per-call Approve (Fitts/Hick). */}
      <div className="flex items-center gap-2 pt-1">
        <DecisionButton
          label="Approve"
          variant="primary"
          onClick={() => handleAction(ApprovalAction.APPROVE)}
          isActive={activeAction === ApprovalAction.APPROVE}
          isSubmitting={isSubmitting}
          cursorTarget="approve-button"
        />
        <DecisionButton
          label="Skip"
          variant="ghost"
          onClick={() => handleAction(ApprovalAction.SKIP)}
          isActive={activeAction === ApprovalAction.SKIP}
          isSubmitting={isSubmitting}
        />
        <DecisionButton
          label="Reject"
          variant="danger"
          onClick={() => handleAction(ApprovalAction.REJECT)}
          isActive={activeAction === ApprovalAction.REJECT}
          isSubmitting={isSubmitting}
        />
        {/* Subordinate escalation: approve this call AND stop asking for THIS
            CLASS of tool for the rest of the run (its MCP server, or its file
            edit / delete / shell category) — other classes keep prompting. The
            label names the leased class so the scope is never a surprise. */}
        <DecisionButton
          label={approveAllLabel}
          variant="ghost"
          onClick={() => handleAction(ApprovalAction.APPROVE_ALL)}
          isActive={activeAction === ApprovalAction.APPROVE_ALL}
          isSubmitting={isSubmitting}
          className="ml-auto"
          cursorTarget="approve-all-button"
        />
      </div>

      {/* De-emphasized provenance, trailing the decision it explains. Only the
          informative reasons reach here (see showGateReason); the full phrase is
          on hover. */}
      {showGateReason && (
        <p
          className="text-[11px] italic text-muted-foreground"
          title={gateReason ?? undefined}
          data-cursor-target="approval-gate-reason"
        >
          {gateReason}
        </p>
      )}
    </div>
  );
}

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
