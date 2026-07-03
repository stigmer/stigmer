"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { useDiagnoseExecutionFlow, type DiagnosePhase } from "./useDiagnoseExecutionFlow.js";
import { MessageThread } from "../execution/MessageThread.js";
import { computeUnifiedDiff, type DiffLine } from "./workflow-yaml-diff.js";
import { WorkflowDiffGraph } from "./WorkflowDiffGraph.js";

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

const COMPOSER_ENABLED_PHASES: ReadonlySet<DiagnosePhase> = new Set([
  "ready",
  "complete",
  "error",
]);

/**
 * Panel component that displays agent-powered diagnosis of a failed workflow
 * execution. Designed for the execution viewer's right panel (AD-B5-001).
 *
 * Layout:
 * 1. Header — "AI Diagnosis" title with sparkles icon + close button
 * 2. Message area — `MessageThread` showing the agent conversation
 * 3. Result strip (conditional) — fix explanation, diff preview, Apply Fix / Discard
 * 4. Follow-up composer (pinned to bottom) — text input for additional questions
 *
 * Auto-starts diagnosis on mount (AD-B5-002). Supports multi-turn
 * follow-up questions within the same session (AD-B5-003).
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
  const [followUp, setFollowUp] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const flow = useDiagnoseExecutionFlow({
    executionId,
    org,
    currentWorkflowYaml,
    autoStart: true,
    onError: () => {
      /* Error is displayed inline via flow.error */
    },
  });

  const composerEnabled = COMPOSER_ENABLED_PHASES.has(flow.phase);
  const hasConversation =
    flow.completedExecutions.length > 0 || flow.activeExecution !== null;

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSendFollowUp = useCallback(async () => {
    const trimmed = followUp.trim();
    if (trimmed.length < 5) return;

    setFollowUp("");
    await flow.sendFollowUp(trimmed);

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [flow.sendFollowUp, followUp]);

  const handleApplyFix = useCallback(() => {
    const yaml = flow.acceptFix();
    if (yaml && onApplyFix) {
      onApplyFix(yaml);
    }
  }, [flow.acceptFix, onApplyFix]);

  const handleDiscard = useCallback(() => {
    flow.discardFix();
  }, [flow.discardFix]);

  const handleRetry = useCallback(() => {
    flow.reset();
  }, [flow.reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSendFollowUp();
      }
    },
    [handleSendFollowUp],
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background",
        className,
      )}
      role="complementary"
      aria-label="Workflow diagnosis panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <SparklesIcon />
          <h3 className="text-xs font-semibold text-foreground">
            AI Diagnosis
          </h3>
          {flow.isStreaming && (
            <span className="inline-flex items-center gap-1 text-[0.65rem] text-muted-foreground">
              <SpinnerIcon size={10} />
              Analyzing…
            </span>
          )}
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

      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Starting indicator */}
        {flow.phase === "starting" && !hasConversation && (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <SpinnerIcon />
            <p className="text-xs text-muted-foreground">
              Starting Workflow Architect…
            </p>
          </div>
        )}

        {/* Agent conversation */}
        {hasConversation && (
          <MessageThread
            executions={flow.completedExecutions}
            activeStreamExecution={flow.activeExecution}
            className="flex-1"
          />
        )}

        {/* Error */}
        {flow.error && flow.phase === "error" && (
          <div className="mx-3 mt-3 space-y-2">
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {flow.error}
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className={cn(
                "w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "border border-input bg-background text-foreground",
                "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              Try Again
            </button>
          </div>
        )}
      </div>

      {/* Result strip (diff + apply/discard) */}
      {flow.phase === "complete" && flow.extractedYaml && (
        <ResultStrip
          extractedYaml={flow.extractedYaml}
          explanation={flow.explanation}
          beforeYaml={currentWorkflowYaml}
          onApplyFix={onApplyFix ? handleApplyFix : undefined}
          onDiscard={handleDiscard}
        />
      )}

      {/* Runtime error notice (no fix available) */}
      {flow.phase === "ready" && !flow.extractedYaml && flow.completedExecutions.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <div className="rounded-md border border-border bg-muted/50 px-2.5 py-2 text-[0.7rem] text-muted-foreground">
            No workflow definition changes are needed. Check the analysis above for remediation steps.
          </div>
        </div>
      )}

      {/* Follow-up composer (pinned to bottom) */}
      <div className="border-t border-border p-3">
        <textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question..."
          disabled={!composerEnabled}
          rows={2}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[0.65rem] text-muted-foreground">
            {"\u2318"}+Enter to send
          </p>
          <button
            type="button"
            onClick={handleSendFollowUp}
            disabled={!composerEnabled || followUp.trim().length < 5}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result Strip — diff preview with apply/discard actions
// ---------------------------------------------------------------------------

function ResultStrip({
  extractedYaml,
  explanation,
  beforeYaml,
  onApplyFix,
  onDiscard,
}: {
  readonly extractedYaml: string;
  readonly explanation: string | null;
  readonly beforeYaml?: string;
  readonly onApplyFix?: () => void;
  readonly onDiscard: () => void;
}) {
  const [showYamlDiff, setShowYamlDiff] = useState(false);
  const diffLines = beforeYaml
    ? computeUnifiedDiff(beforeYaml, extractedYaml)
    : null;
  const hasChanges = diffLines?.some((l) => l.type !== "equal") ?? false;

  return (
    <div className="border-t border-border px-3 py-3" aria-live="polite">
      {/* Explanation */}
      {explanation && (
        <div className="mb-3">
          <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Suggested Fix
          </h4>
          <p className="text-xs leading-relaxed text-foreground">
            {explanation}
          </p>
        </div>
      )}

      {/* Visual graph diff */}
      {hasChanges && beforeYaml && (
        <div className="mb-3">
          <div className="h-[200px] overflow-hidden rounded-md border border-border">
            <WorkflowDiffGraph
              beforeYaml={beforeYaml}
              afterYaml={extractedYaml}
            />
          </div>
        </div>
      )}

      {/* Collapsible YAML diff toggle */}
      {hasChanges && diffLines && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowYamlDiff((v) => !v)}
            className="text-[0.65rem] font-medium text-muted-foreground hover:text-foreground"
          >
            {showYamlDiff ? "▾ Hide YAML diff" : "▸ View YAML diff"}
          </button>
          {showYamlDiff && (
            <div className="mt-1">
              <DiffPreview lines={diffLines} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {onApplyFix && (
          <button
            type="button"
            onClick={onApplyFix}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            Apply Fix
          </button>
        )}
        <button
          type="button"
          onClick={onDiscard}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            "border border-input bg-background text-foreground",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Discard
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff Preview
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
