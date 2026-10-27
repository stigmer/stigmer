"use client";

import { memo, useCallback, useEffect, useId, useMemo, useState } from "react";
import type {
  CapturedFileChange,
  FileChangeSet,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { FileCaptureClass } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { toDisplayFileChange, type FileReviewFile, type FileReviewSet } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { FileChangeDiff } from "./FileChangesView.js";
import { FileKindBadge, FileLineStats } from "./FileReviewAtoms.js";
import { FilePathLink } from "./FilePathLink.js";
import { DiffSummary } from "../version-history/DiffSummary.js";
import { DecisionButton } from "../internal/DecisionButton.js";
import { InCardDecisionError } from "../internal/InCardDecisionError.js";
import {
  fileDecisionKey,
  type FileReviewAction,
  type ReviewFileChangesOptions,
} from "./useReviewFileChanges.js";
import { useChangeSetCapture } from "./useChangeSetCapture.js";
import {
  changeSetReviewability,
  fileChangeKindOf,
  fileReviewability,
  type FileReviewability,
} from "./file-review-status.js";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";

/** A stable empty set so the default `submittingDecisionKeys` keeps a constant ref. */
const NO_KEYS: ReadonlySet<string> = new Set();

/** A stable empty map so the default `decisionErrors` keeps a constant ref. */
const NO_ERRORS: ReadonlyMap<string, Error> = new Map();

/** Props for {@link FileReviewCard}. */
export interface FileReviewCardProps {
  /**
   * The turn's changes and how each file stands, from the session's fold
   * (`Turn.fileReview`). Decisions, verdicts and progress are read from it.
   */
  readonly fileReviewSet: FileReviewSet;
  /**
   * The set's captured bytes (its run's change set), when the caller already
   * holds the run: the diffs and each file's capture provenance render from
   * it. Omitted, the card reads the run itself, and only when it shows diffs.
   */
  readonly capture?: FileChangeSet | null;
  /**
   * Called when the person decides. The consumer (typically the session's
   * dock or a platform builder's surface) sends it via
   * {@link useReviewFileChanges}. A whole-set Keep/Discard sends
   * `"change_set"` scope; a per-file one sends `"file"` scope with the
   * file's id. Optional and ignored when
   * {@link FileReviewCardProps.interactive} is `false`.
   */
  readonly onSubmit?: (action: FileReviewAction, options: ReviewFileChangesOptions) => void;
  /**
   * Whether the card presents decision controls. Defaults to `true` (the live
   * review surface). Set to `false` to render a **settled** set read-only:
   * each file's verdict is shown, but the decision controls and error
   * affordances are omitted — a historical record of what changed and how it
   * was decided, not an actionable gate.
   */
  readonly interactive?: boolean;
  /**
   * Whether the expanded body renders each file's diff. Defaults to `true` —
   * the right default wherever this card is the *only* review surface
   * (standalone platform-builder embeds).
   *
   * `MessageThread` passes `false`: the transcript's stamped edit rows already
   * show every diff in place, so the expanded body collapses to a compact file
   * list (kind letter + linked path + `+N −M` + per-file controls) and the card
   * stays purely the decision surface. Decision semantics — digests, scopes,
   * acknowledgments — are identical in both modes; this is presentation only
   * (opt-in with a backward-compatible default).
   */
  readonly showDiffs?: boolean;
  /**
   * The decision keys currently being submitted — exactly the set
   * {@link useReviewFileChanges} returns as `submittingDecisionKeys`. A card has more
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
   * {@link useReviewFileChanges}'s `decisionErrors`.
   */
  readonly decisionErrors?: ReadonlyMap<string, Error>;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a turn's file changes (`FileReviewSet`) as a **compact
 * decision bar**: one line carrying the set summary and the whole-set
 * decision controls, with the
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
 * individually (Keep / Discard, a `"file"` decision) or act on the whole set
 * at once (Keep / Discard all, a `"change_set"` decision). Kept bytes stay;
 * discarded ones are put back, verified against the digest the person saw.
 *
 * The set stays offered until every file has a verdict, so a partially
 * decided set stays actionable. A per-file verdict is changeable while the
 * set is still open: clicking the other option records a new decision (the
 * last one wins).
 *
 * A `binary-only` set (binary files are the only blocker) can be kept in one
 * action: the bulk button reads "Keep all" and carries the acknowledgment.
 * A `blocked` set (something unavailable to review) cannot be approved
 * as a whole — the Approve button is disabled with an explanation, and the
 * per-file path is the escape: keep the reviewable files and discard the rest.
 *
 * Each non-reviewable file is labeled honestly by {@link fileReviewability}: a
 * `binary` change has no text diff to review; an `unavailable` change is one
 * whose diff isn't available at all (a secret path whose bytes were never
 * captured, or an incomplete diff). Both are discard-only, and their Keep
 * affordance is disabled with the reason associated via `aria-describedby`.
 * Files captured outside normal git tracking (gitignored / non-git CAS) carry
 * a small provenance badge, read from the capture, so the reviewer knows the
 * change is not part of the repo's tracked history.
 *
 * Wrapped in `React.memo` — the session fold keeps an unchanged set's
 * reference, so review cards skip re-renders during unrelated stream updates.
 *
 * @example
 * ```tsx
 * const { reviewFileChanges, submittingDecisionKeys } = useReviewFileChanges();
 * <FileReviewCard
 *   fileReviewSet={set}
 *   onSubmit={(action, opts) => reviewFileChanges(sessionId, set.changeSetId, action, opts)}
 *   submittingDecisionKeys={submittingDecisionKeys}
 * />
 * ```
 */
export const FileReviewCard = memo(function FileReviewCard({
  fileReviewSet,
  capture,
  onSubmit,
  submittingDecisionKeys = NO_KEYS,
  decisionErrors = NO_ERRORS,
  interactive = true,
  showDiffs = true,
  className,
}: FileReviewCardProps) {
  const files = fileReviewSet.files;
  const total = files.length;
  const setId = fileReviewSet.changeSetId;

  // The files decided so far drive the reviewed-count progress and the bulk
  // labels; each file's own state drives its selected option.
  const decidedCount = useMemo(
    () => files.filter((file) => file.state !== "undecided").length,
    [files],
  );

  // The set-level reviewability drives the bulk affordance. A "binary-only" set
  // (binary files are the ONLY blocker) is keepable in one acknowledged action
  // ("Keep all"); a "blocked" set (a secret/elided file with no keepable
  // bytes) can never be kept at once and must be resolved per file.
  const reviewability = changeSetReviewability(fileReviewSet);
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
  // binary uses its per-file "Keep anyway" — and a blocked lone file can
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
  // (a standalone embed), where "Review" is the act of opening it.
  // A settled record always starts collapsed — the transcript's stamped rows
  // already show what changed, and the expander reveals detail on demand.
  const [expanded, setExpanded] = useState(
    () =>
      interactive && (incomplete || decidedCount > 0 || (total > 1 && !showDiffs)),
  );
  const bodyId = useId();

  // The diff bodies need the captured bytes: the caller's, or read from the
  // run once the diffs are on screen.
  const loaded = useChangeSetCapture(
    fileReviewSet.runId,
    setId,
    capture === undefined && showDiffs && expanded,
  );
  const captureSet = capture === undefined ? loaded.capture : capture;
  const capturedById = useMemo(() => {
    const map = new Map<string, CapturedFileChange>();
    for (const change of captureSet?.changes ?? []) map.set(change.id, change);
    return map;
  }, [captureSet]);
  const diffState: DiffState = loaded.error
    ? "error"
    : loaded.isLoading
      ? "loading"
      : "ready";

  const wholeSetSubmitting = submittingDecisionKeys.has(setId);
  const wholeSetError = decisionErrors.get(setId) ?? null;

  // Bulk (whole-set) decision state — mirrors ApprovalCardBody: one active
  // action drives the clicked button's spinner, cleared when the call settles.
  const [activeAction, setActiveAction] = useState<FileReviewAction | null>(null);
  useEffect(() => {
    if (!wholeSetSubmitting) setActiveAction(null);
  }, [wholeSetSubmitting]);

  const handleBulk = useCallback(
    (action: FileReviewAction) => {
      setActiveAction(action);
      // Whole-set decision, bound to the aggregate digest the reviewer saw.
      // A "Keep all" on a binary-only set carries the acknowledgment: the
      // binaries have no text diff but exact bytes, so the person consciously
      // keeps the whole set. The server honors it only when every
      // incompleteness is binary and never relaxes the digest.
      onSubmit?.(action, {
        scope: "change_set",
        expectedDigest: fileReviewSet.aggregateDigest,
        acknowledgeUnreviewable: action === "keep" && binaryOnly,
      });
    },
    [onSubmit, fileReviewSet.aggregateDigest, binaryOnly],
  );

  const handleFileDecide = useCallback(
    (file: FileReviewFile, action: FileReviewAction) => {
      // Per-file decision, bound to that file's digest (echoed verbatim — the
      // server compares it against the same captured value). A "Keep anyway"
      // on a binary file carries the acknowledgment; the server honors it
      // only for a binary file and never relaxes the digest.
      onSubmit?.(action, {
        scope: "file",
        fileChangeId: file.fileChangeId,
        expectedDigest: file.digest,
        acknowledgeUnreviewable: action === "keep" && fileReviewability(file).kind === "binary",
      });
    },
    [onSubmit],
  );

  // The set's aggregate `+N −M`, summed from the capture-time per-file
  // counts. A file with no counts (binary, secret-withheld) contributes zero;
  // when NO file has counts the aggregate is hidden rather than shown as a
  // dishonest "+0 −0".
  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const file of files) {
      additions += file.linesAdded;
      deletions += file.linesRemoved;
    }
    return { additions, deletions };
  }, [files]);

  // Which non-reviewable classes are present in the set — folded once so the
  // blocked-set copy is accurate to what's actually here.
  const blockSummary = useMemo(() => {
    let hasBinary = false;
    let hasUnavailable = false;
    for (const file of files) {
      const r = fileReviewability(file);
      if (r.kind === "binary") hasBinary = true;
      else if (r.kind === "unavailable") hasUnavailable = true;
    }
    return { hasBinary, hasUnavailable };
  }, [files]);

  // Associates the disabled whole-set Approve with the notice explaining why it
  // is unavailable (a11y: a disabled action is never an unexplained dead end).
  const incompleteNoticeId = useId();

  const labels = bulkLabels(total, decidedCount, binaryOnly);
  // A set a policy kept (every change produced by a command the person
  // already approved) says so explicitly: consent was given at the command
  // gate, and the record must never read as if a person reviewed it here.
  // An eval run's try keeps its edits by policy too; nobody reviews a try.
  const autoKept = interactive ? undefined : policyKeepOf(fileReviewSet);
  const summary = interactive
    ? `${total} file${total === 1 ? "" : "s"} awaiting review`
    : autoKept === "approved_command"
      ? "Kept automatically — produced by a command you approved"
      : autoKept === "eval_try"
        ? "Kept automatically — an eval's try keeps its edits"
        : settledSummary(files);

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
        "stg:rounded-lg stg:border stg:border-border-prominent",
        interactive && "stg:border-l-2 stg:border-l-warning",
        className,
      )}
    >
      {/* The bar: summary + whole-set verdict + the detail expander, one line. */}
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-xs">
        <span className="stg:shrink-0 stg:font-medium stg:text-foreground">
          {interactive ? "Review file changes" : "File changes"}
        </span>
        {/* The flexible middle: the summary (truncating) plus the set's
            aggregate +N −M, visible even while collapsed so the bar carries
            the magnitude of what is being decided, not just the file count.
            Hidden when no file has counts (FileLineStats). */}
        <span className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2">
          <span className="stg:min-w-0 stg:truncate stg:text-muted-foreground">{summary}</span>
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
              onClick={() => handleBulk("keep")}
              isActive={activeAction === "keep"}
              isSubmitting={wholeSetSubmitting}
              disabled={incomplete && !binaryOnly}
              ariaDescribedby={incomplete ? incompleteNoticeId : undefined}
              cursorTarget="file-review-approve"
            />
            <DecisionButton
              label={labels.reject}
              variant="danger"
              onClick={() => handleBulk("undo")}
              isActive={activeAction === "undo"}
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
            "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-1 stg:rounded-md stg:border stg:border-border stg:px-2 stg:py-1",
            "stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors",
            "stg:hover:bg-accent-hover stg:hover:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
          className="stg:px-2.5 stg:pb-1.5 stg:text-2xs stg:italic stg:text-muted-foreground"
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
        <div className="stg:px-2.5 stg:pb-1.5">
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
          className="stg:space-y-2 stg:border-t stg:border-border-muted stg:px-3 stg:py-2.5"
        >
          {/* The list body carries no summary header: the bar already shows
              the file count and the aggregate +N −M (per-file counts ride the
              session's events, so no read is ever needed to decorate the
              list). Diff mode keeps its fuller DiffSummary line above the
              rendered diffs. */}
          {showDiffs && (
            <DiffSummary
              fileCount={total}
              additions={totals.additions}
              deletions={totals.deletions}
            />
          )}

          {!interactive
            ? // Settled: every file paired with its verdict, no controls — a
              // record of what changed and how it was decided.
              files.map((file) => (
                <SettledFileRow
                  key={file.fileChangeId}
                  file={file}
                  captured={capturedById.get(file.fileChangeId)}
                  diffState={diffState}
                  showDiffs={showDiffs}
                />
              ))
            : showPerFile
              ? files.map((file) => (
                  <FileChangeReviewRow
                    key={file.fileChangeId}
                    file={file}
                    captured={capturedById.get(file.fileChangeId)}
                    diffState={diffState}
                    isSubmitting={
                      submittingDecisionKeys.has(fileDecisionKey(setId, file.fileChangeId)) ||
                      wholeSetSubmitting
                    }
                    error={decisionErrors.get(fileDecisionKey(setId, file.fileChangeId)) ?? null}
                    onDecide={handleFileDecide}
                    showDiffs={showDiffs}
                  />
                ))
              : // A single complete file decided via the bar's bulk controls:
                // its detail is informational, with no per-file control.
                files.map((file) =>
                  showDiffs ? (
                    <div key={file.fileChangeId} className="stg:space-y-1.5">
                      <CaptureBadge captured={capturedById.get(file.fileChangeId)} />
                      <CapturedChangeDiff
                        captured={capturedById.get(file.fileChangeId)}
                        diffState={diffState}
                      />
                    </div>
                  ) : (
                    <FileListRow
                      key={file.fileChangeId}
                      file={file}
                      captured={capturedById.get(file.fileChangeId)}
                    />
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
 * The policy that kept the set, when one did: the approved-command auto-keep
 * (`approved_command`) or an eval run's try (`eval_try`). The decision's
 * origin is audit provenance — the record label derives from it so an
 * automatic keep is never presented as a person's review.
 */
function policyKeepOf(set: FileReviewSet): "approved_command" | "eval_try" | undefined {
  for (const decision of set.decisions) {
    if (decision.origin === "approved_command" || decision.origin === "eval_try") {
      return decision.origin;
    }
  }
  return undefined;
}

/**
 * The settled bar's one-line history: verdict counts ("2 kept · 1
 * discarded"), with an honest bucket for an undo that failed and one for
 * files never decided. Falls back to a plain changed-count when nothing was
 * decided at all.
 */
function settledSummary(files: readonly FileReviewFile[]): string {
  const total = files.length;
  let kept = 0;
  let discarded = 0;
  let failed = 0;
  for (const file of files) {
    if (file.state === "kept") kept++;
    else if (file.state === "undone" || file.state === "undoing") discarded++;
    else if (file.state === "undo_failed") failed++;
  }
  const undecided = total - kept - discarded - failed;
  if (undecided === total) {
    return `${total} file${total === 1 ? "" : "s"} changed`;
  }
  const parts: string[] = [];
  if (kept > 0) parts.push(`${kept} kept`);
  if (discarded > 0) parts.push(`${discarded} discarded`);
  if (failed > 0) parts.push(`${failed} could not be put back`);
  if (undecided > 0) parts.push(`${undecided} not reviewed`);
  return parts.join(" · ");
}

/** Whether a row's diff body is loading, failed to load, or ready (shown or absent). */
type DiffState = "loading" | "error" | "ready";

/** A file's verdict as the per-file control reads it: kept, undone, or not yet decided. */
function verdictOf(file: FileReviewFile): FileReviewAction | null {
  switch (file.state) {
    case "kept":
      return "keep";
    case "undecided":
      return null;
    default:
      return "undo";
  }
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
        "stg:shrink-0 stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
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
  readonly file: FileReviewFile;
  /** The file's captured bytes, when loaded (diff mode). */
  readonly captured: CapturedFileChange | undefined;
  readonly diffState: DiffState;
  /** True while THIS file's decision (or a whole-set decision) is in flight. */
  readonly isSubmitting: boolean;
  /** This file's last failed decision, or null — surfaced beside its control. */
  readonly error: Error | null;
  readonly onDecide: (file: FileReviewFile, action: FileReviewAction) => void;
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
  file,
  captured,
  diffState,
  isSubmitting,
  error,
  onDecide,
  showDiffs,
}: FileChangeReviewRowProps) {
  // One classification per file drives BOTH the disabled Keep and its reason,
  // so the two can never disagree (single source of truth).
  const reviewability = fileReviewability(file);
  const blocked = reviewability.kind !== "reviewable";
  const reasonId = useId();
  const verdictControl = (
    <FileVerdictControl
      file={file}
      reviewability={reviewability}
      verdict={verdictOf(file)}
      isSubmitting={isSubmitting}
      onDecide={onDecide}
      describedById={blocked ? reasonId : undefined}
    />
  );
  return (
    <div className="stg:space-y-1.5">
      {showDiffs ? (
        <>
          <CaptureBadge captured={captured} />
          <CapturedChangeDiff captured={captured} diffState={diffState} />
          {verdictControl}
        </>
      ) : (
        <FileListRow file={file} captured={captured} trailing={verdictControl} />
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
// SettledFileRow — one file paired with its verdict (read-only)
// ---------------------------------------------------------------------------

interface SettledFileRowProps {
  readonly file: FileReviewFile;
  readonly captured: CapturedFileChange | undefined;
  readonly diffState: DiffState;
  /** Diff-rich body vs compact list line — see {@link FileReviewCardProps.showDiffs}. */
  readonly showDiffs: boolean;
}

/**
 * A read-only file row for a settled set: the capture provenance badge and a
 * static verdict badge, with the before/after diff in diff mode or the
 * compact list line otherwise. No decision controls — the verdict is history,
 * not an action.
 */
const SettledFileRow = memo(function SettledFileRow({
  file,
  captured,
  diffState,
  showDiffs,
}: SettledFileRowProps) {
  if (!showDiffs) {
    return (
      <FileListRow file={file} captured={captured} trailing={<VerdictBadge state={file.state} />} />
    );
  }
  return (
    <div className="stg:space-y-1.5">
      <div className="stg:flex stg:items-center stg:gap-2">
        <CaptureBadge captured={captured} />
        <VerdictBadge state={file.state} />
      </div>
      <CapturedChangeDiff captured={captured} diffState={diffState} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// CapturedChangeDiff — a captured change's bounded diff (showDiffs mode)
// ---------------------------------------------------------------------------

/**
 * Projects a {@link CapturedFileChange} onto the display `FileChange` and
 * renders its bounded diff — the one place the diff body renders, shared by
 * the interactive, settled, and single-file branches of the diff-mode body.
 * While the run's bytes load it says so; a failed read or a file the run does
 * not hold renders a short notice instead of a diff.
 */
function CapturedChangeDiff({
  captured,
  diffState,
}: {
  readonly captured: CapturedFileChange | undefined;
  readonly diffState: DiffState;
}) {
  const adapted = useMemo(
    () => (captured ? toDisplayFileChange(captured) : null),
    [captured],
  );
  if (adapted) return <FileChangeDiff change={adapted} bounded />;
  return (
    <p className="stg:text-2xs stg:italic stg:text-muted-foreground">
      {diffState === "loading"
        ? "Loading the diff…"
        : diffState === "error"
          ? "Couldn't load the diff."
          : "The diff isn't available."}
    </p>
  );
}

// ---------------------------------------------------------------------------
// FileListRow — one file as a compact list line (list mode)
// ---------------------------------------------------------------------------

/**
 * One file of the set as a compact list line: kind letter, linked path,
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
  file,
  captured,
  trailing,
}: {
  readonly file: FileReviewFile;
  readonly captured: CapturedFileChange | undefined;
  readonly trailing?: React.ReactNode;
}) {
  const renamedFrom =
    file.change === "renamed" && file.previousPath !== file.path ? file.previousPath : "";
  return (
    <div
      className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1"
      data-cursor-target="file-review-list-row"
    >
      <FileKindBadge kind={fileChangeKindOf(file.change)} />
      {renamedFrom && (
        <span className="stg:min-w-0 stg:truncate stg:font-mono stg:text-xs stg:text-muted-foreground-faint">
          {renamedFrom}&nbsp;→&nbsp;
        </span>
      )}
      <FilePathLink path={file.path} dirDisplay="dim" className="stg:min-w-0 stg:flex-1 stg:text-xs" />
      <FileLineStats
        linesAdded={file.linesAdded}
        linesRemoved={file.linesRemoved}
      />
      <CaptureBadge captured={captured} />
      {trailing}
    </div>
  );
}

/**
 * A file's verdict as a static badge: kept reads "Kept", an undo reads
 * "Discarded" (put back, or being put back), a failed undo reads "Undo
 * failed", and an undecided file reads "Not reviewed". Uses the diff
 * add/remove tokens the card uses elsewhere, so it introduces no new token.
 */
function VerdictBadge({ state }: { state: FileReviewFile["state"] }) {
  switch (state) {
    case "kept":
      return (
        <span className="stg:shrink-0 stg:text-2xs stg:font-medium stg:text-diff-added-fg">Kept</span>
      );
    case "undoing":
    case "undone":
      return (
        <span className="stg:shrink-0 stg:text-2xs stg:font-medium stg:text-diff-removed-fg">
          Discarded
        </span>
      );
    case "undo_failed":
      return (
        <span className="stg:shrink-0 stg:text-2xs stg:font-medium stg:text-destructive">
          Undo failed
        </span>
      );
    case "undecided":
      return (
        <span className="stg:shrink-0 stg:text-2xs stg:italic stg:text-muted-foreground">
          Not reviewed
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// FileVerdictControl — a Keep|Discard segmented control for one file
// ---------------------------------------------------------------------------

interface FileVerdictControlProps {
  readonly file: FileReviewFile;
  /** The file's reviewability — `Keep` is available only when `reviewable`. */
  readonly reviewability: FileReviewability;
  readonly verdict: FileReviewAction | null;
  readonly isSubmitting: boolean;
  readonly onDecide: (file: FileReviewFile, action: FileReviewAction) => void;
  /** Id of the reason note describing why `Keep` is unavailable (a11y). */
  readonly describedById?: string;
}

/**
 * The per-file decision affordance: a two-option segmented control modeled as a
 * `radiogroup` (the established idiom across the SDK — Keep XOR Discard is a
 * persistent, mutually-exclusive choice because the card stays visible after
 * each file decision). The committed verdict reads as `aria-checked`; clicking
 * the other option flips it (a new decision; the last one wins).
 *
 * `Keep` behavior by reviewability: a `reviewable` file keeps normally; a
 * `binary` file has no text diff but exact bytes, so `Keep` is enabled as an
 * explicit "Keep anyway" that carries the acknowledgment; an `unavailable`
 * file has no keepable bytes, so `Keep` stays disabled — it can only be
 * discarded. `describedById` associates the group with the note explaining
 * the binary/unavailable case.
 */
function FileVerdictControl({
  file,
  reviewability,
  verdict,
  isSubmitting,
  onDecide,
  describedById,
}: FileVerdictControlProps) {
  // Optimistic: show the clicked option immediately; the session's events
  // then confirm it (or, on failure, it reverts to `verdict`).
  const [pending, setPending] = useState<FileReviewAction | null>(null);
  useEffect(() => {
    if (!isSubmitting) setPending(null);
  }, [isSubmitting]);

  const effective = pending ?? verdict;
  const path = file.path;
  // A binary file is keepable via an explicit acknowledgment; only a truly
  // unavailable diff (no captured bytes) leaves Keep disabled.
  const isBinary = reviewability.kind === "binary";
  const keepDisabled = reviewability.kind === "unavailable";
  const keepLabel = isBinary ? "Keep anyway" : "Keep";
  const keepAccessibleLabel = isBinary
    ? `Keep ${path} anyway (binary — no text diff)`
    : `Keep ${path}`;

  const decide = useCallback(
    (action: FileReviewAction) => {
      if (isSubmitting) return;
      setPending(action);
      onDecide(file, action);
    },
    [isSubmitting, onDecide, file],
  );

  return (
    <div
      role="radiogroup"
      aria-label={`Decision for ${path}`}
      aria-describedby={describedById}
      className="stg:flex stg:items-center stg:gap-1.5"
    >
      <VerdictOption
        label={keepLabel}
        accessibleLabel={keepAccessibleLabel}
        tone="keep"
        selected={effective === "keep"}
        busy={isSubmitting && pending === "keep"}
        disabled={isSubmitting || keepDisabled}
        onClick={() => decide("keep")}
      />
      <VerdictOption
        label="Discard"
        accessibleLabel={`Discard ${path}`}
        tone="discard"
        selected={effective === "undo"}
        busy={isSubmitting && pending === "undo"}
        disabled={isSubmitting}
        onClick={() => decide("undo")}
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
  "stg:inline-flex stg:items-center stg:justify-center stg:gap-1.5 stg:rounded-md stg:border stg:px-2.5 stg:py-1",
  "stg:text-xs stg:font-medium stg:transition-colors",
  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:ring-offset-2",
  "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
);

const VERDICT_REST = "stg:border-border stg:text-muted-foreground stg:hover:bg-accent-hover stg:hover:text-foreground";

const VERDICT_SELECTED: Record<VerdictOptionProps["tone"], string> = {
  keep: "stg:border-success stg:bg-success-subtle stg:text-success",
  discard: "stg:border-destructive stg:bg-destructive-subtle stg:text-destructive",
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
 * gitignored or non-git (CAS), read from the run's capture. Renders nothing
 * for ordinary git-tracked (or untracked-but-new) files, or while the capture
 * is not loaded, so the badge appears only when it carries real signal: this
 * change is not part of the repo's tracked history.
 */
function CaptureBadge({ captured }: { captured: CapturedFileChange | undefined }) {
  if (!captured) return null;
  const provenance = PROVENANCE[captured.captureClass];
  if (!provenance) return null;
  return (
    <span
      className="stg:inline-flex stg:w-fit stg:items-center stg:rounded stg:border stg:border-border stg:bg-muted-subtle stg:px-1.5 stg:py-0.5 stg:text-2xs stg:font-medium stg:text-muted-foreground"
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
 * specific cause the runner recorded (secret-withheld vs size-dropped). A
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
      className="stg:text-2xs stg:italic stg:text-muted-foreground"
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
      return reviewability.reason === "secret"
        ? "Contents withheld — this path looks like a secret, so it was never captured for review and can only be discarded."
        : "The full diff isn't available to review (it was too large or could not be captured), so this change can only be discarded.";
    default:
      return null;
  }
}

/**
 * The whole-set incompleteness copy, accurate to which non-reviewable classes are
 * present (never the generic "binary or truncated"). Unavailable is reported
 * ahead of binary because it is the stronger "nothing to see" signal.
 *
 * A `binaryOnly` set is the keepable case: binary files are the only
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
    <p role="status" className="stg:text-2xs stg:text-muted-foreground">
      {decided} of {total} files reviewed
      {decided > 0 && decided < total && " — decide the rest to continue"}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The whole-set action labels, sharpened by file count and review progress. A
 * `binaryOnly` set reads as "Keep all" rather than "Approve all": the bulk
 * keep carries the binary acknowledgment, and "Keep" is the same verb the
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

