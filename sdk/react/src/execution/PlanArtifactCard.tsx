"use client";

import { memo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ArtifactPreviewModal } from "./ArtifactPreviewModal";
import { formatArtifactSize } from "./artifact-utils";

/** Props for {@link PlanArtifactCard}. */
export interface PlanArtifactCardProps {
  /** Execution that produced the plan — used to fetch the plan content. */
  readonly executionId: string;
  /** The published `plan.md` artifact (from `findPlanArtifact`). */
  readonly artifact: ExecutionArtifact;
  /**
   * Organization slug. Required for the "Review plan" modal (the shared
   * {@link ArtifactPreviewModal} uses it for its detection/apply pipeline).
   * When omitted, the Review action is hidden — Implement and Download remain.
   */
  readonly org?: string;
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
 * Presentational by design: it surfaces the plan as a first-class object with
 * three actions — **Implement** (turn the plan into an Agent run), **Review
 * plan** (open the rendered plan in the shared {@link ArtifactPreviewModal},
 * the same popup used elsewhere for artifact previews — where Copy and an
 * Implement CTA also live), and **Download** the `plan.md` file. The plan text
 * is the single source of truth (the published artifact); the modal fetches it
 * on demand, so the card itself holds no plan content.
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanArtifactCard = memo(function PlanArtifactCard({
  executionId,
  artifact,
  org,
  onImplement,
  disabled,
  className,
}: PlanArtifactCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

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
        {org && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:text-primary-muted",
              FOCUS_RING,
            )}
          >
            <ExpandIcon />
            Review plan
          </button>
        )}
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

      {/* Review opens the shared artifact preview popup — consistent with the
          Artifacts tab and the single place that fetches/renders plan content. */}
      {org && previewOpen && (
        <ArtifactPreviewModal
          artifact={artifact}
          executionId={executionId}
          org={org}
          isTerminal
          open
          onClose={() => setPreviewOpen(false)}
          onImplement={onImplement}
        />
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

function ExpandIcon() {
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
      <path d="M7 1.5h3.5V5M10.5 1.5L6.5 5.5M5 10.5H1.5V7M1.5 10.5l4-4" />
    </svg>
  );
}
