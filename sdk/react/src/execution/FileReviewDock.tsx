"use client";

import { memo, useCallback } from "react";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { FileDecisionAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { FileReviewCard } from "./FileReviewCard.js";
import type { FileDecisionOptions } from "./useFileReview.js";

/** Props for {@link FileReviewDock}. */
export interface FileReviewDockProps {
  /**
   * The change sets awaiting review. Renders nothing when empty. Feed this from
   * `useSessionConversation().fileChangeSets` — the AWAITING_REVIEW sets of the
   * active execution, the same seam whose `submitFileDecision` routes decisions
   * to that execution, so what the dock shows and what it can decide are
   * consistent by construction.
   */
  readonly changeSets: readonly FileChangeSet[];
  /**
   * Called when the user makes a decision on one of the docked sets. Wire to
   * `useSessionConversation().submitFileDecision` (or an equivalent
   * {@link useFileReview}-backed handler bound to the owning execution).
   */
  readonly onSubmit: (
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => void;
  /**
   * Decision keys ({@link fileDecisionKey}) currently being submitted. Drives
   * per-control loading state — see {@link FileReviewCardProps.submittingDecisionKeys}.
   */
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  /**
   * Per-decision failures, keyed like {@link submittingDecisionKeys} — surfaced
   * in-card beside the control that failed.
   */
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The composer-docked decision surface for pending file reviews: renders each
 * AWAITING_REVIEW {@link FileChangeSet} as an interactive {@link FileReviewCard}
 * decision bar, pinned in the fixed strip above the composer.
 *
 * WHY DOCKED, NOT IN-THREAD. The transcript's stamped edit rows are
 * observational — they show what changed, badged with the live review state —
 * but a *decision* the agent is blocked on must never scroll out of view. An
 * in-thread card does exactly that on a long conversation. Docking the bar to
 * the composer keeps the pending decision visible regardless of scroll
 * position, matching the shape of Cursor's own review bar. Once decided, the
 * dock empties and the thread's read-only record (and the rows' Kept/Discarded
 * badges) carry the history.
 *
 * This placement deliberately diverges from tool approvals, which stay inline
 * on their rows (with `ApprovalPeekBar` as the scroll backstop): an approval is
 * call-anchored — "run *this* command" — while a file review is a turn-scoped
 * aggregate over many calls, with no single row that owns it.
 *
 * The expanded per-file body is height-capped with internal scroll: a set that
 * needs per-file attention starts expanded (see {@link FileReviewCard}), and an
 * unconstrained list in a fixed strip would swallow the viewport.
 *
 * Purely presentational — the data and decision routing live in
 * `useSessionConversation` (headless-first, DD-003). `SessionViewer` wires it
 * in by default; platform builders composing a custom layout mount it over the
 * same seam.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId);
 * <FileReviewDock
 *   changeSets={conv.fileChangeSets}
 *   onSubmit={conv.submitFileDecision}
 *   submittingDecisionKeys={conv.submittingFileDecisionKeys}
 *   decisionErrors={conv.fileDecisionErrors}
 * />
 * ```
 */
export function FileReviewDock({
  changeSets,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
  className,
}: FileReviewDockProps) {
  if (changeSets.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="File changes awaiting review"
      data-cursor-target="file-review-dock"
      className={cn("border-t border-border-muted", className)}
    >
      {/* The cap bounds the dock, not each card: with the (defensive) multi-set
          case the whole surface stays within reach of the composer. */}
      <div className="max-h-[40vh] space-y-2 overflow-y-auto px-4 py-2">
        {changeSets.map((changeSet) => (
          <DockedChangeSet
            key={changeSet.id}
            changeSet={changeSet}
            onSubmit={onSubmit}
            submittingDecisionKeys={submittingDecisionKeys}
            decisionErrors={decisionErrors}
          />
        ))}
      </div>
    </div>
  );
}

interface DockedChangeSetProps {
  readonly changeSet: FileChangeSet;
  readonly onSubmit: (
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => void;
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  readonly decisionErrors?: ReadonlyMap<string, Error>;
}

/**
 * One docked set — binds the set id into the card's `(action, options)` submit
 * signature with a stable callback so `FileReviewCard`'s `React.memo` holds
 * across unrelated stream frames.
 */
const DockedChangeSet = memo(function DockedChangeSet({
  changeSet,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
}: DockedChangeSetProps) {
  const handleSubmit = useCallback(
    (action: FileDecisionAction, options?: FileDecisionOptions) => {
      onSubmit(changeSet.id, action, options);
    },
    [onSubmit, changeSet.id],
  );

  return (
    <FileReviewCard
      fileChangeSet={changeSet}
      onSubmit={handleSubmit}
      submittingDecisionKeys={submittingDecisionKeys}
      decisionErrors={decisionErrors}
      // The transcript's stamped edit rows show every diff in place, so the
      // docked card renders the compact file list — the decision surface never
      // duplicates the thread's diffs.
      showDiffs={false}
    />
  );
});
