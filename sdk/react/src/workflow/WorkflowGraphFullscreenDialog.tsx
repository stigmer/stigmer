"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowOverviewGraph } from "./WorkflowOverviewGraph.js";

/** Props for {@link WorkflowGraphFullscreenDialog}. */
export interface WorkflowGraphFullscreenDialogProps {
  /** The workflow blueprint to visualize. */
  readonly workflow: Workflow | null | undefined;
  /** Controls dialog visibility. `true` opens via `showModal()`. */
  readonly open: boolean;
  /** Called when the dialog should close (Escape key or close button). */
  readonly onClose: () => void;
  /**
   * Called when the user clicks "Open in editor" from the node popover.
   * Receives the task name so the caller can activate the editor tab.
   */
  readonly onOpenInEditor?: (taskName: string) => void;
}

/**
 * Near-full-viewport dialog for exploring the workflow task flow graph.
 *
 * Uses native `<dialog>` with `showModal()` for built-in focus trapping,
 * Escape key handling, and backdrop — matching the pattern established by
 * `ArtifactPreviewModal` and `ConfirmDialog`.
 *
 * Mounts a fresh `WorkflowOverviewGraph` instance when open, which
 * auto-fits to the larger viewport via its internal `fitView` effect.
 * Pan, zoom, minimap, and node-click inspection all work identically
 * to the inline overview graph.
 */
export function WorkflowGraphFullscreenDialog({
  workflow,
  open,
  onClose,
  onOpenInEditor,
}: WorkflowGraphFullscreenDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const handleCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onClose();
    },
    [onClose],
  );

  const workflowName = workflow?.metadata?.name || "Task Flow";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      aria-label={`${workflowName} — full view`}
      className={cn(
        "fixed inset-0 z-50 m-auto h-[90vh] w-[95vw] rounded-lg border border-border bg-background p-0 text-foreground shadow-2xl outline-none",
        "[&::backdrop]:bg-black/60",
      )}
    >
      {open && (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {workflowName}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close full view"
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground",
                "hover:bg-accent-hover hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-colors",
              )}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <WorkflowOverviewGraph
              workflow={workflow}
              onOpenInEditor={onOpenInEditor}
              nodesDraggable
              className="h-full w-full bg-[var(--stgm-muted-subtle,#fafafa)]"
            />
          </div>
        </div>
      )}
    </dialog>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 3L11 11" />
      <path d="M11 3L3 11" />
    </svg>
  );
}
