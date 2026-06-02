"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  useWorkflowArchitectFlow,
  type ArchitectPhase,
} from "./useWorkflowArchitectFlow";
import { MessageThread } from "../execution/MessageThread";
import { WorkflowDiffGraph } from "./WorkflowDiffGraph";

/** Props for {@link WorkflowArchitectDialog}. */
export interface WorkflowArchitectDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should close (cancel, backdrop click, Escape). */
  readonly onOpenChange: (open: boolean) => void;
  /** Organization slug for generation context and workflow creation. */
  readonly org: string;
  /**
   * Called after the workflow is created successfully.
   * Receives the org slug and workflow slug for navigation.
   */
  readonly onSuccess: (org: string, slug: string) => void;
  /**
   * Called when generation or creation fails. Receives a human-readable message.
   * Use for toast notifications.
   */
  readonly onError?: (message: string) => void;
}

/**
 * Three-phase dialog for generating a workflow via the Workflow Architect agent.
 *
 * **Phase 1 (Input)**: The user describes the workflow they want.
 *
 * **Phase 2 (Streaming)**: The agent works in real-time — querying task kinds,
 * validating YAML, iterating on the design. Messages and tool calls stream
 * into a `MessageThread` inside the dialog.
 *
 * **Phase 3 (Result)**: The validated YAML is extracted from the agent's
 * response, shown in a read-only preview alongside the agent's explanation.
 * The user can create the workflow, try again, or close.
 *
 * Uses the same `<dialog>` + `showModal()` pattern as `WorkflowRunDialog`.
 * Styled via `--stgm-*` design tokens (DD-005).
 *
 * @example
 * ```tsx
 * <WorkflowArchitectDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   org="acme"
 *   onSuccess={(org, slug) => router.push(`/library/workflows/${org}/${slug}`)}
 *   onError={(msg) => toast.error(msg)}
 * />
 * ```
 */
export function WorkflowArchitectDialog({
  open,
  onOpenChange,
  org,
  onSuccess,
  onError,
}: WorkflowArchitectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleSuccess = useCallback(
    (successOrg: string, slug: string) => {
      onOpenChange(false);
      onSuccess(successOrg, slug);
    },
    [onOpenChange, onSuccess],
  );

  const flow = useWorkflowArchitectFlow({
    org,
    onSuccess: handleSuccess,
    onError,
  });

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

  const isWorking =
    flow.phase === "starting" ||
    flow.phase === "streaming" ||
    flow.phase === "applying";

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleDialogCancel}
      onClick={handleBackdropClick}
      className={cn(
        "fixed inset-0 z-50 m-auto w-full max-w-3xl rounded-lg border border-border bg-popover p-0 text-popover-foreground shadow-lg",
        "backdrop:bg-black/50",
        "open:animate-in open:fade-in-0 open:zoom-in-95",
      )}
    >
      <div className="flex flex-col">
        <DialogPhase flow={flow} onClose={() => onOpenChange(false)} />
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Phase router
// ---------------------------------------------------------------------------

interface DialogPhaseProps {
  readonly flow: ReturnType<typeof useWorkflowArchitectFlow>;
  readonly onClose: () => void;
}

