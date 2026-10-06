"use client";

/**
 * The run dialog: {@link useRunWorkflowFlow} and {@link WorkflowRunForm}
 * in a modal, reset on every open. A run names its workflow alone, so the
 * dialog takes the workflow and the organization the run is created in,
 * nothing more.
 *
 * Pinned by `__tests__/WorkflowRunDialog.test.tsx`.
 */

import { useCallback, useEffect } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { useRunWorkflowFlow } from "./useRunWorkflowFlow.js";
import { WorkflowRunForm } from "./WorkflowRunForm.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link WorkflowRunDialog}. */
export interface WorkflowRunDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close (cancel, backdrop click, Escape). */
  readonly onOpenChange: (open: boolean) => void;
  /** Id of the organization the run is created in (a slug is also accepted). */
  readonly org: string;
  /** The workflow to run. */
  readonly workflow: Workflow;
  /**
   * Called after the run is created successfully.
   * Receives the run ID — use for navigation.
   */
  readonly onSuccess: (executionId: string) => void;
  /**
   * Called when submission fails. Receives a human-readable message.
   * Use for toast notifications.
   */
  readonly onError?: (message: string) => void;
}

/**
 * Dialog for running a workflow run.
 *
 * Composes {@link useRunWorkflowFlow} with {@link WorkflowRunForm}
 * inside a native `<dialog>` element. Manages the full lifecycle:
 * form fields, validation, submission, error display, and close. The
 * form marks where each declared key will come from and, when the
 * workflow's runs are visible to its organization, says so before the run
 * starts.
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
 *   onSuccess={(id) => router.push(`/runs/${id}`)}
 *   onError={(msg) => toast.error(msg)}
 * />
 * ```
 */
export function WorkflowRunDialog({
  open,
  onOpenChange,
  org,
  workflow,
  onSuccess,
  onError,
}: WorkflowRunDialogProps) {
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
    onSuccess: handleSuccess,
    onError,
  });

  // Each opening starts from a clean form.
  useEffect(() => {
    if (!open) return;
    flow.reset();
  }, [open, flow.reset]);

  const workflowName =
    workflow.metadata?.name || workflow.metadata?.slug || "Workflow";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      dismissOnBackdrop
      aria-label={`Run ${workflowName}`}
    >
      <div className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
            Run {workflowName}
          </h3>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            Configure inputs and start a new run
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
            envKeySources={flow.envKeySources}
            runsVisibleToOrganization={flow.runsVisibleToOrganization}
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
    </DialogShell>
  );
}

