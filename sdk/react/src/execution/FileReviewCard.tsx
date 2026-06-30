"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileChangeSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  DiffCompleteness,
  FileChangeCaptureLevel,
  FileChangeKind,
  FileChangeType,
  FileDecisionAction,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { FileChangeDiff } from "./FileChangesView";
import { DiffSummary } from "../version-history/DiffSummary";
import { DecisionButton } from "../internal/DecisionButton";
import type { FileDecisionOptions } from "./useFileReview";

/** Props for {@link FileReviewCard}. */
export interface FileReviewCardProps {
  /** The captured change set awaiting review (status AWAITING_REVIEW). */
  readonly fileChangeSet: FileChangeSet;
  /**
   * Called when the user approves or rejects. The consumer (typically
   * {@link MessageThread} or a platform builder's surface) handles the RPC via
   * {@link useFileReview}. The default scope is CHANGE_SET (the whole set).
   */
  readonly onSubmit: (action: FileDecisionAction, options?: FileDecisionOptions) => void;
  /** True while a decision RPC for this change set is in flight. */
  readonly isSubmitting?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a captured {@link FileChangeSet} for review: a summary bar, the
 * per-file before/after diffs (reusing {@link FileChangeDiff}), and the
 * Approve all / Reject all decision buttons.
 *
 * File edits are reviewed as a unit — a captured workspace delta, not tool
 * calls — so this is a dedicated review surface distinct from the message
 * transcript and the tool-approval {@link ApprovalCard}. A CHANGE_SET decision
 * covers every file and clears the unified HITL gate; the runner then reconciles
 * the exact approved bytes with hash verification.
 *
 * An incomplete diff (`diff_completeness != COMPLETE`) cannot be approved as
 * complete — the Approve button is disabled with an explanation, the structural
 * guard against approving an unreviewable change.
 *
 * Wrapped in `React.memo` — the streamed `FileChangeSet` reference is preserved
 * by structural sharing when unchanged, so review cards skip re-renders during
 * unrelated stream updates.
 *
 * @example
 * ```tsx
 * <FileReviewCard
 *   fileChangeSet={changeSet}
 *   onSubmit={(action, opts) => submitFileDecision(executionId, changeSet.id, action, opts)}
 *   isSubmitting={submittingDecisionKeys.has(changeSet.id)}
 * />
 * ```
 */
export const FileReviewCard = memo(function FileReviewCard({
  fileChangeSet,
  onSubmit,
  isSubmitting = false,
  className,
}: FileReviewCardProps) {
  const [activeAction, setActiveAction] = useState<FileDecisionAction | null>(null);

  useEffect(() => {
    if (!isSubmitting) setActiveAction(null);
  }, [isSubmitting]);

  const handleAction = useCallback(
    (action: FileDecisionAction) => {
      setActiveAction(action);
      // Whole-set decision: CHANGE_SET scope, bound to the aggregate digest the
      // reviewer saw (the enforcement gate the runner re-verifies at reconcile).
      onSubmit(action, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: fileChangeSet.aggregateDigest,
      });
    },
    [onSubmit, fileChangeSet.aggregateDigest],
  );

  const changes = fileChangeSet.changes;
  const fileChanges = useMemo(() => changes.map(toFileChange), [changes]);

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const c of changes) {
      if (c.kind === FileChangeKind.ADD) additions += 1;
      else if (c.kind === FileChangeKind.DELETE) deletions += 1;
    }
    return { additions, deletions };
  }, [changes]);

  // A non-COMPLETE diff (elided / binary-only / partial) can never be approved
  // as if complete — the structural guard against approving an unreviewable set.
  const incomplete = fileChangeSet.diffCompleteness !== DiffCompleteness.COMPLETE;

  return (
    <div
      role="alert"
      aria-label={`Review ${changes.length} file change${changes.length === 1 ? "" : "s"}`}
      className={cn(
        "rounded-lg border border-border-prominent border-l-2 border-l-warning",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-muted px-2.5 py-1.5 text-xs">
        <span className="shrink-0 font-medium text-foreground">Review file changes</span>
        <span className="text-muted-foreground">
          {changes.length} file{changes.length === 1 ? "" : "s"} awaiting review
        </span>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <DiffSummary
          fileCount={changes.length}
          additions={totals.additions}
          deletions={totals.deletions}
        />

        {fileChanges.map((change) => (
          <FileChangeDiff key={change.path} change={change} bounded />
        ))}

        {incomplete && (
          <p className="text-[11px] italic text-muted-foreground">
            This change can't be reviewed completely (a file is binary or the diff
            was truncated), so it can't be approved as a complete change.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <DecisionButton
            label="Approve all"
            variant="primary"
            onClick={() => handleAction(FileDecisionAction.APPROVE)}
            isActive={activeAction === FileDecisionAction.APPROVE}
            isSubmitting={isSubmitting}
            disabled={incomplete}
            cursorTarget="file-review-approve"
          />
          <DecisionButton
            label="Reject all"
            variant="danger"
            onClick={() => handleAction(FileDecisionAction.REJECT)}
            isActive={activeAction === FileDecisionAction.REJECT}
            isSubmitting={isSubmitting}
            cursorTarget="file-review-reject"
          />
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Adapter — CapturedFileChange (file_review) -> FileChange (the diff renderer)
// ---------------------------------------------------------------------------

/**
 * Adapt a {@link CapturedFileChange} (the file_review ledger type) to the legacy
 * {@link FileChange} the {@link FileChangeDiff} renderer consumes. The two reuse
 * the same {@link FileContent} for before/after, so the bodies map directly; the
 * capture is always WHOLE_FILE (the candidate carries the byte-exact sides).
 */
function toFileChange(captured: CapturedFileChange): FileChange {
  return create(FileChangeSchema, {
    path: captured.pathAfter || captured.pathBefore,
    changeType: toFileChangeType(captured.kind),
    captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
    before: captured.before,
    after: captured.after,
    renameFrom: captured.kind === FileChangeKind.RENAME ? captured.pathBefore : "",
  });
}

function toFileChangeType(kind: FileChangeKind): FileChangeType {
  switch (kind) {
    case FileChangeKind.ADD:
      return FileChangeType.CREATE;
    case FileChangeKind.DELETE:
      return FileChangeType.DELETE;
    case FileChangeKind.RENAME:
      return FileChangeType.RENAME;
    default:
      return FileChangeType.MODIFY;
  }
}
