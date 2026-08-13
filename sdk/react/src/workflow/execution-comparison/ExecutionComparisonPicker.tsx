"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { useWorkflowExecutionList } from "../useWorkflowExecutionList.js";
import { WorkflowExecutionPhaseBadge } from "../WorkflowExecutionPhaseBadge.js";
import { formatDuration } from "../format-utils.js";
import { formatRelativeTime } from "../../activity/format-relative-time.js";

/** Props for {@link ExecutionComparisonPicker}. */
export interface ExecutionComparisonPickerProps {
  /** Whether the picker dialog is open. */
  readonly open: boolean;
  /** Workflow ID to scope execution list. */
  readonly workflowId: string;
  /** The base execution ID (already selected, shown as context). */
  readonly baseExecutionId: string;
  /** The phase of the base execution (used for smart pre-selection). */
  readonly basePhase: ExecutionPhase;
  /** Called when the user confirms a comparison target. */
  readonly onConfirm: (compareExecutionId: string) => void;
  /** Called when the dialog is dismissed. */
  readonly onClose: () => void;
}

const TERMINAL_PHASES = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

/**
 * Dialog for selecting an execution to compare against.
 *
 * Shows recent executions of the same workflow, sorted by start time
 * (newest first). Pre-selects the most recent execution with a different
 * phase from the base (e.g., if base is FAILED, pre-selects last COMPLETED).
 *
 * Uses native `<dialog>` for accessibility and focus trapping.
 */
export const ExecutionComparisonPicker = memo(function ExecutionComparisonPicker({
  open,
  workflowId,
  baseExecutionId,
  basePhase,
  onConfirm,
  onClose,
}: ExecutionComparisonPickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { executions, isLoading } = useWorkflowExecutionList({
    workflowId,
    pageSize: 20,
  });

  const candidates = useMemo(
    () =>
      executions.filter(
        (e) =>
          e.metadata?.id !== baseExecutionId &&
          TERMINAL_PHASES.has(e.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED),
      ),
    [executions, baseExecutionId],
  );

  useEffect(() => {
    if (!open || candidates.length === 0) return;
    if (selectedId) return;

    const preferredPhase =
      basePhase === ExecutionPhase.EXECUTION_FAILED
        ? ExecutionPhase.EXECUTION_COMPLETED
        : ExecutionPhase.EXECUTION_FAILED;

    const preferred = candidates.find(
      (e) => e.status?.phase === preferredPhase,
    );
    const fallback = candidates[0];
    setSelectedId((preferred ?? fallback)?.metadata?.id ?? null);
  }, [open, candidates, selectedId, basePhase]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  useEffect(() => {
    if (!open) setSelectedId(null);
  }, [open]);

  const handleConfirm = useCallback(() => {
    if (selectedId) onConfirm(selectedId);
  }, [selectedId, onConfirm]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) onClose();
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "stgm stg:m-auto stg:max-h-[70vh] stg:w-full stg:max-w-md stg:rounded-lg stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-background,#fff)] stg:p-0 stg:shadow-xl",
        "stg:backdrop:bg-backdrop",
      )}
      onClick={handleBackdropClick}
      aria-label="Select execution to compare"
    >
      <div className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:px-4 stg:py-3">
          <span className="stg:text-sm stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)]">
            Compare with...
          </span>
          <button
            type="button"
            onClick={onClose}
            className="stg:flex stg:h-6 stg:w-6 stg:items-center stg:justify-center stg:rounded stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Execution list */}
        <div className="stg:max-h-[50vh] stg:overflow-y-auto stg:p-2" role="listbox" aria-label="Recent executions">
          {isLoading && (
            <div className="stg:flex stg:items-center stg:justify-center stg:py-8 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
              Loading executions...
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <div className="stg:flex stg:items-center stg:justify-center stg:py-8 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
              No other completed executions found.
            </div>
          )}
          {candidates.map((exec) => {
            const id = exec.metadata?.id ?? "";
            const name = exec.metadata?.name || exec.metadata?.slug || id;
            const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
            const startedAt = exec.status?.startedAt;
            const completedAt = exec.status?.completedAt;
            const durationMs = getDurationMs(startedAt, completedAt);
            const isSelected = id === selectedId;

            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => setSelectedId(id)}
                className={cn(
                  "stg:flex stg:w-full stg:items-center stg:gap-3 stg:rounded-md stg:px-3 stg:py-2 stg:text-left stg:text-sm stg:transition-colors",
                  isSelected
                    ? "stg:bg-[var(--stgm-primary,#4f46e5)]/10 stg:ring-1 stg:ring-[var(--stgm-primary,#4f46e5)]"
                    : "stg:hover:bg-[var(--stgm-muted,#f5f5f5)]",
                )}
              >
                <WorkflowExecutionPhaseBadge phase={phase} />
                <div className="stg:flex stg:flex-1 stg:flex-col stg:gap-0.5 stg:overflow-hidden">
                  <span className="stg:truncate stg:text-xs stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
                    {name}
                  </span>
                  <span className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
                    {startedAt ? formatStartedAt(startedAt) : "—"}
                    {durationMs != null && ` · ${formatDuration(durationMs)}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="stg:flex stg:items-center stg:justify-end stg:gap-2 stg:border-t stg:border-[var(--stgm-border,#e5e5e5)] stg:px-4 stg:py-3">
          <button
            type="button"
            onClick={onClose}
            className="stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
              selectedId
                ? "stg:bg-[var(--stgm-primary,#4f46e5)] stg:text-[var(--stgm-primary-foreground,#fff)] stg:hover:bg-[var(--stgm-primary,#4f46e5)]/90"
                : "stg:cursor-not-allowed stg:bg-[var(--stgm-muted,#f5f5f5)] stg:text-[var(--stgm-muted-foreground,#737373)]",
            )}
          >
            Compare
          </button>
        </div>
      </div>
    </dialog>
  );
});

function getDurationMs(startedAt: string | undefined, completedAt: string | undefined): number | null {
  if (!startedAt || !completedAt) return null;
  const s = new Date(startedAt).getTime();
  const e = new Date(completedAt).getTime();
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  return e - s;
}

/** ISO wire value → the shared compact stamp; unparseable renders as absent. */
function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : formatRelativeTime(date);
}
