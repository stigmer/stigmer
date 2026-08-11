"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { useRefineWorkflowFlow, type RefinePhase } from "./useRefineWorkflowFlow.js";
import { MessageThread } from "../execution/MessageThread.js";
import { computeUnifiedDiff, type DiffLine } from "./workflow-yaml-diff.js";
import { WorkflowDiffGraph } from "./WorkflowDiffGraph.js";

/** Props for {@link WorkflowRefinePanel}. */
export interface WorkflowRefinePanelProps {
  /** Organization slug for refinement context. */
  readonly org: string;
  /** Current workflow YAML from the editor. */
  readonly currentYaml: string;
  /** Called when the user accepts a refinement. Receives the updated YAML. */
  readonly onAccept: (yaml: string) => void;
  /** Called when the panel should close. */
  readonly onClose: () => void;
  /**
   * When provided, auto-sends this instruction on mount (e.g. from "Fix with AI").
   * Consumed once — subsequent renders with the same value are ignored.
   */
  readonly initialInstruction?: string;
  /** Additional CSS class names. */
  readonly className?: string;
}

const COMPOSER_ENABLED_PHASES: ReadonlySet<RefinePhase> = new Set([
  "idle",
  "ready",
  "complete",
  "error",
]);

/**
 * Side panel for agent-powered iterative workflow refinement.
 *
 * Renders inside the editor's right pane (replacing the topology graph
 * in code mode, or as a sidebar in visual mode). Layout:
 *
 * 1. **Header** — title + close button
 * 2. **MessageThread** — streaming agent conversation (all turns)
 * 3. **Result strip** — diff preview + accept/discard (when YAML extracted)
 * 4. **Composer** — textarea + send button (pinned to bottom)
 *
 * Powered by the Workflow Architect system agent via
 * {@link useRefineWorkflowFlow}. Styled via `--stgm-*` design tokens.
 * Zero console dependencies (DD-004).
 */
export function WorkflowRefinePanel({
  org,
  currentYaml,
  onAccept,
  onClose,
  initialInstruction,
  className,
}: WorkflowRefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const didAutoSendRef = useRef(false);

  const flow = useRefineWorkflowFlow({
    org,
    currentYaml,
    onError: () => {
      /* Error is displayed inline via flow.error */
    },
  });

  // Auto-send initial instruction (e.g. from "Fix with AI")
  const { sendInstruction: flowSendInstruction, phase } = flow;
  if (initialInstruction && !didAutoSendRef.current && phase === "idle") {
    didAutoSendRef.current = true;
    // Schedule the send after the current render cycle
    Promise.resolve().then(() => flowSendInstruction(initialInstruction));
  }

  const composerEnabled = COMPOSER_ENABLED_PHASES.has(flow.phase);
  const hasConversation =
    flow.completedExecutions.length > 0 || flow.activeExecution !== null;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleSend = useCallback(async () => {
    const trimmed = instruction.trim();
    if (trimmed.length < 5) return;

    setInstruction("");
    await flow.sendInstruction(trimmed);

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [flow.sendInstruction, instruction]);

  const handleAccept = useCallback(() => {
    const yaml = flow.acceptResult();
    if (yaml) {
      onAccept(yaml);
    }
  }, [flow.acceptResult, onAccept]);

  const handleDiscard = useCallback(() => {
    flow.discardResult();
  }, [flow.discardResult]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className={cn(
        "stg:flex stg:h-full stg:flex-col stg:border-l stg:border-border stg:bg-background",
        className,
      )}
      role="complementary"
      aria-label="Workflow refinement panel"
    >
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-1.5">
          <SparklesIcon />
          <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">
            Refine with AI
          </h3>
          {flow.isStreaming && (
            <span className="stg:inline-flex stg:items-center stg:gap-1 stg:text-[0.65rem] stg:text-muted-foreground">
              <SpinnerIcon size={10} />
              Working…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="stg:rounded stg:p-0.5 stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground"
          aria-label="Close refinement panel"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Scrollable content area */}
      <div ref={scrollRef} className="stg:flex stg:min-h-0 stg:flex-1 stg:flex-col stg:overflow-y-auto">
        {/* Empty state */}
        {!hasConversation && flow.phase === "idle" && (
          <div className="stg:flex stg:flex-1 stg:flex-col stg:items-center stg:justify-center stg:gap-2 stg:px-4 stg:py-8 stg:text-center">
            <SparklesIcon />
            <p className="stg:text-xs stg:text-muted-foreground">
              Describe the changes you want and the Workflow Architect agent
              will refine your workflow definition.
            </p>
          </div>
        )}

        {/* Starting indicator (before stream connects) */}
        {flow.phase === "starting" && (
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
            pendingUserMessage={
              flow.phase === "starting" ? instruction || undefined : undefined
            }
            className="stg:flex-1"
          />
        )}

        {/* Error */}
        {flow.error && flow.phase === "error" && (
          <div
            className="stg:mx-3 stg:mt-3 stg:rounded-md stg:border stg:border-destructive/30 stg:bg-destructive/5 stg:px-3 stg:py-2 stg:text-xs stg:text-destructive"
            role="alert"
          >
            {flow.error}
          </div>
        )}
      </div>

      {/* Result strip (diff + accept/discard) */}
      {flow.phase === "complete" && flow.extractedYaml && (
        <ResultStrip
          extractedYaml={flow.extractedYaml}
          explanation={flow.explanation}
          beforeYaml={currentYaml}
          onAccept={handleAccept}
          onDiscard={handleDiscard}
        />
      )}

      {/* Composer (pinned to bottom) */}
      <div className="stg:border-t stg:border-border stg:p-3">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to change?"
          disabled={!composerEnabled}
          rows={3}
          className={cn(
            "stg:w-full stg:resize-none stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-sm stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <div className="stg:mt-2 stg:flex stg:items-center stg:justify-between">
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            {"\u2318"}+Enter to submit
          </p>
          <button
            type="button"
            onClick={handleSend}
            disabled={!composerEnabled || instruction.trim().length < 5}
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
// Result Strip — diff preview with accept/discard actions
// ---------------------------------------------------------------------------

function ResultStrip({
  extractedYaml,
  explanation,
  beforeYaml,
  onAccept,
  onDiscard,
}: {
  readonly extractedYaml: string;
  readonly explanation: string | null;
  readonly beforeYaml: string;
  readonly onAccept: () => void;
  readonly onDiscard: () => void;
}) {
  const [showYamlDiff, setShowYamlDiff] = useState(false);
  const diffLines = computeUnifiedDiff(beforeYaml, extractedYaml);
  const hasChanges = diffLines.some((l) => l.type !== "equal");

  return (
    <div
      className="stg:border-t stg:border-border stg:px-3 stg:py-3"
      aria-live="polite"
    >
      {/* Explanation */}
      {explanation && (
        <div className="stg:mb-3">
          <h4 className="stg:mb-1 stg:text-[0.65rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
            Changes
          </h4>
          <p className="stg:text-xs stg:leading-relaxed stg:text-foreground">
            {explanation}
          </p>
        </div>
      )}

      {/* Visual graph diff */}
      {hasChanges && (
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
      {hasChanges && (
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
        <button
          type="button"
          onClick={onAccept}
          className={cn(
            "stg:flex-1 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        >
          Accept
        </button>
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
        Diff is too large to display. Accept to see the updated YAML.
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
