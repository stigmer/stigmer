"use client";

import { memo, useCallback } from "react";
import type { FileChangeSet } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileReviewSet } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { FileReviewCard } from "./FileReviewCard.js";
import type { FileReviewAction, ReviewFileChangesOptions } from "./useReviewFileChanges.js";

/** A stable empty map so a dock without captures keeps a constant default. */
const NO_CAPTURES: ReadonlyMap<string, FileChangeSet> = new Map();

/** Props for {@link FileReviewDock}. */
export interface FileReviewDockProps {
  /**
   * The sets with files still undecided. Renders nothing when empty. Feed
   * this from `useSessionConversation().fileReviewSets` — the newest turn's
   * undecided sets, finished or not, the same seam whose `reviewFileChanges`
   * decides them, so what the dock shows and what it can decide are
   * consistent by construction.
   */
  readonly fileReviewSets: readonly FileReviewSet[];
  /**
   * The captured bytes of the sets, by change set id, when the caller holds
   * the runs (`useSessionConversation().fileChangeCaptures`): each file's
   * capture provenance renders from them.
   */
  readonly captures?: ReadonlyMap<string, FileChangeSet>;
  /**
   * Called when the person decides on one of the docked sets. Wire to
   * `useSessionConversation().reviewFileChanges` (or an equivalent
   * {@link useReviewFileChanges}-backed handler bound to the session).
   */
  readonly onSubmit: (
    changeSetId: string,
    action: FileReviewAction,
    options: ReviewFileChangesOptions,
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
 * undecided `FileReviewSet` as an interactive {@link FileReviewCard}
 * decision bar, pinned in the fixed strip above the composer.
 *
 * WHY DOCKED, NOT IN-THREAD. The transcript's stamped edit rows are
 * observational — they show what changed, badged with the live review state —
 * but the newest turn's open decision must never scroll out of view. An
 * in-thread card does exactly that on a long conversation. The turn does not
 * wait on it: its edits are already applied, Undo puts a file back, and the
 * next message keeps whatever is still undecided. Docking the bar to
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
 * `useSessionConversation` (headless-first). `SessionViewer` wires it
 * in by default; platform builders composing a custom layout mount it over the
 * same seam.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 * <FileReviewDock
 *   fileReviewSets={conv.fileReviewSets}
 *   captures={conv.fileChangeCaptures}
 *   onSubmit={conv.reviewFileChanges}
 *   submittingDecisionKeys={conv.submittingFileDecisionKeys}
 *   decisionErrors={conv.fileDecisionErrors}
 * />
 * ```
 */
export function FileReviewDock({
  fileReviewSets,
  captures = NO_CAPTURES,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
  className,
}: FileReviewDockProps) {
  if (fileReviewSets.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="File changes awaiting review"
      data-cursor-target="file-review-dock"
      className={cn("stg:border-t stg:border-border-muted", className)}
    >
      {/* The cap bounds the dock, not each card: with the (defensive) multi-set
          case the whole surface stays within reach of the composer. */}
      <div className="stg:max-h-[40vh] stg:space-y-2 stg:overflow-y-auto stg:px-4 stg:py-2">
        {fileReviewSets.map((set) => (
          <DockedChangeSet
            key={set.changeSetId}
            set={set}
            capture={captures.get(set.changeSetId) ?? null}
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
  readonly set: FileReviewSet;
  readonly capture: FileChangeSet | null;
  readonly onSubmit: (
    changeSetId: string,
    action: FileReviewAction,
    options: ReviewFileChangesOptions,
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
  set,
  capture,
  onSubmit,
  submittingDecisionKeys,
  decisionErrors,
}: DockedChangeSetProps) {
  const handleSubmit = useCallback(
    (action: FileReviewAction, options: ReviewFileChangesOptions) => {
      onSubmit(set.changeSetId, action, options);
    },
    [onSubmit, set.changeSetId],
  );

  return (
    <FileReviewCard
      fileReviewSet={set}
      capture={capture}
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
