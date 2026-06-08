"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { useArtifactContent } from "./useArtifactContent";
import { ArtifactContentRenderer } from "./ArtifactContentRenderer";
import { formatArtifactSize } from "./artifact-utils";

/** Plans above this size are not inlined for preview — download instead. */
const MAX_PREVIEW_BYTES = 512 * 1024;

/** Props for {@link PlanArtifactCard}. */
export interface PlanArtifactCardProps {
  /** Execution that produced the plan — used to fetch the plan content. */
  readonly executionId: string;
  /** The published `plan.md` artifact (from `findPlanArtifact`). */
  readonly artifact: ExecutionArtifact;
  /** Called when the user clicks "Implement". Hidden when omitted. */
  readonly onImplement?: () => void;
  /** Disables the Implement CTA (e.g., while an execution is active). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Reviewable card shown after a completed Plan-mode execution when the agent
 * published a `plan.md` artifact.
 *
 * Unlike {@link PlanCompletionCard} (a bare Implement CTA), this card makes the
 * plan a first-class, durable object: expand to review the rendered plan, copy
 * it, download the `plan.md` file, or proceed to implement. The plan content is
 * the single source of truth (the published artifact), fetched on demand via
 * {@link useArtifactContent} rather than duplicated into component state.
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanArtifactCard = memo(function PlanArtifactCard({
  executionId,
  artifact,
  onImplement,
  disabled,
  className,
}: PlanArtifactCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Plans are small markdown; fetch eagerly (within the size cap) so both the
  // preview and Copy have content ready. contentHash invalidates the cache when
  // the plan is re-published in the same execution.
  const fetchable = Number(artifact.sizeBytes) < MAX_PREVIEW_BYTES;
  const { content, contentType, isTruncated, isLoading } = useArtifactContent(
    fetchable ? executionId : null,
    fetchable ? artifact.storageKey : null,
    undefined,
    artifact.contentHash || undefined,
  );

  const handleCopy = useCallback(async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context / denied permission).
      // Silently no-op: Download remains available as the durable fallback.
    }
  }, [content]);

  return (
    <div
      role="region"
      aria-label="Plan ready to review"
      className={cn(
        "mx-4 overflow-hidden rounded-md border border-border-muted bg-muted-faint",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <PlanIcon />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-foreground">
            Plan ready to review
          </div>
          <div className="text-xs tabular-nums text-muted-foreground">
            {artifact.name} · {formatArtifactSize(artifact.sizeBytes)}
          </div>
        </div>
        {onImplement && (
          <button
            type="button"
            disabled={disabled}
            onClick={onImplement}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-xs font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <ImplementIcon />
            Implement
          </button>
        )}
      </div>

      {/* Secondary actions */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-muted px-3 py-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary-muted",
            FOCUS_RING,
          )}
        >
          <ChevronIcon expanded={expanded} />
          {expanded ? "Hide plan" : "Review plan"}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!content}
          className={cn(
            "text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            "disabled:pointer-events-none disabled:opacity-50",
            FOCUS_RING,
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <a
          href={artifact.downloadUrl}
          download={artifact.name}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            FOCUS_RING,
          )}
        >
          <DownloadIcon />
          Download
        </a>
      </div>

      {/* Expandable plan preview */}
      {expanded && (
        <div className="max-h-96 overflow-auto border-t border-border-muted px-3 py-2">
          {!fetchable ? (
            <p className="text-xs text-muted-foreground">
              This plan is large — use Download to view the full file.
            </p>
          ) : isLoading ? (
            <div className="h-4 w-40 animate-pulse rounded bg-muted" aria-hidden="true" />
          ) : content ? (
            <ArtifactContentRenderer
              content={content}
              fileName={artifact.name}
              contentType={contentType}
              isTruncated={isTruncated}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Plan content is unavailable. Use Download to retrieve the file.
            </p>
          )}
        </div>
      )}
    </div>
  );
});

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm";

function PlanIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground-faint"
      aria-hidden="true"
    >
      <path d="M3 4h10M3 8h7M3 12h8" />
      <path d="M12.5 10.5l1.5 1.5-1.5 1.5" />
    </svg>
  );
}

function ImplementIcon() {
  return (
    <svg
      width="12"
      height="12"
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

function DownloadIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M6 1.5V8.5" />
      <path d="M3 6L6 9L9 6" />
      <path d="M2 10.5H10" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0 transition-transform", expanded && "rotate-90")}
      aria-hidden="true"
    >
      <path d="M4 2l4 4-4 4" />
    </svg>
  );
}
