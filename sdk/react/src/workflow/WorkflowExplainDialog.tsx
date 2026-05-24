"use client";

import { useCallback, useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { useExplainWorkflowFlow, type ExplainPhase } from "./useExplainWorkflowFlow";
import { MessageThread } from "../execution/MessageThread";

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

  const handleCopy = useCallback(() => {
    if (flow.explanation) {
      navigator.clipboard.writeText(flow.explanation).catch(() => {
        /* Clipboard unavailable in some contexts */
      });
    }
  }, [flow.explanation]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-2xl rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">
              Workflow Explanation
            </h3>
            {flow.isStreaming && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <SpinnerIcon />
                Analyzing…
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            A plain-language walkthrough of what this workflow does
          </p>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
          {/* Starting state */}
          {flow.phase === "starting" && (
            <div className="flex flex-col items-center justify-center gap-2 py-8">
              <SpinnerIcon size={20} />
              <p className="text-sm text-muted-foreground">
                Starting Workflow Architect…
              </p>
            </div>
          )}

          {/* Streaming: show the agent conversation */}
          {flow.phase === "streaming" && flow.execution && (
            <MessageThread
              executions={[]}
              activeStreamExecution={flow.execution}
              className="min-h-[100px]"
            />
          )}

          {/* Complete: show the explanation */}
          {flow.phase === "complete" && flow.explanation && (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {flow.explanation}
            </div>
          )}

          {/* Complete but no explanation from structured output — show message thread */}
          {flow.phase === "complete" && !flow.explanation && flow.execution && (
            <MessageThread
              executions={[flow.execution]}
              activeStreamExecution={null}
              className="min-h-[100px]"
            />
          )}

          {/* Error */}
          {flow.error && flow.phase === "error" && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {flow.error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between border-t border-border px-6 py-3">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "border border-input bg-background text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Close
          </button>
          <div className="flex gap-2">
            {flow.phase === "error" && (
              <button
                type="button"
                onClick={flow.explain}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "border border-input bg-background text-foreground",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  "bg-primary text-primary-foreground hover:bg-primary/90",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Copy to clipboard
              </button>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

function SpinnerIcon({ size = 14 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
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
