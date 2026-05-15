"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import { useDiagnoseExecution, type DiagnoseExecutionFlowResult } from "./useDiagnoseExecution";
import { computeUnifiedDiff, type DiffLine } from "./workflow-yaml-diff";

/** Props for {@link WorkflowRepairCard}. */
export interface WorkflowRepairCardProps {
  /** ID of the failed workflow execution to diagnose. */
  readonly executionId: string;
  /** Organization slug for authorization and resource context. */
  readonly org: string;
  /** Current workflow YAML for diff computation (optional). */
  readonly currentWorkflowYaml?: string;
  /**
   * Called when the user clicks "Apply Fix". Receives the suggested YAML.
   * The host application handles navigation to the workflow editor (DD-004).
   */
  readonly onApplyFix?: (yaml: string) => void;
  /** Called when the panel should close. */
  readonly onClose?: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Card component that displays AI-powered diagnosis of a failed workflow
 * execution. Renders inside the execution viewer's sidebar.
 *
 * Layout:
 * 1. Header — "AI Diagnosis" title with sparkles icon
 * 2. Diagnosis — root-cause analysis (always present)
 * 3. Fix section (conditional) — fix explanation, diff preview, Apply Fix button
 * 4. Loading state — spinner + "Analyzing execution..."
 * 5. Error state — error message with Try Again button
 *
 * Styled via `--stgm-*` design tokens. Zero console dependencies (DD-004).
 */
export function WorkflowRepairCard({
  executionId,
  org,
  currentWorkflowYaml,
  onApplyFix,
  onClose,
  className,
}: WorkflowRepairCardProps) {
  const flow = useDiagnoseExecution({
    org,
    onError: () => {
      /* Error is displayed inline via flow.error */
    },
  });

  const handleDiagnose = useCallback(() => {
    flow.diagnose(executionId);
  }, [flow, executionId]);

  const handleApplyFix = useCallback(() => {
    if (flow.result?.suggestedYaml && onApplyFix) {
      onApplyFix(flow.result.suggestedYaml);
    }
  }, [flow.result, onApplyFix]);

  const handleTryAgain = useCallback(() => {
    flow.reset();
    flow.diagnose(executionId);
  }, [flow, executionId]);

  const showInitial = !flow.isDiagnosing && !flow.result && !flow.error;

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-background",
        className,
      )}
      role="complementary"
      aria-label="Workflow diagnosis panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <SparklesIcon />
          <h3 className="text-xs font-semibold text-foreground">AI Diagnosis</h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close diagnosis panel"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Initial state — prompt to diagnose */}
        {showInitial && (
          <div className="flex flex-col items-center justify-center gap-3 px-3 py-8">
            <p className="text-center text-xs text-muted-foreground">
              Analyze this failed execution to identify the root cause and get fix suggestions.
            </p>
            <button
              type="button"
              onClick={handleDiagnose}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <SparklesIcon />
              Diagnose with AI
            </button>
          </div>
        )}

        {/* Loading state */}
        {flow.isDiagnosing && (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <SpinnerIcon />
            <p className="text-xs text-muted-foreground">Analyzing execution…</p>
          </div>
        )}

        {/* Error state */}
        {flow.error && (
          <div className="px-3 py-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
              {flow.error}
            </div>
            <button
              type="button"
              onClick={handleTryAgain}
              className={cn(
                "mt-2 w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "border border-input bg-background text-foreground",
                "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Result */}
        {flow.result && (
          <DiagnosisResultSection
            result={flow.result}
            currentWorkflowYaml={currentWorkflowYaml}
            onApplyFix={onApplyFix ? handleApplyFix : undefined}
          />
        )}
      </div>
    </div>
  );
}

function DiagnosisResultSection({
  result,
  currentWorkflowYaml,
  onApplyFix,
}: {
  readonly result: DiagnoseExecutionFlowResult;
  readonly currentWorkflowYaml?: string;
  readonly onApplyFix?: () => void;
}) {
  const hasFix = result.suggestedYaml.length > 0;

  const diffLines = hasFix && currentWorkflowYaml
    ? computeUnifiedDiff(currentWorkflowYaml, result.suggestedYaml)
    : null;
  const hasChanges = diffLines?.some((l) => l.type !== "equal") ?? false;

  return (
    <div className="px-3 py-3" aria-live="polite">
      {/* Diagnosis */}
      <div className="mb-3">
        <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          Root Cause
        </h4>
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
          {result.diagnosis}
        </p>
      </div>

      {/* Fix section — only when the LLM suggests a YAML change */}
      {hasFix && (
        <>
          {/* Fix explanation */}
          <div className="mb-3">
            <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
              Suggested Fix
            </h4>
            <p className="text-xs leading-relaxed text-foreground">
              {result.fixExplanation}
            </p>
          </div>

          {/* Warnings */}
          {result.warnings.length > 0 && (
            <div className="mb-3 rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5">
              <ul className="list-inside list-disc space-y-0.5 text-[0.7rem] text-warning">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Diff preview */}
          {hasChanges && diffLines && (
            <div className="mb-3">
              <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
                Diff
              </h4>
              <DiffPreview lines={diffLines} />
            </div>
          )}

          {/* Apply Fix button */}
          {onApplyFix && (
            <button
              type="button"
              onClick={onApplyFix}
              className={cn(
                "w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              Apply Fix
            </button>
          )}
        </>
      )}

      {/* Runtime error — no fix available */}
      {!hasFix && (
        <div className="rounded-md border border-border bg-muted/50 px-2.5 py-2 text-[0.7rem] text-muted-foreground">
          This appears to be a runtime error. No workflow definition changes are needed —
          check the error details above for remediation steps.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff Preview (reused from WorkflowRefinePanel pattern)
// ---------------------------------------------------------------------------

function DiffPreview({ lines }: { readonly lines: readonly DiffLine[] }) {
  const filteredLines = lines.filter(
    (l) => l.type !== "equal" || l.content.trim() !== "",
  );

  if (filteredLines.length > 200) {
    return (
      <p className="text-[0.7rem] text-muted-foreground">
        Diff is too large to display. Apply the fix to see the updated YAML.
      </p>
    );
  }

  return (
    <pre className="max-h-60 overflow-auto rounded-md border border-border text-[0.7rem] leading-relaxed">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "px-2",
            line.type === "added" && "bg-success/10 text-success",
            line.type === "removed" && "bg-destructive/10 text-destructive",
            line.type === "equal" && "text-muted-foreground",
          )}
        >
          <span className="mr-2 inline-block w-3 select-none text-right opacity-60">
            {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
          </span>
          {line.content}
        </div>
      ))}
    </pre>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SparklesIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

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
