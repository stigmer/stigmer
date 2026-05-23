"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useRunWorkflowFlow } from "./useRunWorkflowFlow";
import { WorkflowRunForm } from "./WorkflowRunForm";

/** Props for {@link WorkflowRunDialog}. */
export interface WorkflowRunDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close (cancel, backdrop click, Escape). */
  readonly onOpenChange: (open: boolean) => void;
  /** Organization slug that owns the workflow. */
  readonly org: string;
  /** The workflow blueprint to run. */
  readonly workflow: Workflow;
  /** Available workflow instances for the instance selector. */
  readonly instances: readonly WorkflowInstance[];
  /**
   * Called after the execution is created successfully.
   * Receives the execution ID — use for navigation.
   */
  readonly onSuccess: (executionId: string) => void;
  /**
   * Called when submission fails. Receives a human-readable message.
   * Use for toast notifications.
   */
  readonly onError?: (message: string) => void;
}

/**
 * Dialog for running a workflow execution.
 *
 * Composes {@link useRunWorkflowFlow} with {@link WorkflowRunForm}
 * inside a native `<dialog>` element. Manages the full lifecycle:
 * form fields, validation, submission, error display, and close.
 *
 * Uses the same `<dialog>` + `showModal()` pattern as
 * {@link ConfirmDialog} — built-in focus trapping, Escape key
 * handling, and backdrop. Styled via `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <WorkflowRunDialog
 *   open={showRunDialog}
 *   onOpenChange={setShowRunDialog}
 *   org="acme"
 *   workflow={workflow}
 *   instances={instances}
 *   onSuccess={(id) => router.push(`/workflows/executions/${id}`)}
 *   onError={(msg) => toast.error(msg)}
 * />
 * ```
 */
export function WorkflowRunDialog({
  open,
  onOpenChange,
  org,
  workflow,
  instances,
  onSuccess,
  onError,
}: WorkflowRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleSuccess = useCallback(
    (executionId: string) => {
      onOpenChange(false);
      onSuccess(executionId);
    },
    [onOpenChange, onSuccess],
  );

  const flow = useRunWorkflowFlow({
    org,
    workflow,
    instances,
    onSuccess: handleSuccess,
    onError,
  });

  // Sync open state with the native dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      flow.reset();
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, flow.reset]);

  const handleDialogCancel = useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onOpenChange(false);
      }
    },
    [onOpenChange],
  );

  const workflowName =
    workflow.metadata?.name || workflow.metadata?.slug || "Workflow";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-lg rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h3 className="text-base font-semibold text-foreground">
            Run {workflowName}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure inputs and start a new execution
          </p>
        </div>

        {/* Body */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {flow.error && (
            <div
              className="mb-4 rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {flow.error}
            </div>
          )}

          <WorkflowRunForm
            triggerMessage={flow.triggerMessage}
            onTriggerMessageChange={flow.setTriggerMessage}
            envDeclarations={flow.envDeclarations}
            runtimeEnv={flow.runtimeEnv}
            onEnvVarChange={flow.setEnvVar}
            instances={instances}
            selectedInstanceId={flow.selectedInstanceId}
            onInstanceChange={flow.setSelectedInstanceId}
            showTriggerMessage={flow.showTriggerMessage}
            onShowTriggerMessageChange={flow.setShowTriggerMessage}
            errors={flow.fieldErrors}
            disabled={flow.isSubmitting}
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={flow.isSubmitting}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "border border-input bg-background text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={flow.submit}
            disabled={flow.isSubmitting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {flow.isSubmitting && <SpinnerIcon />}
            {flow.isSubmitting ? "Starting…" : "Run Workflow"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
