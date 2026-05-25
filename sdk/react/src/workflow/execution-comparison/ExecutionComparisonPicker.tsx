"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { useWorkflowExecutionList } from "../useWorkflowExecutionList";
import { WorkflowExecutionPhaseBadge } from "../WorkflowExecutionPhaseBadge";
import { formatDuration } from "../format-utils";

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
        "stgm m-auto max-h-[70vh] w-full max-w-md rounded-lg border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-background,#fff)] p-0 shadow-xl",
        "backdrop:bg-black/40",
      )}
      onClick={handleBackdropClick}
      aria-label="Select execution to compare"
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--stgm-border,#e5e5e5)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)]">
            Compare with...
          </span>
          <button
            type="button"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {/* Execution list */}
        <div className="max-h-[50vh] overflow-y-auto p-2" role="listbox" aria-label="Recent executions">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--stgm-muted-foreground,#737373)]">
              Loading executions...
            </div>
          )}
          {!isLoading && candidates.length === 0 && (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--stgm-muted-foreground,#737373)]">
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
                  "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  isSelected
                    ? "bg-[var(--stgm-primary,#4f46e5)]/10 ring-1 ring-[var(--stgm-primary,#4f46e5)]"
                    : "hover:bg-[var(--stgm-muted,#f5f5f5)]",
                )}
              >
                <WorkflowExecutionPhaseBadge phase={phase} />
                <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                  <span className="truncate text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)]">
                    {name}
                  </span>
                  <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
                    {startedAt ? formatRelative(startedAt) : "—"}
                    {durationMs != null && ` · ${formatDuration(durationMs)}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--stgm-border,#e5e5e5)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedId}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium",
              selectedId
                ? "bg-[var(--stgm-primary,#4f46e5)] text-[var(--stgm-primary-foreground,#fff)] hover:bg-[var(--stgm-primary,#4f46e5)]/90"
                : "cursor-not-allowed bg-[var(--stgm-muted,#f5f5f5)] text-[var(--stgm-muted-foreground,#737373)]",
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

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
