"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import type {
  CapturedFileChange,
  FileChangeSet,
  FileDecision,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileCaptureClass,
  FileChangeKind,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toDisplayFileChange } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { FileChangeDiff } from "./FileChangesView.js";
import { FilePathLink } from "./FilePathLink.js";
import { DiffSummary } from "../version-history/DiffSummary.js";
import { DecisionButton } from "../internal/DecisionButton.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import { fileDecisionKey, type FileDecisionOptions } from "./useFileReview.js";
import {
  changeSetReviewability,
  deriveEffectiveVerdicts,
  fileReviewability,
  type FileReviewability,
} from "./file-review-status.js";

/** A stable empty set so the default `submittingDecisionKeys` keeps a constant ref. */
const NO_KEYS: ReadonlySet<string> = new Set();

/** A stable empty map so the default `decisionErrors` keeps a constant ref. */
const NO_ERRORS: ReadonlyMap<string, Error> = new Map();

/** Props for {@link FileReviewCard}. */
export interface FileReviewCardProps {
  /** The captured change set awaiting review (status AWAITING_REVIEW). */
  readonly fileChangeSet: FileChangeSet;
  /**
   * Called when the user makes a decision. The consumer (typically
   * {@link MessageThread} or a platform builder's surface) handles the RPC via
   * {@link useFileReview}. A whole-set Approve/Reject sends `CHANGE_SET` scope;
   * a per-file Keep/Discard sends `FILE` scope with the file's id. Optional and
   * ignored when {@link FileReviewCardProps.interactive} is `false`.
   */
  readonly onSubmit?: (action: FileDecisionAction, options?: FileDecisionOptions) => void;
  /**
   * Whether the card presents decision controls. Defaults to `true` (the live
   * review surface). Set to `false` to render a **settled** change set read-only:
   * the per-file diffs and each file's committed verdict are shown, but the
   * decision controls, bulk footer, and error affordances are omitted. Used for a
   * decided/reconciled set, or any set on a terminal execution — a historical
   * record of what changed and how it was decided, not an actionable gate.
   */
  readonly interactive?: boolean;
  /**
   * Whether the expanded body renders each file's diff. Defaults to `true` —
   * the right default wherever this card is the *only* review surface (the
   * workflow file-review list, standalone platform-builder embeds).
   *
   * `MessageThread` passes `false`: the transcript's stamped edit rows already
   * show every diff in place, so the expanded body collapses to a compact file
   * list (kind letter + linked path + `+N −M` + per-file controls) and the card
   * stays purely the decision surface. Decision semantics — digests, scopes,
   * acknowledgments — are identical in both modes; this is presentation only
   * (opt-in with a backward-compatible default, DD-011).
   */
  readonly showDiffs?: boolean;
  /**
   * The decision keys currently being submitted — exactly the set
   * {@link useFileReview} returns as `submittingDecisionKeys`. A card has more
   * than one decision target (the whole set plus each file), so it takes the
   * keyed set rather than a single boolean and derives each control's in-flight
   * state via {@link fileDecisionKey}.
   */
  readonly submittingDecisionKeys?: ReadonlySet<string>;
  /**
   * Per-decision failures, keyed exactly like {@link submittingDecisionKeys}
   * (via {@link fileDecisionKey}) — the set's id for a whole-set decision, the
   * `setId:fileChangeId` for a per-file one. A failed decision is surfaced
   * in-card, beside the control that failed (and the optimistic verdict reverts),
   * so the reviewer sees *which* action did not take and why. Supply
   * {@link useFileReview}'s `decisionErrors`.
   */
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a captured {@link FileChangeSet} as a **compact decision bar**: one
 * line carrying the set summary and the whole-set decision controls, with the
 * per-file detail behind an expander. What the expander holds depends on
 * {@link FileReviewCardProps.showDiffs}: the diff-rich body (default — for
 * surfaces where this card is the only review surface) or a compact file list
 * (the session thread, whose stamped edit rows already show every diff in
 * place). A set that needs per-file attention (binary acknowledgment, blocked
 * files, mid-review) starts expanded.
 *
 * File edits are reviewed as a captured workspace delta, not tool calls, so this
 * is a dedicated decision surface distinct from the message transcript and the
 * tool-approval {@link ApprovalCard}. The reviewer can decide each file
 * individually (Keep / Discard, a `FILE`-scoped decision) or act on the whole
 * set at once (Approve / Reject, a `CHANGE_SET` decision). Either way the runner
 * reconciles the exact approved bytes with hash verification.
 *
 * The unified HITL gate clears only when EVERY file has a verdict — one
 * `CHANGE_SET` decision, or a `FILE` decision per file — so a partially-decided
 * set stays actionable and deciding the last file is what resumes the turn. A
 * per-file verdict is changeable while the set is still open: clicking the other
 * option records a new decision (the backend reconcile is last-write-wins).
 *
 * A `binary-only` set (binary files are the only blocker) can be kept in one
 * action: the bulk button reads "Keep all" and carries the acknowledgment
 * (DD-17). A `blocked` set (something unavailable to review) cannot be approved
 * as a whole — the Approve button is disabled with an explanation, and the
 * per-file path is the escape: keep the reviewable files and discard the rest.
 *
 * Each non-reviewable file is labeled honestly by {@link fileReviewability}: a
 * `binary` change has no text diff to review; an `unavailable` change is one
 * whose diff isn't available at all, with the honest cause the runner recorded
 * (a secret path whose bytes were never captured, or a diff dropped to bound the
 * status — doc 15). Both are discard-only, and their Keep affordance is disabled
 * with the reason associated via `aria-describedby`. Files captured outside
 * normal git tracking (gitignored / non-git CAS) carry a small provenance badge
 * so the reviewer knows the change is not part of the repo's tracked history.
 *
 * Wrapped in `React.memo` — the streamed `FileChangeSet` reference is preserved
 * by structural sharing when unchanged, so review cards skip re-renders during
 * unrelated stream updates.
 *
 * @example
 * ```tsx
 * const { submitFileDecision, submittingDecisionKeys } = useFileReview();
 * <FileReviewCard
 *   fileChangeSet={changeSet}
 *   onSubmit={(action, opts) => submitFileDecision(executionId, changeSet.id, action, opts)}
 *   submittingDecisionKeys={submittingDecisionKeys}
 * />
 * ```
 */
export const FileReviewCard = memo(function FileReviewCard({
  fileChangeSet,
  onSubmit,
  submittingDecisionKeys = NO_KEYS,
  decisionErrors = NO_ERRORS,
  interactive = true,
  showDiffs = true,
  className,
}: FileReviewCardProps) {
  const changes = fileChangeSet.changes;
  const total = changes.length;
  const setId = fileChangeSet.id;

  // Each file's current verdict, a last-write-wins fold over the ledger-ordered
  // FILE decisions (the same precedence the runner reconcile applies). Drives
  // which per-file option reads as selected and the reviewed-count progress.
  const verdictByFileId = useMemo(
    () => deriveFileVerdicts(fileChangeSet.decisions),
    [fileChangeSet.decisions],
  );
  const decidedCount = verdictByFileId.size;

  // The EFFECTIVE verdicts for history (a CHANGE_SET decision covers every file
  // a FILE decision does not override — the reconcile's own precedence), so a
  // settled "Keep all" set reads every file as kept, never "Not reviewed".
  // Interactive per-file selection deliberately keeps the FILE-only fold above.
  const effectiveVerdicts = useMemo(
    () => deriveEffectiveVerdicts(fileChangeSet),
    [fileChangeSet],
  );

  // The set-level reviewability drives the bulk affordance. A "binary-only" set
  // (binary files are the ONLY blocker) is keepable in one acknowledged action
  // ("Keep all", DD-17); a "blocked" set (a secret/elided file with no keepable
  // bytes) can never be approved at once and must be resolved per file.
  const reviewability = changeSetReviewability(fileChangeSet);
  const incomplete = reviewability !== "complete";
  const binaryOnly = reviewability === "binary-only";

  // Per-file controls earn their space when there is more than one file OR when a
  // lone file is not reviewable — a single binary needs its per-file "Keep anyway"
  // (FILE-scope, acknowledged), which the CHANGE_SET-scoped bulk controls can't
  // offer. A single COMPLETE file stays decided once via the bar's bulk controls.
  const showPerFile = total > 1 || incomplete;
  // The bulk (CHANGE_SET) controls live on the bar for multi-file sets and for a
  // single complete file; they are hidden for a single incomplete file, whose
  // only honest decision is the per-file control in the expanded body (a single
  // binary uses its per-file "Keep anyway" — DD-16 — and a blocked lone file can
  // only be discarded).
  const showBulkControls = total > 1 || !incomplete;

  // The bar starts expanded exactly when the collapsed bar cannot honestly carry
  // the decision: an incomplete set (binary acknowledgment / blocked files need
  // their per-file context), a review already in progress, or a multi-file set
  // in compact-list mode — its honest decision surface includes the per-file
  // Keep/Discard controls, which must be visible without hunting behind the
  // expander (the docked strip bounds the height, so expanding is cheap there).
  // Diff-rich mode (`showDiffs`) deliberately stays collapsed for a complete
  // multi-file set: its expanded body is every full diff with no height cap
  // (the workflow file-review list), where "Review" is the act of opening it.
  // A settled record always starts collapsed — the transcript's stamped rows
  // already show what changed, and the expander reveals detail on demand.
  const [expanded, setExpanded] = useState(
    () =>
      interactive && (incomplete || decidedCount > 0 || (total > 1 && !showDiffs)),
  );
  const bodyId = useId();

  const wholeSetSubmitting = submittingDecisionKeys.has(setId);
  const wholeSetError = decisionErrors.get(setId) ?? null;

  // Bulk (CHANGE_SET) decision state — mirrors ApprovalCardBody: one active
  // action drives the clicked button's spinner, cleared when the RPC settles.
  const [activeAction, setActiveAction] = useState<FileDecisionAction | null>(null);
  useEffect(() => {
    if (!wholeSetSubmitting) setActiveAction(null);
  }, [wholeSetSubmitting]);

  const handleBulk = useCallback(
    (action: FileDecisionAction) => {
      setActiveAction(action);
      // Whole-set decision: CHANGE_SET scope, bound to the aggregate digest the
      // reviewer saw (the enforcement gate the runner re-verifies at reconcile).
      // A "Keep all" on a binary-only set carries the acknowledgment: the
      // binaries have no text diff but reconcilable bytes, so the user
      // consciously keeps the whole set (DD-17). The server honors it only when
      // every incompleteness is binary and never relaxes the digest gate.
      onSubmit?.(action, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: fileChangeSet.aggregateDigest,
        acknowledgeUnreviewable: action === FileDecisionAction.APPROVE && binaryOnly,
      });
    },
    [onSubmit, fileChangeSet.aggregateDigest, binaryOnly],
  );

  const handleFileDecide = useCallback(
    (change: CapturedFileChange, action: FileDecisionAction) => {
      // Per-file decision: FILE scope correlated by the change id, bound to that
      // file's digest (echoed verbatim — the server compares it against the same
      // captured value, so it can never spuriously mismatch). A "Keep anyway" on a
      // binary file carries the acknowledgment: it has no text diff, but its exact
      // bytes are captured and reconcilable, so the user consciously keeps it
      // (DD-16). The server honors this only for a binary file and never relaxes
      // the digest gate.
      onSubmit?.(action, {
        scope: FileDecisionScope.FILE,
        fileChangeId: change.id,
        expectedDigest: change.fileDigest,
        acknowledgeUnreviewable:
          action === FileDecisionAction.APPROVE &&
          fileReviewability(change).kind === "binary",
      });
    },
    [onSubmit],
  );

  // The set's aggregate `+N −M`, summed from the capture-time per-file counts
  // (linesAdded/linesRemoved are stamped by the runner with the same diff
  // algorithm the renderers use — see CapturedFileChange). A file with no
  // counts (binary, secret-withheld, or a record predating the fields)
  // contributes zero; when NO file has counts the aggregate is hidden rather
  // than shown as a dishonest "+0 −0".
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const c of changes) {
      additions += c.linesAdded;
      deletions += c.linesRemoved;
    }
    return { additions, deletions };
  }, [changes]);

  // Which non-reviewable classes are present in the set — folded once (memoized
  // like `totals`, DD-010) so the blocked-set copy is accurate to what's actually
  // here (never the generic "binary or truncated").
  const blockSummary = useMemo(() => {
    let hasBinary = false;
    let hasUnavailable = false;
    for (const c of changes) {
      const r = fileReviewability(c);
      if (r.kind === "binary") hasBinary = true;
      else if (r.kind === "unavailable") hasUnavailable = true;
    }
    return { hasBinary, hasUnavailable };
  }, [changes]);

  // Associates the disabled whole-set Approve with the notice explaining why it
  // is unavailable (a11y: a disabled action is never an unexplained dead end).
  const incompleteNoticeId = useId();

  const labels = bulkLabels(total, decidedCount, binaryOnly);
  // A set the DD-28 policy kept (every change produced by a command the user
  // already approved) says so explicitly: consent was given at the command
  // gate, and the record must never read as if a human reviewed it here.
  const autoKept = !interactive && isPolicyAutoKept(fileChangeSet);
  const summary = interactive
    ? `${total} file${total === 1 ? "" : "s"} awaiting review`
    : autoKept
      ? "Kept automatically — produced by a command you approved"
      : settledSummary(total, changes, effectiveVerdicts);

  return (
    <div
      // Interactive: an actionable alert (a pending gate). Read-only: a passive
      // historical record, so a neutral group without the warning accent.
      role={interactive ? "alert" : "group"}
      aria-label={
        interactive
          ? `Review ${total} file change${total === 1 ? "" : "s"}`
          : `${total} file change${total === 1 ? "" : "s"}`
      }
      className={cn(
        "rounded-lg border border-border-prominent",
        interactive && "border-l-2 border-l-warning",
        className,
      )}
    >
      {/* The bar: summary + whole-set verdict + the detail expander, one line. */}
      <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-xs">
        <span className="shrink-0 font-medium text-foreground">
          {interactive ? "Review file changes" : "File changes"}
        </span>
        {/* The flexible middle: the summary (truncating) plus the set's
            aggregate +N −M, visible even while collapsed so the bar carries
            the magnitude of what is being decided, not just the file count.
            Hidden when no file has counts (FileLineStats). */}
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
          <FileLineStats
            linesAdded={totals.additions}
            linesRemoved={totals.deletions}
          />
        </span>

        {interactive && showBulkControls && (
          <>
            <DecisionButton
              label={labels.approve}
              variant="primary"
              onClick={() => handleBulk(FileDecisionAction.APPROVE)}
              isActive={activeAction === FileDecisionAction.APPROVE}
              isSubmitting={wholeSetSubmitting}
              disabled={incomplete && !binaryOnly}
              ariaDescribedby={incomplete ? incompleteNoticeId : undefined}
              cursorTarget="file-review-approve"
            />
            <DecisionButton
              label={labels.reject}
              variant="danger"
              onClick={() => handleBulk(FileDecisionAction.REJECT)}
              isActive={activeAction === FileDecisionAction.REJECT}
              isSubmitting={wholeSetSubmitting}
              cursorTarget="file-review-reject"
            />
          </>
        )}

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((v) => !v)}
          data-cursor-target="file-review-expander"
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1",
            "text-xs font-medium text-muted-foreground transition-colors",
            "hover:bg-accent-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          {/* The closed label states what expanding reveals: the reviewable
              diffs ("Review"), the file inventory ("Files"), or a settled
              record ("Show"). */}
          {expanded ? "Hide" : !interactive ? "Show" : showDiffs ? "Review" : "Files"}
          <ExpanderChevron expanded={expanded} />
        </button>
      </div>

      {/* The disabled whole-set Approve's explanation must be visible even when
          the diffs are collapsed, so it lives on the bar, not in the body. */}
      {interactive && incomplete && showBulkControls && (
        <p
          id={incompleteNoticeId}
          className="px-2.5 pb-1.5 text-[11px] italic text-muted-foreground"
        >
          {incompleteNotice(showPerFile, blockSummary, binaryOnly)}
        </p>
      )}

      {/* A failed whole-set decision is surfaced HERE, in-card, not via the
          session's global error banner. A review surface has many decision
          targets (the whole set plus each file), so a failure must name the
          control it belongs to — something a single global banner cannot do.
          Rendered on the bar so it is visible regardless of expansion. */}
      {interactive && wholeSetError && (
        <div className="px-2.5 pb-1.5">
          <InCardDecisionError
            error={wholeSetError}
            leadIn="submit decision"
            cursorTarget="file-review-error"
          />
        </div>
      )}

      {expanded && (
        <div
          id={bodyId}
          className="space-y-2 border-t border-border-muted px-3 py-2.5"
        >
          {/* The list body carries no summary header: the bar already shows
              the file count and the aggregate +N −M (per-file counts are
              capture-time facts on the wire — linesAdded/linesRemoved — so no
              body fetch is ever needed to decorate the list). Diff mode keeps
              its fuller DiffSummary line above the rendered diffs. */}
          {showDiffs && (
            <DiffSummary
              fileCount={total}
              additions={totals.additions}
              deletions={totals.deletions}
            />
          )}

          {!interactive
            ? // Settled: every file paired with its committed EFFECTIVE
              // verdict (a bulk decision covers files without their own), no
              // controls — a record of what changed and how it was decided.
              changes.map((change) => (
                <SettledFileRow
                  key={change.id}
                  change={change}
                  verdict={effectiveVerdicts.get(change.id) ?? null}
                  showDiffs={showDiffs}
                />
              ))
            : showPerFile
              ? changes.map((change) => (
                  <FileChangeReviewRow
                    key={change.id}
                    change={change}
                    verdict={verdictByFileId.get(change.id) ?? null}
                    isSubmitting={
                      submittingDecisionKeys.has(fileDecisionKey(setId, change.id)) ||
                      wholeSetSubmitting
                    }
                    error={decisionErrors.get(fileDecisionKey(setId, change.id)) ?? null}
                    onDecide={handleFileDecide}
                    showDiffs={showDiffs}
                  />
                ))
              : // A single complete file decided via the bar's bulk controls:
                // its detail is informational, with no per-file control.
                changes.map((change) =>
                  showDiffs ? (
                    <div key={change.id} className="space-y-1.5">
                      <CaptureBadge change={change} />
                      <CapturedChangeDiff change={change} />
                    </div>
                  ) : (
                    <FileListRow key={change.id} change={change} />
                  ),
                )}

          {interactive && showPerFile && (
            <ReviewProgress decided={decidedCount} total={total} />
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Whether the set was kept by the approved-command auto-keep policy (DD-28):
 * some decision carries origin POLICY_APPROVED_COMMAND. Origin is audit
 * provenance — the record label derives from it so an automatic keep is never
 * presented as a human review.
 */
function isPolicyAutoKept(fileChangeSet: FileChangeSet): boolean {
  return fileChangeSet.decisions.some(
    (d) => d.origin === FileDecisionOrigin.POLICY_APPROVED_COMMAND,
  );
}

/**
 * The settled bar's one-line history: verdict counts folded from the effective
 * decisions ("2 kept · 1 discarded"), with an honest "not reviewed" bucket for
 * files a terminated set never decided. Falls back to a plain changed-count
 * when nothing was decided at all.
 */
function settledSummary(
  total: number,
  changes: readonly CapturedFileChange[],
  effectiveVerdicts: ReadonlyMap<string, FileDecisionAction>,
): string {
  let kept = 0;
  let discarded = 0;
  for (const c of changes) {
    const v = effectiveVerdicts.get(c.id);
    if (v === FileDecisionAction.APPROVE) kept++;
    else if (v === FileDecisionAction.REJECT) discarded++;
  }
  const undecided = total - kept - discarded;
  if (kept === 0 && discarded === 0) {
    return `${total} file${total === 1 ? "" : "s"} changed`;
  }
  const parts: string[] = [];
  if (kept > 0) parts.push(`${kept} kept`);
  if (discarded > 0) parts.push(`${discarded} discarded`);
  if (undecided > 0) parts.push(`${undecided} not reviewed`);
  return parts.join(" · ");
}

/** The bar expander's disclosure chevron (rotates when open). */
function ExpanderChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// FileChangeReviewRow — one file paired with its Keep/Discard verdict
// ---------------------------------------------------------------------------

interface FileChangeReviewRowProps {
  readonly change: CapturedFileChange;
  /** The file's committed verdict (server truth), or null if undecided. */
  readonly verdict: FileDecisionAction | null;
  /** True while THIS file's decision (or a whole-set decision) is in flight. */
  readonly isSubmitting: boolean;
  /** This file's last failed decision, or null — surfaced beside its control. */
  readonly error: Error | null;
  readonly onDecide: (change: CapturedFileChange, action: FileDecisionAction) => void;
  /** Diff-rich body vs compact list line — see {@link FileReviewCardProps.showDiffs}. */
  readonly showDiffs: boolean;
}

/**
 * One reviewable file with its Keep/Discard control. The decision machinery
 * (verdict radiogroup, block-reason note, in-card error) is identical in both
 * body modes; only the file presentation varies — the bounded diff, or the
 * compact {@link FileListRow} line with the control trailing it.
 */
const FileChangeReviewRow = memo(function FileChangeReviewRow({
  change,
  verdict,
  isSubmitting,
  error,
  onDecide,
  showDiffs,
}: FileChangeReviewRowProps) {
  // One classification per change drives BOTH the disabled Keep and its reason,
  // so the two can never disagree (single source of truth).
  const reviewability = fileReviewability(change);
  const blocked = reviewability.kind !== "reviewable";
  const reasonId = useId();
  const verdictControl = (
    <FileVerdictControl
      change={change}
      reviewability={reviewability}
      verdict={verdict}
      isSubmitting={isSubmitting}
      onDecide={onDecide}
      describedById={blocked ? reasonId : undefined}
    />
  );
  return (
    <div className="space-y-1.5">
      {showDiffs ? (
        <>
          <CaptureBadge change={change} />
          <CapturedChangeDiff change={change} />
          {verdictControl}
        </>
      ) : (
        <FileListRow change={change} trailing={verdictControl} />
      )}
      {blocked && <BlockReasonNote reviewability={reviewability} id={reasonId} />}
      {error && (
        <InCardDecisionError
          error={error}
          leadIn="save"
          cursorTarget="file-review-file-error"
        />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// SettledFileRow — one file paired with its committed verdict (read-only)
// ---------------------------------------------------------------------------

interface SettledFileRowProps {
  readonly change: CapturedFileChange;
  /** The file's committed verdict, or null if the set was never decided. */
  readonly verdict: FileDecisionAction | null;
  /** Diff-rich body vs compact list line — see {@link FileReviewCardProps.showDiffs}. */
  readonly showDiffs: boolean;
}

/**
 * A read-only file row for a settled change set: the capture provenance badge
 * and a static verdict badge, with the before/after diff in diff mode or the
 * compact list line otherwise. No decision controls — the verdict is history,
 * not an action. Used by the read-only {@link FileReviewCard}
 * (`interactive={false}`) for decided/reconciled sets and terminal executions.
 */
const SettledFileRow = memo(function SettledFileRow({
  change,
  verdict,
  showDiffs,
}: SettledFileRowProps) {
  if (!showDiffs) {
    return <FileListRow change={change} trailing={<VerdictBadge verdict={verdict} />} />;
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <CaptureBadge change={change} />
        <VerdictBadge verdict={verdict} />
      </div>
      <CapturedChangeDiff change={change} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// CapturedChangeDiff — a captured change's bounded diff (showDiffs mode)
// ---------------------------------------------------------------------------

/**
 * Projects a {@link CapturedFileChange} onto the display `FileChange` and
 * renders its bounded diff — the one place the diff body renders, shared by the
 * interactive, settled, and single-file branches of the diff-mode body.
 */
function CapturedChangeDiff({ change }: { change: CapturedFileChange }) {
  const adapted = useMemo(() => toDisplayFileChange(change), [change]);
  return <FileChangeDiff change={adapted} bounded />;
}

// ---------------------------------------------------------------------------
// FileListRow — one file as a compact list line (list mode)
// ---------------------------------------------------------------------------

/**
 * One file of the change set as a compact list line: kind letter, linked path,
 * `+N −M` stats, provenance badge, and an optional trailing slot (the verdict
 * control while reviewing; the committed verdict once settled).
 *
 * The path renders through `FilePathLink` — the platform-wide path idiom — so
 * a reviewer can jump from the list to the file itself (the session viewer
 * routes the click into the panel's diff-first viewer; GitHub/copy is the
 * fallback) without leaving the decision surface. Deciding and navigating
 * coexist: the link stops click propagation, so opening a file never fights
 * the row's Keep/Discard controls. A rename shows its source path so the move
 * reads in one line.
 */
function FileListRow({
  change,
  trailing,
}: {
  readonly change: CapturedFileChange;
  readonly trailing?: React.ReactNode;
}) {
  const path = change.pathAfter || change.pathBefore;
  const renamedFrom =
    change.kind === FileChangeKind.RENAME && change.pathBefore !== change.pathAfter
      ? change.pathBefore
      : "";
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-1"
      data-cursor-target="file-review-list-row"
    >
      <FileKindBadge kind={change.kind} />
      {renamedFrom && (
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground-faint">
          {renamedFrom}&nbsp;→&nbsp;
        </span>
      )}
      <FilePathLink path={path} dirDisplay="dim" className="min-w-0 flex-1 text-xs" />
      <FileLineStats
        linesAdded={change.linesAdded}
        linesRemoved={change.linesRemoved}
      />
      <CaptureBadge change={change} />
      {trailing}
    </div>
  );
}

/**
 * The `+N −M` stat for one file (or a whole set), in the same visual
 * vocabulary as the tool-row diff stats. Renders nothing when both counts are
 * zero — the honest signal that no count exists (binary or secret-withheld
 * changes, records captured before counts were stamped) — rather than a
 * misleading `+0 −0`.
 */
function FileLineStats({
  linesAdded,
  linesRemoved,
}: {
  readonly linesAdded: number;
  readonly linesRemoved: number;
}) {
  if (linesAdded === 0 && linesRemoved === 0) return null;
  return (
    <span
      className="shrink-0 text-xs tabular-nums"
      aria-label={`${linesAdded} added, ${linesRemoved} removed`}
      data-cursor-target="file-review-line-stats"
    >
      <span className="text-diff-added-fg">+{linesAdded}</span>{" "}
      <span className="text-diff-removed-fg">-{linesRemoved}</span>
    </span>
  );
}

/** The kind letter, tone, and a11y name for each wire {@link FileChangeKind}. */
const KIND_BADGE: Partial<
  Record<FileChangeKind, { letter: string; colorClass: string; label: string }>
> = {
  [FileChangeKind.ADD]: {
    letter: "A",
    colorClass: "text-diff-added-fg",
    label: "added",
  },
  [FileChangeKind.MODIFY]: {
    letter: "M",
    colorClass: "text-diff-hunk-header-fg",
    label: "modified",
  },
  [FileChangeKind.DELETE]: {
    letter: "D",
    colorClass: "text-diff-removed-fg",
    label: "deleted",
  },
  [FileChangeKind.RENAME]: {
    letter: "R",
    colorClass: "text-diff-hunk-header-fg",
    label: "renamed",
  },
  // A binary change is a modification whose diff is not text; the letter stays
  // M and the binary-ness is told by the row's "Keep anyway" + reason note.
  [FileChangeKind.BINARY_CHANGE]: {
    letter: "M",
    colorClass: "text-diff-hunk-header-fg",
    label: "modified (binary)",
  },
};

/**
 * The single-letter change-kind marker — the same M/A/D visual vocabulary as
 * the version-history `DiffFileList`, extended with R for captured renames.
 * The letter itself is the non-color channel; the full word is exposed to
 * assistive tech. An UNSPECIFIED kind renders nothing rather than guessing.
 */
function FileKindBadge({ kind }: { kind: FileChangeKind }) {
  const badge = KIND_BADGE[kind];
  if (!badge) return null;
  return (
    <span
      className={cn("shrink-0 font-mono text-[10px] font-bold", badge.colorClass)}
      aria-label={badge.label}
    >
      {badge.letter}
    </span>
  );
}

/**
 * A change's committed verdict as a static badge: APPROVE reads "Kept" (the
 * bytes were reconciled into the workspace), REJECT reads "Discarded" (reverted
 * to baseline), and an undecided change (a set terminated mid-review) reads "Not
 * reviewed". Uses the same diff add/remove tokens the card uses elsewhere, so it
 * introduces no new token.
 */
function VerdictBadge({ verdict }: { verdict: FileDecisionAction | null }) {
  if (verdict === FileDecisionAction.APPROVE) {
    return (
      <span className="shrink-0 text-[11px] font-medium text-diff-added-fg">Kept</span>
    );
  }
  if (verdict === FileDecisionAction.REJECT) {
    return (
      <span className="shrink-0 text-[11px] font-medium text-diff-removed-fg">
        Discarded
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[11px] italic text-muted-foreground">
      Not reviewed
    </span>
  );
}

// ---------------------------------------------------------------------------
// FileVerdictControl — a Keep|Discard segmented control for one file
// ---------------------------------------------------------------------------

interface FileVerdictControlProps {
  readonly change: CapturedFileChange;
  /** The file's reviewability — `Keep` is available only when `reviewable`. */
  readonly reviewability: FileReviewability;
  readonly verdict: FileDecisionAction | null;
  readonly isSubmitting: boolean;
  readonly onDecide: (change: CapturedFileChange, action: FileDecisionAction) => void;
  /** Id of the reason note describing why `Keep` is unavailable (a11y). */
  readonly describedById?: string;
}

/**
 * The per-file decision affordance: a two-option segmented control modeled as a
 * `radiogroup` (the established idiom across the SDK — Keep XOR Discard is a
 * persistent, mutually-exclusive choice because the card stays visible after
 * each file decision). The committed verdict reads as `aria-checked`; clicking
 * the other option flips it (a new last-write-wins decision).
 *
 * `Keep` behavior by reviewability: a `reviewable` file keeps normally; a
 * `binary` file has no text diff but reconcilable bytes, so `Keep` is enabled as
 * an explicit "Keep anyway" that carries the acknowledgment (DD-16); an
 * `unavailable` file (secret-withheld / size-elided) has no keepable bytes, so
 * `Keep` stays disabled — it can only be discarded. `describedById` associates
 * the group with the note explaining the binary/unavailable case.
 */
function FileVerdictControl({
  change,
  reviewability,
  verdict,
  isSubmitting,
  onDecide,
  describedById,
}: FileVerdictControlProps) {
  // Optimistic: show the clicked option immediately; the server's decisions
  // projection then confirms it (or, on failure, it reverts to `verdict`).
  const [pending, setPending] = useState<FileDecisionAction | null>(null);
  useEffect(() => {
    if (!isSubmitting) setPending(null);
  }, [isSubmitting]);

  const effective = pending ?? verdict;
  const path = change.pathAfter || change.pathBefore;
  // A binary file is keepable via an explicit acknowledgment; only a truly
  // unavailable diff (no captured bytes) leaves Keep disabled.
  const isBinary = reviewability.kind === "binary";
  const keepDisabled = reviewability.kind === "unavailable";
  const keepLabel = isBinary ? "Keep anyway" : "Keep";
  const keepAccessibleLabel = isBinary
    ? `Keep ${path} anyway (binary — no text diff)`
    : `Keep ${path}`;

  const decide = useCallback(
    (action: FileDecisionAction) => {
      if (isSubmitting) return;
      setPending(action);
      onDecide(change, action);
    },
    [isSubmitting, onDecide, change],
  );

  return (
    <div
      role="radiogroup"
      aria-label={`Decision for ${path}`}
      aria-describedby={describedById}
      className="flex items-center gap-1.5"
    >
      <VerdictOption
        label={keepLabel}
        accessibleLabel={keepAccessibleLabel}
        tone="keep"
        selected={effective === FileDecisionAction.APPROVE}
        busy={isSubmitting && pending === FileDecisionAction.APPROVE}
        disabled={isSubmitting || keepDisabled}
        onClick={() => decide(FileDecisionAction.APPROVE)}
      />
      <VerdictOption
        label="Discard"
        accessibleLabel={`Discard ${path}`}
        tone="discard"
        selected={effective === FileDecisionAction.REJECT}
        busy={isSubmitting && pending === FileDecisionAction.REJECT}
        disabled={isSubmitting}
        onClick={() => decide(FileDecisionAction.REJECT)}
      />
    </div>
  );
}

interface VerdictOptionProps {
  readonly label: string;
  readonly accessibleLabel: string;
  readonly tone: "keep" | "discard";
  readonly selected: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}

// Quiet at rest (ghost), tinted when selected — the verdict is signalled by both
// fill AND tone (not color alone), and every property flows through `--stgm-*`
// tokens with no opacity modifiers.
const VERDICT_BASE = cn(
  "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1",
  "text-xs font-medium transition-colors",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

const VERDICT_REST = "border-border text-muted-foreground hover:bg-accent-hover hover:text-foreground";

const VERDICT_SELECTED: Record<VerdictOptionProps["tone"], string> = {
  keep: "border-success bg-success-subtle text-success",
  discard: "border-destructive bg-destructive-subtle text-destructive",
};

function VerdictOption({
  label,
  accessibleLabel,
  tone,
  selected,
  busy,
  disabled,
  onClick,
}: VerdictOptionProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={accessibleLabel}
      disabled={disabled}
      onClick={onClick}
      data-cursor-target={`file-review-${tone}`}
      className={cn(VERDICT_BASE, selected ? VERDICT_SELECTED[tone] : VERDICT_REST)}
    >
      {busy ? <SpinnerIcon /> : null}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CaptureBadge — provenance for a file captured outside normal git tracking
// ---------------------------------------------------------------------------

/** Non-default provenance the reviewer should be told about, with its a11y text. */
const PROVENANCE: Partial<Record<FileCaptureClass, { label: string; aria: string }>> = {
  [FileCaptureClass.GIT_IGNORED_CAPTURED]: {
    label: "gitignored",
    aria: "This file is ignored by git; the change was captured for review",
  },
  [FileCaptureClass.NON_GIT_CAS]: {
    label: "outside git",
    aria: "This file is outside the git repository; the change was captured for review",
  },
};

/**
 * A small provenance pill for a file captured outside normal git tracking —
 * gitignored or non-git (CAS). Renders nothing for ordinary git-tracked (or
 * untracked-but-new) files, so the badge appears only when it carries real
 * signal: this change is not part of the repo's tracked history.
 */
function CaptureBadge({ change }: { change: CapturedFileChange }) {
  const provenance = PROVENANCE[change.captureClass];
  if (!provenance) return null;
  return (
    <span
      className="inline-flex w-fit items-center rounded border border-border bg-muted-subtle px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
      aria-label={provenance.aria}
      data-cursor-target="file-review-capture"
    >
      {provenance.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BlockReasonNote — why a file's Keep is unavailable (associated via aria)
// ---------------------------------------------------------------------------

/**
 * The in-place explanation for a non-reviewable file, associated with the verdict
 * control via `aria-describedby`. Honest per {@link fileReviewability}: a `binary`
 * change has no text diff but is keepable-as-bytes (an explicit "Keep anyway"); an
 * `unavailable` change's diff cannot be shown at all and is discard-only, with the
 * specific cause the runner recorded (secret-withheld vs size-dropped, doc 15). A
 * reviewable file renders no note.
 */
function BlockReasonNote({
  reviewability,
  id,
}: {
  reviewability: FileReviewability;
  id: string;
}) {
  const text = blockReasonText(reviewability);
  if (!text) return null;
  return (
    <p
      id={id}
      className="text-[11px] italic text-muted-foreground"
      data-cursor-target="file-review-block-reason"
    >
      {text}
    </p>
  );
}

/** The per-file reason copy for a non-reviewable change (null when reviewable). */
function blockReasonText(reviewability: FileReviewability): string | null {
  switch (reviewability.kind) {
    case "binary":
      return "Binary file — no text diff to review. Keep it as-is (its exact bytes are applied) or discard it.";
    case "unavailable":
      switch (reviewability.reason) {
        case "secret":
          return "Contents withheld — this path looks like a secret, so it was never captured for review and can only be discarded.";
        case "size":
          return "Diff too large to display — the full contents were elided to stay within limits, so this change can only be discarded.";
        default:
          return "The full diff isn't available to review, so this change can only be discarded.";
      }
    default:
      return null;
  }
}

/**
 * The whole-set incompleteness copy, accurate to which non-reviewable classes are
 * present (never the generic "binary or truncated"). Unavailable is reported
 * ahead of binary because it is the stronger "nothing to see" signal.
 *
 * A `binaryOnly` set is the keepable case (DD-17): binary files are the only
 * blocker, so the copy explains that "Keep all" is available rather than saying
 * the set can't be approved. A `blocked` set (something unavailable) keeps the
 * discard-oriented copy.
 */
function incompleteNotice(
  showPerFile: boolean,
  summary: { hasBinary: boolean; hasUnavailable: boolean },
  binaryOnly: boolean,
): string {
  if (binaryOnly) {
    // Every non-binary file is reviewable; only binaries have no text diff.
    return showPerFile
      ? "This set includes binary files with no text diff. Keep all keeps every file as-is (their exact bytes are applied), or decide each file below."
      : "This is a binary change with no text diff. Keep it as-is (its exact bytes are applied) or discard it.";
  }
  if (showPerFile) {
    if (summary.hasUnavailable) {
      return "Part of this change isn't available to review, so the whole set can't be approved — keep the reviewable files and discard the rest.";
    }
    if (summary.hasBinary) {
      return "This set includes a binary change with no text diff, so it can't be approved at once — decide each file below (keep the reviewable ones; keep or discard the binary).";
    }
    return "Some files can't be reviewed completely, so the whole set can't be approved at once — keep the reviewable files and discard the rest.";
  }
  if (summary.hasUnavailable) {
    return "This change isn't available to review, so it can't be approved — it can only be discarded.";
  }
  if (summary.hasBinary) {
    return "This is a binary change with no text diff, so it can't be approved as a complete change — it can only be discarded.";
  }
  return "This change can't be reviewed completely, so it can't be approved as a complete change.";
}

// ---------------------------------------------------------------------------
// ReviewProgress — how many files still need a verdict before the turn resumes
// ---------------------------------------------------------------------------

function ReviewProgress({ decided, total }: { decided: number; total: number }) {
  return (
    <p role="status" className="text-[11px] text-muted-foreground">
      {decided} of {total} files reviewed
      {decided > 0 && decided < total && " — decide the rest to continue"}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Fold the ledger-ordered decisions into each file's current verdict, last
 * write wins (the precedence the runner reconcile applies). Only FILE-scoped
 * decisions are per-file; a CHANGE_SET decision cannot coexist with an
 * AWAITING_REVIEW set, so it is ignored defensively.
 */
function deriveFileVerdicts(
  decisions: readonly FileDecision[],
): Map<string, FileDecisionAction> {
  const byFileId = new Map<string, FileDecisionAction>();
  for (const d of decisions) {
    if (d.scope === FileDecisionScope.FILE && d.fileChangeId) {
      byFileId.set(d.fileChangeId, d.action);
    }
  }
  return byFileId;
}

/**
 * The whole-set action labels, sharpened by file count and review progress. A
 * `binaryOnly` set (DD-17) reads as "Keep all" rather than "Approve all": the
 * bulk keep carries the binary acknowledgment, and "Keep" is the same verb the
 * per-file binary control uses ("Keep anyway").
 */
function bulkLabels(
  total: number,
  decided: number,
  binaryOnly: boolean,
): { approve: string; reject: string } {
  const approveVerb = binaryOnly ? "Keep" : "Approve";
  if (total <= 1) return { approve: approveVerb, reject: "Reject" };
  if (decided > 0 && decided < total) {
    return { approve: `${approveVerb} remaining`, reject: "Reject remaining" };
  }
  return { approve: `${approveVerb} all`, reject: "Reject all" };
}

// ---------------------------------------------------------------------------
// Inline SVG icon
// ---------------------------------------------------------------------------

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
