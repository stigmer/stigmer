"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { useRunWorkflowFlow } from "./useRunWorkflowFlow.js";
import { WorkflowRunForm } from "./WorkflowRunForm.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

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
   * The platform-managed default instance ID (from workflow.status.defaultInstanceId).
   * Passed through to the form's instance picker to control visibility threshold.
   */
  readonly defaultInstanceId?: string;
  /**
   * Instance to preselect when the dialog opens — wire this from a
   * row-level "Run" action so the form reflects the instance the user
   * clicked. Applied on each open transition (after the form resets);
   * ignored when the id is not in `instances`, so a stale id degrades
   * to the default option. Omit (or pass `null`) for the
   * server-resolved default. Same convention as
   * {@link SessionComposer}'s `initialInstanceId`.
   */
  readonly initialInstanceId?: string | null;
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
  defaultInstanceId,
  initialInstanceId,
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
      // Preselection must follow reset (reset clears the selection back to
      // the server-resolved default). Guarded against stale ids: an instance
      // deleted between the caller capturing the id and this open falls back
      // to the default option instead of a <select> value with no option.
      if (
        initialInstanceId &&
        instances.some((i) => i.metadata?.id === initialInstanceId)
      ) {
        flow.setSelectedInstanceId(initialInstanceId);
      }
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [
    open,
    flow.reset,
    flow.setSelectedInstanceId,
    initialInstanceId,
    instances,
  ]);

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
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:w-full stg:max-w-lg stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-black/50",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
            Run {workflowName}
          </h3>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            Configure inputs and start a new execution
          </p>
        </div>

        {/* Body */}
        <div className="stg:max-h-[60vh] stg:overflow-y-auto stg:px-6 stg:py-4">
          {flow.error && (
            <div
              className="stg:mb-4 stg:rounded-md stg:border stg:border-destructive stg:bg-destructive-muted stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
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
            defaultInstanceId={defaultInstanceId}
            instanceEnvKeys={flow.instanceEnvKeys}
            showTriggerMessage={flow.showTriggerMessage}
            onShowTriggerMessageChange={flow.setShowTriggerMessage}
            errors={flow.fieldErrors}
            disabled={flow.isSubmitting}
          />
        </div>

        {/* Footer */}
        <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-6 stg:py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={flow.isSubmitting}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:border stg:border-input stg:bg-background stg:text-foreground",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={flow.submit}
            disabled={flow.isSubmitting}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
            )}
          >
            {flow.isSubmitting && <SpinnerIcon size={14} />}
            {flow.isSubmitting ? "Starting…" : "Run Workflow"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

