"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { useExplainWorkflowFlow, type ExplainPhase } from "./useExplainWorkflowFlow.js";
import { MessageThread } from "../execution/MessageThread.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCopyFeedback } from "../internal/useCopyFeedback.js";

/** Props for {@link WorkflowExplainDialog}. */
export interface WorkflowExplainDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close. */
  readonly onOpenChange: (open: boolean) => void;
  /** Organization slug. */
  readonly org: string;
  /** Current workflow YAML to explain. */
  readonly currentYaml: string;
}

/**
 * Modal dialog that generates a human-readable explanation of a workflow.
 *
 * Uses the `workflow-architect` agent in explain-only mode. The dialog
 * auto-starts the explanation when opened and streams the agent's
 * response in real-time.
 *
 * Uses the same `<dialog>` + `showModal()` pattern as `WorkflowArchitectDialog`.
 *
 * @since T14 (AI-Assisted Workflow Creation)
 */
export function WorkflowExplainDialog({
  open,
  onOpenChange,
  org,
  currentYaml,
}: WorkflowExplainDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const flow = useExplainWorkflowFlow({
    org,
    currentYaml,
    onError: () => {
      /* Error displayed inline */
    },
  });

  // Show/hide dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      flow.reset();
      dialog.showModal();
      flow.explain();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, flow.reset, flow.explain]);

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

  const { copy, copied } = useCopyFeedback();
  const handleCopy = useCallback(() => {
    if (flow.explanation) {
      void copy(flow.explanation);
    }
  }, [copy, flow.explanation]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      onClick={handleBackdropClick}
      className={cn(
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:w-full stg:max-w-2xl stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-backdrop",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
          <div className="stg:flex stg:items-center stg:gap-2">
            <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
              Workflow Explanation
            </h3>
            {flow.isStreaming && (
              <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
                <SpinnerIcon size={14} />
                Analyzing…
              </span>
            )}
          </div>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            A plain-language walkthrough of what this workflow does
          </p>
        </div>

        {/* Content */}
        <div className="stg:max-h-[60vh] stg:overflow-y-auto stg:px-6 stg:py-4">
          {/* Starting state */}
          {flow.phase === "starting" && (
            <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:py-8">
              <SpinnerIcon size={20} />
              <p className="stg:text-sm stg:text-muted-foreground">
                Starting Workflow Architect…
              </p>
            </div>
          )}

          {/* Streaming: show the agent conversation */}
          {flow.phase === "streaming" && flow.execution && (
            <MessageThread
              executions={[]}
              activeStreamExecution={flow.execution}
              className="stg:min-h-[100px]"
            />
          )}

          {/* Complete: show the explanation */}
          {flow.phase === "complete" && flow.explanation && (
            <div className="stg:whitespace-pre-wrap stg:text-sm stg:leading-relaxed stg:text-foreground">
              {flow.explanation}
            </div>
          )}

          {/* Complete but no explanation from structured output — show message thread */}
          {flow.phase === "complete" && !flow.explanation && flow.execution && (
            <MessageThread
              executions={[flow.execution]}
              activeStreamExecution={null}
              className="stg:min-h-[100px]"
            />
          )}

          {/* Error */}
          {flow.error && flow.phase === "error" && (
            <div
              className="stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive/5 stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
              role="alert"
            >
              {flow.error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="stg:flex stg:justify-between stg:border-t stg:border-border stg:px-6 stg:py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:border stg:border-input stg:bg-background stg:text-foreground",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Close
          </button>
          <div className="stg:flex stg:gap-2">
            {flow.phase === "error" && (
              <button
                type="button"
                onClick={flow.explain}
                className={cn(
                  "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
                  "stg:border stg:border-input stg:bg-background stg:text-foreground",
                  "stg:hover:bg-accent stg:hover:text-accent-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                Try Again
              </button>
            )}
            {flow.phase === "complete" && flow.explanation && (
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
                  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                {copied ? "Copied" : "Copy to clipboard"}
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

