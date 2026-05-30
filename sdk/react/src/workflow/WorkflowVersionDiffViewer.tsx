"use client";

import { cn } from "@stigmer/theme";
import { useWorkflowVersionDiff } from "./useWorkflowVersionDiff";
import type { DiffLine } from "./workflow-yaml-diff";

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
          "rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive",
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
          "flex items-center justify-center rounded-lg border border-border py-8 text-sm text-muted-foreground",
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
        "overflow-auto rounded-lg border border-border font-mono text-[13px] leading-[1.6]",
        className,
      )}
    >
      {/* Header */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
        <code className="rounded bg-diff-removed-bg px-1 py-0.5">{hashA.slice(0, 8)}</code>
        <ArrowIcon className="size-3 shrink-0" />
        <code className="rounded bg-diff-added-bg px-1 py-0.5">{hashB.slice(0, 8)}</code>
      </div>

      {/* Diff content */}
      <table className="w-full border-collapse" role="table">
        <thead className="sr-only">
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
  "w-[1px] min-w-8 select-none whitespace-nowrap px-2 text-right text-[11px] text-muted-foreground-faint";
const MARKER_CLASSES = "w-[1px] select-none px-1 text-center";

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
      ? "bg-diff-added-bg"
      : line.type === "removed"
        ? "bg-diff-removed-bg"
        : "";

  const markerColor =
    line.type === "added"
      ? "text-diff-added-fg"
      : line.type === "removed"
        ? "text-diff-removed-fg"
        : "text-muted-foreground-faint";

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
      <td className="whitespace-pre-wrap break-all px-2">{line.content}</td>
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
        "overflow-hidden rounded-lg border border-border",
        className,
      )}
      aria-busy="true"
      aria-label="Loading diff"
    >
      <div className="border-b border-border bg-muted px-3 py-2">
        <div className="h-4 w-48 animate-pulse rounded bg-muted-foreground/20" />
      </div>
      <div className="space-y-1 p-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex gap-2">
            <div className="h-4 w-6 animate-pulse rounded bg-muted" />
            <div
              className="h-4 animate-pulse rounded bg-muted"
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
