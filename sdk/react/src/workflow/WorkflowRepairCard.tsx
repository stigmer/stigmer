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
        "stg:flex stg:h-full stg:flex-col stg:bg-background",
        className,
      )}
      role="complementary"
      aria-label="Workflow diagnosis panel"
    >
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <SparklesIcon />
          <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">
            AI Diagnosis
          </h3>
          {flow.isStreaming && (
            <span className="stg:inline-flex stg:items-center stg:gap-1 stg:text-[0.65rem] stg:text-muted-foreground">
              <SpinnerIcon size={10} />
              Analyzing…
            </span>
          )}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="stg:rounded stg:p-0.5 stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground"
            aria-label="Close diagnosis panel"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {/* Scrollable content area */}
      <div ref={scrollRef} className="stg:flex stg:min-h-0 stg:flex-1 stg:flex-col stg:overflow-y-auto">
        {/* Starting indicator */}
        {flow.phase === "starting" && !hasConversation && (
          <div className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:py-8">
            <SpinnerIcon />
            <p className="stg:text-xs stg:text-muted-foreground">
              Starting Workflow Architect…
            </p>
          </div>
        )}

        {/* Agent conversation */}
        {hasConversation && (
          <MessageThread
            executions={flow.completedExecutions}
            activeStreamExecution={flow.activeExecution}
            className="stg:flex-1"
          />
        )}

        {/* Error */}
        {flow.error && flow.phase === "error" && (
          <div className="stg:mx-3 stg:mt-3 stg:space-y-2">
            <div
              className="stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive/5 stg:px-3 stg:py-2 stg:text-xs stg:text-destructive"
              role="alert"
            >
              {flow.error}
            </div>
            <button
              type="button"
              onClick={handleRetry}
              className={cn(
                "stg:w-full stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
                "stg:border stg:border-input stg:bg-background stg:text-foreground",
                "stg:hover:bg-accent stg:hover:text-accent-foreground",
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
        <div className="stg:border-t stg:border-border stg:px-3 stg:py-2">
          <div className="stg:rounded-md stg:border stg:border-border stg:bg-muted/50 stg:px-2.5 stg:py-2 stg:text-[0.7rem] stg:text-muted-foreground">
            No workflow definition changes are needed. Check the analysis above for remediation steps.
          </div>
        </div>
      )}

      {/* Follow-up composer (pinned to bottom) */}
      <div className="stg:border-t stg:border-border stg:p-3">
        <textarea
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask a follow-up question..."
          disabled={!composerEnabled}
          rows={2}
          className={cn(
            "stg:w-full stg:resize-none stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <div className="stg:mt-2 stg:flex stg:items-center stg:justify-between">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            {"\u2318"}+Enter to send
          </p>
          <button
            type="button"
            onClick={handleSendFollowUp}
            disabled={!composerEnabled || followUp.trim().length < 5}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
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
    <div className="stg:border-t stg:border-border stg:px-3 stg:py-3" aria-live="polite">
      {/* Explanation */}
      {explanation && (
        <div className="stg:mb-3">
          <h4 className="stg:mb-1 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
            Suggested Fix
          </h4>
          <p className="stg:text-xs stg:leading-relaxed stg:text-foreground">
            {explanation}
          </p>
        </div>
      )}

      {/* Visual graph diff */}
      {hasChanges && beforeYaml && (
        <div className="stg:mb-3">
          <div className="stg:h-[200px] stg:overflow-hidden stg:rounded-md stg:border stg:border-border">
            <WorkflowDiffGraph
              beforeYaml={beforeYaml}
              afterYaml={extractedYaml}
            />
          </div>
        </div>
      )}

      {/* Collapsible YAML diff toggle */}
      {hasChanges && diffLines && (
        <div className="stg:mb-3">
          <button
            type="button"
            onClick={() => setShowYamlDiff((v) => !v)}
            className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:hover:text-foreground"
          >
            {showYamlDiff ? "▾ Hide YAML diff" : "▸ View YAML diff"}
          </button>
          {showYamlDiff && (
            <div className="stg:mt-1">
              <DiffPreview lines={diffLines} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="stg:flex stg:gap-2">
        {onApplyFix && (
          <button
            type="button"
            onClick={onApplyFix}
            className={cn(
              "stg:flex-1 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Apply Fix
          </button>
        )}
        <button
          type="button"
          onClick={onDiscard}
          className={cn(
            "stg:flex-1 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
            "stg:border stg:border-input stg:bg-background stg:text-foreground",
            "stg:hover:bg-accent stg:hover:text-accent-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
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
      <p className="stg:text-[0.7rem] stg:text-muted-foreground">
        Diff is too large to display. Apply the fix to see the updated YAML.
      </p>
    );
  }

  return (
    <pre className="stg:max-h-60 stg:overflow-auto stg:rounded-md stg:border stg:border-border stg:text-[0.7rem] stg:leading-relaxed">
      {lines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "stg:px-2",
            line.type === "added" && "stg:bg-success/10 stg:text-success",
            line.type === "removed" && "stg:bg-destructive/10 stg:text-destructive",
            line.type === "equal" && "stg:text-muted-foreground",
          )}
        >
          <span className="stg:mr-2 stg:inline-block stg:w-3 stg:select-none stg:text-right stg:opacity-60">
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
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
