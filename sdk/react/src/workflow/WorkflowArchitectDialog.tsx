"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  useWorkflowArchitectFlow,
  type ArchitectPhase,
} from "./useWorkflowArchitectFlow.js";
import { MessageThread } from "../execution/MessageThread.js";
import { WorkflowDiffGraph } from "./WorkflowDiffGraph.js";

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
        "stg:fixed stg:inset-0 stg:z-50 stg:m-auto stg:w-full stg:max-w-3xl stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-0 stg:text-popover-foreground stg:shadow-lg",
        "stg:backdrop:bg-black/50",
        "stg:open:animate-in stg:open:fade-in-0 stg:open:zoom-in-95",
      )}
    >
      <div className="stg:flex stg:flex-col">
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
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-sm stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
      <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
        <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
          Generate Workflow
        </h3>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          Describe what you want and the Workflow Architect agent will design,
          validate, and generate a workflow definition
        </p>
      </div>

      <div className="stg:max-h-[60vh] stg:overflow-y-auto stg:px-6 stg:py-4">
        {flow.error && (
          <div
            className="stg:mb-4 stg:rounded-md stg:border stg:border-destructive stg:bg-destructive-muted stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
            role="alert"
          >
            {flow.error}
          </div>
        )}

        <div className="stg:flex stg:flex-col stg:gap-1">
          <label
            htmlFor="architect-prompt"
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Description
            <span className="stg:ml-1 stg:text-destructive" aria-label="required">
              *
            </span>
          </label>
          <textarea
            id="architect-prompt"
            value={flow.prompt}
            onChange={(e) => flow.setPrompt(e.target.value)}
            placeholder="e.g., A workflow that enriches customer data using my data-agent, validates the output, and sends a Slack notification on failure"
            rows={5}
            className={cn(INPUT_CLASSES, "stg:resize-y")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                flow.generate();
              }
            }}
          />
          <p className="stg:text-[0.7rem] stg:text-muted-foreground">
            Describe the goal, steps, and any specific agents or task kinds to
            use. The agent will discover available resources automatically.
          </p>
        </div>
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-6 stg:py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:border stg:border-input stg:bg-background stg:text-foreground",
            "stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={flow.generate}
          disabled={flow.prompt.trim().length < 10}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
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
      <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
        <div className="stg:flex stg:items-center stg:gap-2">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
            Workflow Architect
          </h3>
          <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:text-muted-foreground">
            <SpinnerIcon />
            {flow.phase === "starting" ? "Starting…" : "Working…"}
          </span>
        </div>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          The agent is designing and validating your workflow
        </p>
      </div>

      <div className="stg:h-[55vh] stg:overflow-hidden">
        <MessageThread
          executions={[]}
          activeStreamExecution={flow.execution}
          pendingUserMessage={
            flow.phase === "starting" ? flow.prompt : undefined
          }
          className="stg:h-full"
        />
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-6 stg:py-3">
        <button
          type="button"
          onClick={() => {
            flow.reset();
            onClose();
          }}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:border stg:border-input stg:bg-background stg:text-foreground",
            "stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
      <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
        <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
          Generated Workflow
        </h3>
        <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
          Review the generated workflow before creating it
        </p>
      </div>

      <div className="stg:max-h-[65vh] stg:overflow-y-auto stg:px-6 stg:py-4">
        {flow.error && (
          <div
            className="stg:mb-4 stg:rounded-md stg:border stg:border-destructive stg:bg-destructive-muted stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
            role="alert"
          >
            {flow.error}
          </div>
        )}

        {flow.explanation && (
          <div className="stg:mb-4">
            <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
              Explanation
            </h4>
            <p className="stg:whitespace-pre-wrap stg:text-sm stg:text-foreground">
              {flow.explanation}
            </p>
          </div>
        )}

        {flow.extractedYaml && (
          <div>
            <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
              Workflow Structure
            </h4>
            <div className="stg:h-[280px] stg:overflow-hidden stg:rounded-md stg:border stg:border-border">
              <WorkflowDiffGraph
                beforeYaml=""
                afterYaml={flow.extractedYaml}
              />
            </div>

            <div className="stg:mt-3">
              <button
                type="button"
                onClick={() => setShowYaml((v) => !v)}
                className="stg:text-xs stg:font-medium stg:text-muted-foreground stg:hover:text-foreground"
              >
                {showYaml ? "▾ Hide YAML" : "▸ View YAML"}
              </button>
              {showYaml && (
                <pre className="stg:mt-1 stg:max-h-60 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:bg-muted stg:p-3 stg:text-xs stg:leading-relaxed stg:text-foreground">
                  {flow.extractedYaml}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="stg:flex stg:justify-between stg:border-t stg:border-border stg:px-6 stg:py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isApplying}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:text-muted-foreground stg:hover:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          Close
        </button>
        <div className="stg:flex stg:gap-2">
          <button
            type="button"
            onClick={flow.reset}
            disabled={isApplying}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:border stg:border-input stg:bg-background stg:text-foreground",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Try Again
          </button>
          <button
            type="button"
            onClick={flow.createWorkflow}
            disabled={isApplying}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
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
      <div className="stg:border-b stg:border-border stg:px-6 stg:py-4">
        <h3 className="stg:text-base stg:font-semibold stg:text-foreground">
          Generation Failed
        </h3>
      </div>

      <div className="stg:px-6 stg:py-6">
        <div
          className="stg:rounded-md stg:border stg:border-destructive stg:bg-destructive-muted stg:px-3 stg:py-2 stg:text-sm stg:text-destructive"
          role="alert"
        >
          {flow.error ?? "An unexpected error occurred."}
        </div>
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-6 stg:py-3">
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:border stg:border-input stg:bg-background stg:text-foreground",
            "stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Close
        </button>
        <button
          type="button"
          onClick={flow.reset}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:transition-colors",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
