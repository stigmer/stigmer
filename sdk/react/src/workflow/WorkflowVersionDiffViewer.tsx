"use client";

import { cn } from "@stigmer/theme";
import { useWorkflowVersionDiff } from "./useWorkflowVersionDiff.js";
import type { DiffLine } from "./workflow-yaml-diff.js";

/** Props for {@link WorkflowVersionDiffViewer}. */
export interface WorkflowVersionDiffViewerProps {
  /** Workflow resource ID. */
  readonly workflowId: string;
  /** "Before" version hash. */
  readonly hashA: string;
  /** "After" version hash. */
  readonly hashB: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Shows a unified diff between two workflow versions' YAML.
 *
 * Internally uses `useWorkflowVersionDiff(workflowId, hashA, hashB)` to
 * fetch and compute the diff. Renders a header identifying each version
 * and a scrollable unified diff with green/red line highlighting.
 *
 * All visual properties flow through `--stgm-*` / `--stgm-diff-*` design
 * tokens. Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <WorkflowVersionDiffViewer
 *   workflowId="wf_123"
 *   hashA="a1b2c3d4..."
 *   hashB="e5f6g7h8..."
 * />
 * ```
 */
export function WorkflowVersionDiffViewer({
  workflowId,
  hashA,
  hashB,
  className,
}: WorkflowVersionDiffViewerProps) {
  const { diff, isLoading, error } = useWorkflowVersionDiff(workflowId, hashA, hashB);

  if (isLoading) {
    return <DiffSkeleton className={className} />;
  }

  if (error) {
    return (
      <div
        role="alert"
        className={cn(
          "stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive/5 stg:px-4 stg:py-3 stg:text-sm stg:text-destructive",
          className,
        )}
      >
        Failed to load diff: {error.message}
      </div>
    );
  }

  if (!diff || diff.length === 0) {
    return (
      <div
        role="status"
        className={cn(
          "stg:flex stg:items-center stg:justify-center stg:rounded-lg stg:border stg:border-border stg:py-8 stg:text-sm stg:text-muted-foreground",
          className,
        )}
      >
        No changes between these versions
      </div>
    );
  }

  return (
    <div
      className={cn(
        "stg:overflow-auto stg:rounded-lg stg:border stg:border-border stg:font-mono stg:text-[13px] stg:leading-[1.6]",
        className,
      )}
    >
      {/* Header */}
      <div className="stg:sticky stg:top-0 stg:z-10 stg:flex stg:items-center stg:gap-2 stg:border-b stg:border-border stg:bg-muted stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-muted-foreground">
        <code className="stg:rounded stg:bg-diff-removed-bg stg:px-1 stg:py-0.5">{hashA.slice(0, 8)}</code>
        <ArrowIcon className="stg:size-3 stg:shrink-0" />
        <code className="stg:rounded stg:bg-diff-added-bg stg:px-1 stg:py-0.5">{hashB.slice(0, 8)}</code>
      </div>

      {/* Diff content */}
      <table className="stg:w-full stg:border-collapse" role="table">
        <thead className="stg:sr-only">
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Change</th>
            <th scope="col">Content</th>
          </tr>
        </thead>
        <tbody>
          {diff.map((line, idx) => (
            <DiffLineRow key={idx} line={line} lineNumber={idx + 1} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diff line rendering
// ---------------------------------------------------------------------------

const LINE_NUM_CLASSES =
  "stg:w-[1px] stg:min-w-8 stg:select-none stg:whitespace-nowrap stg:px-2 stg:text-right stg:text-[11px] stg:text-muted-foreground-faint";
const MARKER_CLASSES = "stg:w-[1px] stg:select-none stg:px-1 stg:text-center";

function DiffLineRow({
  line,
  lineNumber,
}: {
  readonly line: DiffLine;
  readonly lineNumber: number;
}) {
  const marker = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

  const rowClass =
    line.type === "added"
      ? "stg:bg-diff-added-bg"
      : line.type === "removed"
        ? "stg:bg-diff-removed-bg"
        : "";

  const markerColor =
    line.type === "added"
      ? "stg:text-diff-added-fg"
      : line.type === "removed"
        ? "stg:text-diff-removed-fg"
        : "stg:text-muted-foreground-faint";

  const ariaLabel =
    line.type === "added"
      ? `Added: ${line.content}`
      : line.type === "removed"
        ? `Removed: ${line.content}`
        : undefined;

  return (
    <tr className={rowClass} aria-label={ariaLabel}>
      <td className={LINE_NUM_CLASSES}>{lineNumber}</td>
      <td className={cn(MARKER_CLASSES, markerColor)} aria-hidden="true">
        {marker}
      </td>
      <td className="stg:whitespace-pre-wrap stg:break-all stg:px-2">{line.content}</td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function DiffSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn(
        "stg:overflow-hidden stg:rounded-lg stg:border stg:border-border",
        className,
      )}
      aria-busy="true"
      aria-label="Loading diff"
    >
      <div className="stg:border-b stg:border-border stg:bg-muted stg:px-3 stg:py-2">
        <div className="stg:h-4 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted-foreground/20" />
      </div>
      <div className="stg:space-y-1 stg:p-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="stg:flex stg:gap-2">
            <div className="stg:h-4 stg:w-6 stg:animate-pulse stg:rounded stg:bg-muted" />
            <div
              className="stg:h-4 stg:animate-pulse stg:rounded stg:bg-muted"
              style={{ width: `${40 + (i % 3) * 20}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ArrowIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}
