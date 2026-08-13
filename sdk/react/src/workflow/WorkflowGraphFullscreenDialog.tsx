"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
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
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) onClose();
    },
    [onClose],
  );

  const workflowName = workflow?.metadata?.name || "Task Flow";

  return (
    <DialogShell
      open={open}
      onOpenChange={handleOpenChange}
      aria-label={`${workflowName} — full view`}
      // Near-full-viewport outlier: free-form sizing and the background
      // surface for the graph canvas. The previously hardcoded ::backdrop
      // color (bg-black/60 — it predated and escaped the #652 fence via the
      // arbitrary-variant spelling) now rides the shell's token backdrop.
      className="stg:h-[90vh] stg:w-[95vw] stg:max-w-none stg:bg-background stg:text-foreground stg:outline-none"
    >
      {open && (
        <div className="stg:flex stg:h-full stg:flex-col">
          <div className="stg:flex stg:shrink-0 stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-4 stg:py-3">
            <h2 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
              {workflowName}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close full view"
              className={cn(
                "stg:inline-flex stg:size-7 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                "stg:hover:bg-accent-hover stg:hover:text-foreground",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                "stg:transition-colors",
              )}
            >
              <CloseIcon />
            </button>
          </div>
          <div className="stg:min-h-0 stg:flex-1">
            <WorkflowOverviewGraph
              workflow={workflow}
              onOpenInEditor={onOpenInEditor}
              nodesDraggable
              className="stg:h-full stg:w-full stg:bg-[var(--stgm-muted-subtle,#fafafa)]"
            />
          </div>
        </div>
      )}
    </DialogShell>
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
