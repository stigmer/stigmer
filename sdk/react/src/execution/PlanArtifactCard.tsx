"use client";

import { memo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { ExecutionArtifact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { ArtifactPreviewModal } from "./ArtifactPreviewModal.js";
import { formatArtifactSize } from "./artifact-utils.js";
import { useArtifactDownload } from "./useArtifactDownload.js";
import { useBuildFromPlanHotkey } from "./use-build-from-plan-hotkey.js";

/** Props for {@link PlanArtifactCard}. */
export interface PlanArtifactCardProps {
  /** Execution that produced the plan — used to fetch the plan content. */
  readonly executionId: string;
  /** The published `plan.md` artifact (from `findPlanArtifact`). */
  readonly artifact: ExecutionArtifact;
  /**
   * Organization slug. Required for the "Open full" modal (the shared
   * {@link ArtifactPreviewModal} uses it for its detection/apply pipeline and
   * to fetch the content). When omitted, "Open full" is hidden — the prominent
   * "Build from plan" action and "Download" remain.
   */
  readonly org?: string;
  /** Called when the user clicks "Build from plan". Hidden when omitted. */
  readonly onImplement?: () => void;
  /** Disables the primary CTA (e.g., while an execution is active). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Action surface for a plan that a completed Plan-mode execution published as a
 * `plan.md` artifact.
 *
 * It is rendered immediately below the plan message in the thread (which already
 * shows the plan as rich markdown — the message renderer unwraps a model's
 * enclosing markdown fence), so this card deliberately holds **no** plan
 * content: the message is the document and this is its action bar. Rendering
 * the plan a second time here would duplicate the same text the message and the
 * "Open full" modal already show.
 *
 * The hierarchy is the point: one prominent, themeable primary action —
 * **Build from plan** — with **Open full** and **Download** as subdued
 * secondaries, so the next step is unmistakable. A small negative top margin
 * pulls the bar against the plan message so the two read as a single
 * first-class plan block.
 *
 * Kept as its own thread item (not merged into the message) on purpose: merging
 * would change the streamed message item's identity at completion and remount
 * the just-streamed plan. Adjacent-and-attached gets the unified look with no
 * remount.
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
  const handleKeyDown = useBuildFromPlanHotkey(onImplement, disabled);
  const { download, isDownloading } = useArtifactDownload(executionId);

  return (
    <div
      role="region"
      aria-label="Plan actions"
      onKeyDown={handleKeyDown}
      className={cn(
        // `-mt-2` tightens the thread's `gap-4` so the bar attaches to the
        // plan message above it, reading as one first-class plan block.
        "mx-4 -mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md",
        "border border-border-muted bg-muted-faint px-3 py-2",
        className,
      )}
    >
      <PlanIcon />
      <span className="text-xs font-medium text-foreground">Plan</span>
      <span className="text-xs tabular-nums text-muted-foreground-faint">
        {formatArtifactSize(artifact.sizeBytes)}
      </span>

      <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {org && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              FOCUS_RING,
            )}
          >
            <ExpandIcon />
            Open full
          </button>
        )}
        <button
          type="button"
          onClick={() => download(artifact.storageKey, artifact.name)}
          disabled={isDownloading}
          className={cn(
            "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50",
            FOCUS_RING,
          )}
        >
          <DownloadIcon />
          {isDownloading ? "Preparing…" : "Download"}
        </button>
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
            Build from plan
          </button>
        )}
      </div>

      {/* "Open full" reuses the shared artifact preview popup — the single place
          that fetches/renders plan content (with Copy + Source/Rendered). */}
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
