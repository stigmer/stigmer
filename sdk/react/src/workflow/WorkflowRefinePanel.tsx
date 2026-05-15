"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  useRefineWorkflowFlow,
  type RefineWorkflowFlowResult,
  type RefinementHistoryEntry,
} from "./useRefineWorkflowFlow";
import { computeUnifiedDiff, type DiffLine } from "./workflow-yaml-diff";

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
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Side panel for iterative workflow refinement with AI.
 *
 * Renders inside the editor's right pane (replacing the topology graph in
 * code mode, or as a sidebar in visual mode). Layout from top to bottom:
 *
 * 1. **Header** — title + close button
 * 2. **History** — previous instruction/explanation turns (scrollable)
 * 3. **Input** — textarea for the refinement instruction + submit button
 * 4. **Result** — explanation, diff preview, warnings, accept/discard actions
 *
 * Styled via `--stgm-*` design tokens. Zero console dependencies (DD-004).
 */
export function WorkflowRefinePanel({
  org,
  currentYaml,
  onAccept,
  onClose,
  className,
}: WorkflowRefinePanelProps) {
  const [instruction, setInstruction] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const flow = useRefineWorkflowFlow({
    org,
    onError: () => {
      /* Error is displayed inline via flow.error */
    },
  });

  const handleRefine = useCallback(async () => {
    await flow.refine(instruction, currentYaml);
    setInstruction("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [flow, instruction, currentYaml]);

  const handleAccept = useCallback(() => {
    if (flow.result) {
      onAccept(flow.result.yaml);
      flow.reset();
    }
  }, [flow, onAccept]);

  const handleDiscard = useCallback(() => {
    flow.reset();
  }, [flow]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleRefine();
      }
    },
    [handleRefine],
  );

  return (
    <div
      className={cn(
        "flex h-full flex-col border-l border-border bg-background",
        className,
      )}
      role="complementary"
      aria-label="Workflow refinement panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <SparklesIcon />
          <h3 className="text-xs font-semibold text-foreground">Refine with AI</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close refinement panel"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Scrollable content area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* History */}
        {flow.history.length > 0 && (
          <HistorySection history={flow.history} />
        )}

        {/* Result (when available) */}
        {flow.result && (
          <ResultSection
            result={flow.result}
            beforeYaml={currentYaml}
            onAccept={handleAccept}
            onDiscard={handleDiscard}
          />
        )}

        {/* Error */}
        {flow.error && (
          <div className="mx-3 mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
            {flow.error}
          </div>
        )}

        {/* Refining spinner */}
        {flow.isRefining && (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <SpinnerIcon />
            <p className="text-xs text-muted-foreground">Refining workflow…</p>
          </div>
        )}
      </div>

      {/* Input area (pinned to bottom) */}
      <div className="border-t border-border p-3">
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to change?"
          disabled={flow.isRefining}
          rows={3}
          className={cn(
            "w-full resize-none rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[0.65rem] text-muted-foreground">
            {"\u2318"}+Enter to submit
          </p>
          <button
            type="button"
            onClick={handleRefine}
            disabled={flow.isRefining || instruction.trim().length < 5}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary/90",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {flow.isRefining && <SpinnerIcon size={12} />}
            Refine
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History Section
// ---------------------------------------------------------------------------

function HistorySection({
  history,
}: {
  readonly history: readonly RefinementHistoryEntry[];
}) {
  return (
    <div className="border-b border-border px-3 py-2">
      <p className="mb-1.5 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        History
      </p>
      <div className="flex flex-col gap-2">
        {history.map((entry, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-foreground">
              {entry.instruction}
            </div>
            <p className="px-1 text-[0.7rem] leading-relaxed text-muted-foreground">
              {entry.explanation}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result Section
// ---------------------------------------------------------------------------

function ResultSection({
  result,
  beforeYaml,
  onAccept,
  onDiscard,
}: {
  readonly result: RefineWorkflowFlowResult;
  readonly beforeYaml: string;
  readonly onAccept: () => void;
  readonly onDiscard: () => void;
}) {
  const diffLines = computeUnifiedDiff(beforeYaml, result.yaml);
  const hasChanges = diffLines.some((l) => l.type !== "equal");

  return (
    <div className="px-3 py-3" aria-live="polite">
      {/* Explanation */}
      <div className="mb-3">
        <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
          Changes
        </h4>
        <p className="text-xs leading-relaxed text-foreground">{result.explanation}</p>
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
      {hasChanges && (
        <div className="mb-3">
          <h4 className="mb-1 text-[0.65rem] font-medium uppercase tracking-wider text-muted-foreground">
            Diff
          </h4>
          <DiffPreview lines={diffLines} />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          className={cn(
            "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          Accept
        </button>
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
        Diff is too large to display. Accept to see the updated YAML.
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
