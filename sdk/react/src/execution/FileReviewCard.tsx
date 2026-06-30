"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type {
  CapturedFileChange,
  FileChangeSet,
  FileDecision,
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
import { fileDecisionKey, type FileDecisionOptions } from "./useFileReview";

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
   * a per-file Keep/Discard sends `FILE` scope with the file's id.
   */
  readonly onSubmit: (action: FileDecisionAction, options?: FileDecisionOptions) => void;
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
 * Renders a captured {@link FileChangeSet} for review: a summary bar, the
 * per-file before/after diffs (reusing {@link FileChangeDiff}), and the
 * decision controls.
 *
 * File edits are reviewed as a captured workspace delta, not tool calls, so this
 * is a dedicated review surface distinct from the message transcript and the
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
 * An incomplete diff (`diff_completeness != COMPLETE`) cannot be approved as a
 * whole set — the Approve button is disabled with an explanation. For a
 * multi-file set the per-file path is the escape: keep the reviewable files and
 * discard the binary/truncated one.
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

  // Per-file controls only earn their space when there is more than one file: a
  // single-file set IS the whole set, decided once via the bulk footer.
  const showPerFile = total > 1;

  // A non-COMPLETE diff (elided / binary-only / partial) can never be approved
  // as a whole set — the structural guard against approving an unreviewable set.
  const incomplete = fileChangeSet.diffCompleteness !== DiffCompleteness.COMPLETE;

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
      onSubmit(action, {
        scope: FileDecisionScope.CHANGE_SET,
        expectedDigest: fileChangeSet.aggregateDigest,
      });
    },
    [onSubmit, fileChangeSet.aggregateDigest],
  );

  const handleFileDecide = useCallback(
    (change: CapturedFileChange, action: FileDecisionAction) => {
      // Per-file decision: FILE scope correlated by the change id, bound to that
      // file's digest (echoed verbatim — the server compares it against the same
      // captured value, so it can never spuriously mismatch).
      onSubmit(action, {
        scope: FileDecisionScope.FILE,
        fileChangeId: change.id,
        expectedDigest: change.fileDigest,
      });
    },
    [onSubmit],
  );

  const totals = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const c of changes) {
      if (c.kind === FileChangeKind.ADD) additions += 1;
      else if (c.kind === FileChangeKind.DELETE) deletions += 1;
    }
    return { additions, deletions };
  }, [changes]);

  const labels = bulkLabels(total, decidedCount);

  return (
    <div
      role="alert"
      aria-label={`Review ${total} file change${total === 1 ? "" : "s"}`}
      className={cn(
        "rounded-lg border border-border-prominent border-l-2 border-l-warning",
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-border-muted px-2.5 py-1.5 text-xs">
        <span className="shrink-0 font-medium text-foreground">Review file changes</span>
        <span className="text-muted-foreground">
          {total} file{total === 1 ? "" : "s"} awaiting review
        </span>
      </div>

      <div className="space-y-2 px-3 py-2.5">
        <DiffSummary
          fileCount={total}
          additions={totals.additions}
          deletions={totals.deletions}
        />

        {showPerFile
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
              />
            ))
          : changes.map((change) => (
              <FileChangeDiff key={change.id} change={toFileChange(change)} bounded />
            ))}

        {showPerFile && <ReviewProgress decided={decidedCount} total={total} />}

        {incomplete && (
          <p className="text-[11px] italic text-muted-foreground">
            {showPerFile
              ? "Some files can't be reviewed completely (binary or truncated), so the whole set can't be approved at once — keep the reviewable files and discard the rest."
              : "This change can't be reviewed completely (a file is binary or the diff was truncated), so it can't be approved as a complete change."}
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <DecisionButton
            label={labels.approve}
            variant="primary"
            onClick={() => handleBulk(FileDecisionAction.APPROVE)}
            isActive={activeAction === FileDecisionAction.APPROVE}
            isSubmitting={wholeSetSubmitting}
            disabled={incomplete}
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
        </div>

        {/* A failed whole-set decision is surfaced HERE, in-card, not via the
            session's global error banner. A file-review card has many decision
            targets (the whole set plus each file), so a failure must name the
            control it belongs to — something a single global banner cannot do.
            (The tool-approval ApprovalCard still uses the banner today; both
            converge on in-card surfacing — see the ApprovalCard follow-up.) */}
        {wholeSetError && <DecisionError error={wholeSetError} target="set" />}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// FileChangeReviewRow — one file's diff paired with its Keep/Discard verdict
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
}

const FileChangeReviewRow = memo(function FileChangeReviewRow({
  change,
  verdict,
  isSubmitting,
  error,
  onDecide,
}: FileChangeReviewRowProps) {
  const adapted = useMemo(() => toFileChange(change), [change]);
  return (
    <div className="space-y-1.5">
      <FileChangeDiff change={adapted} bounded />
      <FileVerdictControl
        change={change}
        verdict={verdict}
        isSubmitting={isSubmitting}
        onDecide={onDecide}
      />
      {error && <DecisionError error={error} target="file" />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// FileVerdictControl — a Keep|Discard segmented control for one file
// ---------------------------------------------------------------------------

interface FileVerdictControlProps {
  readonly change: CapturedFileChange;
  readonly verdict: FileDecisionAction | null;
  readonly isSubmitting: boolean;
  readonly onDecide: (change: CapturedFileChange, action: FileDecisionAction) => void;
}

/**
 * The per-file decision affordance: a two-option segmented control modeled as a
 * `radiogroup` (the established idiom across the SDK — Keep XOR Discard is a
 * persistent, mutually-exclusive choice because the card stays visible after
 * each file decision). The committed verdict reads as `aria-checked`; clicking
 * the other option flips it (a new last-write-wins decision).
 *
 * `Keep` is disabled when the file's diff is incomplete — an unreviewable file
 * can never be approved; it can only be discarded.
 */
function FileVerdictControl({
  change,
  verdict,
  isSubmitting,
  onDecide,
}: FileVerdictControlProps) {
  // Optimistic: show the clicked option immediately; the server's decisions
  // projection then confirms it (or, on failure, it reverts to `verdict`).
  const [pending, setPending] = useState<FileDecisionAction | null>(null);
  useEffect(() => {
    if (!isSubmitting) setPending(null);
  }, [isSubmitting]);

  const effective = pending ?? verdict;
  const path = change.pathAfter || change.pathBefore;
  const keepUnavailable = !change.diffComplete;

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
      className="flex items-center gap-1.5"
    >
      <VerdictOption
        label="Keep"
        accessibleLabel={`Keep ${path}`}
        tone="keep"
        selected={effective === FileDecisionAction.APPROVE}
        busy={isSubmitting && pending === FileDecisionAction.APPROVE}
        disabled={isSubmitting || keepUnavailable}
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
// DecisionError — a failed decision surfaced beside the control that failed
// ---------------------------------------------------------------------------

/**
 * The in-card failure notice for a decision that did not take. `role="alert"`
 * (matching the thread's other inline failures) announces it the moment it
 * appears, since it is a dynamic reaction to the reviewer's action — the
 * optimistic verdict has already reverted, and this explains why. The server
 * message is shown verbatim because it is the actionable part (e.g. a digest
 * mismatch means the captured content moved on); the lead-in stays short.
 */
function DecisionError({ error, target }: { error: Error; target: "set" | "file" }) {
  return (
    <p
      role="alert"
      className="text-[11px] text-destructive"
      data-cursor-target={target === "set" ? "file-review-error" : "file-review-file-error"}
    >
      Couldn&rsquo;t {target === "set" ? "submit decision" : "save"} — {error.message}
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

/** The whole-set action labels, sharpened by file count and review progress. */
function bulkLabels(
  total: number,
  decided: number,
): { approve: string; reject: string } {
  if (total <= 1) return { approve: "Approve", reject: "Reject" };
  if (decided > 0 && decided < total) {
    return { approve: "Approve remaining", reject: "Reject remaining" };
  }
  return { approve: "Approve all", reject: "Reject all" };
}

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
