"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  useGenerateWorkflowFlow,
  type GenerateWorkflowResult,
} from "./useGenerateWorkflowFlow";

/** Props for {@link WorkflowGenerateDialog}. */
export interface WorkflowGenerateDialogProps {
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
 * Two-phase dialog for generating a workflow from a natural language prompt.
 *
 * **Phase 1 (Input)**: The user describes the workflow they want. Optional
 * advanced options allow specifying a model and task kind hints.
 *
 * **Phase 2 (Result)**: After generation, shows the LLM's explanation,
 * a read-only YAML preview, and validation warnings. The user can create
 * the workflow, try again, or close.
 *
 * Uses the same `<dialog>` + `showModal()` pattern as
 * {@link WorkflowRunDialog} — built-in focus trapping, Escape key
 * handling, and backdrop. Styled via `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <WorkflowGenerateDialog
 *   open={showDialog}
 *   onOpenChange={setShowDialog}
 *   org="acme"
 *   onSuccess={(org, slug) => router.push(`/library/workflows/${org}/${slug}`)}
 *   onError={(msg) => toast.error(msg)}
 * />
 * ```
 */
export function WorkflowGenerateDialog({
  open,
  onOpenChange,
  org,
  onSuccess,
  onError,
}: WorkflowGenerateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleSuccess = useCallback(
    (successOrg: string, slug: string) => {
      onOpenChange(false);
      onSuccess(successOrg, slug);
    },
    [onOpenChange, onSuccess],
  );

  const flow = useGenerateWorkflowFlow({
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

  const isBusy = flow.isGenerating || flow.isCreating;

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
        {flow.result ? (
          <ResultPhase
            result={flow.result}
            error={flow.error}
            isCreating={flow.isCreating}
            onCreateWorkflow={flow.createWorkflow}
            onTryAgain={() => {
              flow.reset();
            }}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <InputPhase
            prompt={flow.prompt}
            onPromptChange={flow.setPrompt}
            model={flow.model}
            onModelChange={flow.setModel}
            taskKindHints={flow.taskKindHints}
            onTaskKindHintsChange={flow.setTaskKindHints}
            isGenerating={flow.isGenerating}
            error={flow.error}
            onGenerate={flow.generate}
            onClose={() => onOpenChange(false)}
            isBusy={isBusy}
          />
        )}
      </div>
    </dialog>
  );
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
  prompt,
  onPromptChange,
  model,
  onModelChange,
  taskKindHints,
  onTaskKindHintsChange,
  isGenerating,
  error,
  onGenerate,
  onClose,
  isBusy,
}: {
  readonly prompt: string;
  readonly onPromptChange: (v: string) => void;
  readonly model: string;
  readonly onModelChange: (v: string) => void;
  readonly taskKindHints: string;
  readonly onTaskKindHintsChange: (v: string) => void;
  readonly isGenerating: boolean;
  readonly error: string | null;
  readonly onGenerate: () => void;
  readonly onClose: () => void;
  readonly isBusy: boolean;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-base font-semibold text-foreground">
          Generate Workflow
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Describe what you want and we'll generate a workflow definition
        </p>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        {error && (
          <div
            className="mb-4 rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        {isGenerating ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <SpinnerIcon size={24} />
            <p className="text-sm text-muted-foreground">
              Generating workflow...
            </p>
            <p className="text-xs text-muted-foreground">
              This may take 10–30 seconds
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="generate-prompt"
                className="text-xs font-medium text-foreground"
              >
                Description
                <span className="ml-1 text-destructive" aria-label="required">
                  *
                </span>
              </label>
              <textarea
                id="generate-prompt"
                value={prompt}
                onChange={(e) => onPromptChange(e.target.value)}
                placeholder="e.g., A workflow that enriches customer data using my data-agent, validates the output, and sends a Slack notification on failure"
                disabled={isBusy}
                rows={5}
                className={cn(INPUT_CLASSES, "resize-y")}
              />
              <p className="text-[0.7rem] text-muted-foreground">
                Describe the goal, steps, and any specific agents or task kinds
                to use. Minimum 10 characters.
              </p>
            </div>

            {/* Advanced options */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((prev) => !prev)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={showAdvanced}
              >
                <ChevronIcon expanded={showAdvanced} />
                Advanced options
              </button>

              {showAdvanced && (
                <div className="mt-2 flex flex-col gap-3 rounded-md border border-border p-3">
                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="generate-model"
                      className="text-xs font-medium text-foreground"
                    >
                      Model
                    </label>
                    <input
                      id="generate-model"
                      type="text"
                      value={model}
                      onChange={(e) => onModelChange(e.target.value)}
                      placeholder="Server default (e.g., claude-sonnet-4-6)"
                      disabled={isBusy}
                      className={INPUT_CLASSES}
                    />
                    <p className="text-[0.7rem] text-muted-foreground">
                      Leave empty to use the server's default model.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label
                      htmlFor="generate-hints"
                      className="text-xs font-medium text-foreground"
                    >
                      Task kind hints
                    </label>
                    <input
                      id="generate-hints"
                      type="text"
                      value={taskKindHints}
                      onChange={(e) => onTaskKindHintsChange(e.target.value)}
                      placeholder="e.g., llm_call, human_input, notification"
                      disabled={isBusy}
                      className={INPUT_CLASSES}
                    />
                    <p className="text-[0.7rem] text-muted-foreground">
                      Comma-separated task kinds to guide generation.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isGenerating}
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
          onClick={onGenerate}
          disabled={isBusy}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isGenerating && <SpinnerIcon />}
          {isGenerating ? "Generating…" : "Generate"}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Phase 2: Result
// ---------------------------------------------------------------------------

function ResultPhase({
  result,
  error,
  isCreating,
  onCreateWorkflow,
  onTryAgain,
  onClose,
}: {
  readonly result: GenerateWorkflowResult;
  readonly error: string | null;
  readonly isCreating: boolean;
  readonly onCreateWorkflow: () => void;
  readonly onTryAgain: () => void;
  readonly onClose: () => void;
}) {
  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Generated Workflow
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Review the generated workflow before creating it
          </p>
        </div>
        <span className="rounded-full border border-border px-2 py-0.5 text-[0.65rem] text-muted-foreground">
          {result.modelUsed}
        </span>
      </div>

      {/* Body */}
      <div className="max-h-[65vh] overflow-y-auto px-6 py-4">
        {error && (
          <div
            className="mb-4 rounded-md border border-destructive bg-destructive-muted px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        )}

        {result.warnings.length > 0 && (
          <div className="mb-4 rounded-md border border-warning bg-warning-muted px-3 py-2 text-sm text-warning">
            <p className="mb-1 font-medium">Warnings</p>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Explanation */}
        <div className="mb-4">
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Explanation
          </h4>
          <p className="text-sm text-foreground">{result.explanation}</p>
        </div>

        {/* YAML preview */}
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Generated YAML
          </h4>
          <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs leading-relaxed text-foreground">
            {result.yaml}
          </pre>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between border-t border-border px-6 py-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isCreating}
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
            onClick={onTryAgain}
            disabled={isCreating}
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
            onClick={onCreateWorkflow}
            disabled={isCreating}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {isCreating && <SpinnerIcon />}
            {isCreating ? "Creating…" : "Create Workflow"}
          </button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Icons
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

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "transition-transform",
        expanded ? "rotate-90" : "rotate-0",
      )}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