function DialogPhase({ flow, onClose }: DialogPhaseProps) {
  switch (flow.phase) {
    case "idle":
      return <InputPhase flow={flow} onClose={onClose} />;
    case "starting":
    case "streaming":
      return <StreamingPhase flow={flow} onClose={onClose} />;
    case "complete":
      return <ResultPhase flow={flow} onClose={onClose} />;
    case "extraction-failed":
    case "error":
      return <ErrorPhase flow={flow} onClose={onClose} />;
    case "applying":
      return <ResultPhase flow={flow} onClose={onClose} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Phase 1: Input
// ---------------------------------------------------------------------------

const INPUT_CLASSES = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

function InputPhase({
  flow,
  onClose,
}: {
  readonly flow: ReturnType<typeof useWorkflowArchitectFlow>;
  readonly onClose: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-base font-semibold text-foreground">
          Generate Workflow
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Describe what you want and the Workflow Architect agent will design,
          validate, and generate a workflow definition
        </p>
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        {flow.error && (
          <div
            className="mb-4 rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {flow.error}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label
            htmlFor="architect-prompt"
            className="text-xs font-medium text-foreground"
          >
            Description
            <span className="ml-1 text-destructive" aria-label="required">
              *
            </span>
          </label>
          <textarea
            id="architect-prompt"
            value={flow.prompt}
            onChange={(e) => flow.setPrompt(e.target.value)}
            placeholder="e.g., A workflow that enriches customer data using my data-agent, validates the output, and sends a Slack notification on failure"
            rows={5}
            className={cn(INPUT_CLASSES, "resize-y")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                flow.generate();
              }
            }}
          />
          <p className="text-[0.7rem] text-muted-foreground">
            Describe the goal, steps, and any specific agents or task kinds to
            use. The agent will discover available resources automatically.
          </p>
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "border border-input bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={flow.generate}
          disabled={flow.prompt.trim().length < 10}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          Generate
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: Streaming
// ---------------------------------------------------------------------------

function StreamingPhase({
  flow,
  onClose,
}: {
  readonly flow: ReturnType<typeof useWorkflowArchitectFlow>;
  readonly onClose: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-foreground">
            Workflow Architect
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <SpinnerIcon />
            {flow.phase === "starting" ? "Starting…" : "Working…"}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The agent is designing and validating your workflow
        </p>
      </div>

      <div className="h-[55vh] overflow-hidden">
        <MessageThread
          executions={[]}
          activeStreamExecution={flow.execution}
          pendingUserMessage={
            flow.phase === "starting" ? flow.prompt : undefined
          }
          className="h-full"
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={() => {
            flow.reset();
            onClose();
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "border border-input bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase 3: Result
// ---------------------------------------------------------------------------

function ResultPhase({
  flow,
  onClose,
}: {
  readonly flow: ReturnType<typeof useWorkflowArchitectFlow>;
  readonly onClose: () => void;
}) {
  const isApplying = flow.phase === "applying";
  const [showYaml, setShowYaml] = useState(false);

  return (
    <>
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-base font-semibold text-foreground">
          Generated Workflow
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Review the generated workflow before creating it
        </p>
      </div>

      <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
        {flow.error && (
          <div
            className="mb-4 rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {flow.error}
          </div>
        )}

        {flow.explanation && (
          <div className="mb-4">
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">
              Explanation
            </h4>
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {flow.explanation}
            </p>
          </div>
        )}

        {flow.extractedYaml && (
          <div>
            <h4 className="mb-1 text-xs font-medium text-muted-foreground">
              Workflow Structure
            </h4>
            <div className="h-[280px] overflow-hidden rounded-md border border-border">
              <WorkflowDiffGraph
                beforeYaml=""
                afterYaml={flow.extractedYaml}
              />
            </div>

            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowYaml((v) => !v)}
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showYaml ? "▾ Hide YAML" : "▸ View YAML"}
              </button>
              {showYaml && (
                <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed text-foreground">
                  {flow.extractedYaml}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isApplying}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "text-muted-foreground hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Close
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={flow.reset}
            disabled={isApplying}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "border border-input bg-background text-foreground",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={flow.createWorkflow}
            disabled={isApplying}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {isApplying && <SpinnerIcon />}
            {isApplying ? "Creating…" : "Create Workflow"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Error / extraction-failed phase
// ---------------------------------------------------------------------------

function ErrorPhase({
  flow,
  onClose,
}: {
  readonly flow: ReturnType<typeof useWorkflowArchitectFlow>;
  readonly onClose: () => void;
}) {
  return (
    <>
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-base font-semibold text-foreground">
          Generation Failed
        </h3>
      </div>

      <div className="px-6 py-6">
        <div
          className="rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {flow.error ?? "An unexpected error occurred."}
        </div>
      </div>

      <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "border border-input bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Close
        </button>
        <button
          type="button"
          onClick={flow.reset}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Try Again
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

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
