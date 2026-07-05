"use client";

import { memo, useState, type ReactNode } from "react";
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
   * The plan's title (its leading `# H1`). The card is the plan's compact
   * stand-in in the thread, so the title is what makes it recognizable.
   * Falls back to "Plan" when omitted.
   */
  readonly title?: string;
  /**
   * Organization slug. Required for the open-in-modal fallback (the shared
   * {@link ArtifactPreviewModal} uses it for its detection/apply pipeline and
   * to fetch the content). When omitted, that fallback is hidden — the
   * prominent "Build" action and the download icon remain.
   */
  readonly org?: string;
  /** Called when the user clicks "Build". Hidden when omitted. */
  readonly onImplement?: () => void;
  /**
   * Opens the plan in the session panel's plan document tab — the
   * side-by-side review/refine surface. When provided it REPLACES the
   * modal-based open fallback (one review affordance, not two). When
   * omitted (hosts without a session panel) the same "Open plan" icon
   * opens the preview modal instead.
   */
  readonly onOpenPlan?: () => void;
  /** Disables the primary CTA (e.g., while an execution is active). */
  readonly disabled?: boolean;
  /** When true, the primary button reads "Starting build…" (upload in flight). */
  readonly buildPending?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The compact plan card — a completed Plan turn's sole representation in the
 * thread. The plan document itself lives in the session panel's plan tab
 * (`PlanEditor`), Cursor-style: chat carries a recognizable, actionable card;
 * the panel carries the document.
 *
 * Anatomy: a document-style identity block (plan icon, the plan's title, a
 * `plan.md · size` meta line) with the actions trailing — open and download
 * as icon-only secondaries (labelled via `aria-label`/`title`) and one
 * prominent, themeable primary, **Build** — so the next step is unmistakable.
 *
 * Action-label rule (shared with `PlanStreamingCard`, which keeps its
 * labelled "Open plan"): a lone secondary keeps its text label; a row of
 * secondaries competing with a primary collapses to icons, so the primary
 * carries the card's one visible verb.
 *
 * Only the LATEST plan's card carries `onImplement`; a superseded plan's card
 * is review-only (its `onOpenPlan` opens the document read-only), so a stale
 * plan can never be implemented by accident.
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanArtifactCard = memo(function PlanArtifactCard({
  executionId,
  artifact,
  title,
  org,
  onImplement,
  onOpenPlan,
  disabled,
  buildPending,
  className,
}: PlanArtifactCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const handleKeyDown = useBuildFromPlanHotkey(onImplement, disabled);
  const { download, isDownloading } = useArtifactDownload(executionId);

  return (
    <div
      role="region"
      aria-label="Plan"
      onKeyDown={handleKeyDown}
      className={cn(
        "mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg",
        "border border-border-muted bg-card px-3 py-2.5",
        className,
      )}
    >
      <PlanIcon />
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate text-sm font-medium text-foreground">
          {title ?? "Plan"}
        </div>
        <div className="text-[0.65rem] text-muted-foreground-faint">
          {artifact.name}
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">
            {formatArtifactSize(artifact.sizeBytes)}
          </span>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        {onOpenPlan ? (
          <IconAction
            label="Open plan"
            onClick={onOpenPlan}
            icon={<ExpandIcon />}
          />
        ) : (
          org && (
            <IconAction
              label="Open plan"
              onClick={() => setPreviewOpen(true)}
              icon={<ExpandIcon />}
            />
          )
        )}
        <IconAction
          label={isDownloading ? "Preparing…" : `Download ${artifact.name}`}
          onClick={() => download(artifact.storageKey, artifact.name)}
          disabled={isDownloading}
          icon={<DownloadIcon />}
        />
        {onImplement && (
          <button
            type="button"
            disabled={disabled}
            onClick={onImplement}
            className={cn(
              "ml-1.5 inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
              "text-xs font-medium transition-colors",
              "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <ImplementIcon />
            {buildPending ? "Starting build…" : "Build"}
          </button>
        )}
      </div>

      {/* The modal open fallback reuses the shared artifact preview popup —
          the single place that fetches/renders plan content (with Copy +
          Source/Rendered). */}
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

/**
 * An icon-only secondary action. The accessible name doubles as the hover
 * tooltip (native `title` — the codebase's tooltip pattern), and the padded
 * hit area keeps the target comfortable despite the compact glyph.
 */
function IconAction({
  label,
  onClick,
  icon,
  disabled,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center rounded-md p-1.5 text-muted-foreground",
        "transition-colors hover:bg-muted hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
        FOCUS_RING,
      )}
    >
      {icon}
    </button>
  );
}

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
      width="13"
      height="13"
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
      width="13"
      height="13"
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
