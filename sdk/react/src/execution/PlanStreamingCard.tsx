"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import { formatArtifactSize } from "./artifact-utils.js";

/** Props for {@link PlanStreamingCard}. */
export interface PlanStreamingCardProps {
  /**
   * The plan's title (its leading `# H1`), streaming in live. Falls back to
   * "Writing plan…" until the title has arrived.
   */
  readonly title?: string;
  /**
   * Live size of the plan text streamed so far. An approximation (UTF-16
   * length, not encoded bytes) — it exists to show growth while the agent
   * writes, not to state the artifact's final size.
   */
  readonly sizeBytes: number;
  /**
   * Opens the panel's plan document tab, where the plan is rendering live.
   * Always provided in practice: the thread only collapses a streaming plan
   * behind this card when the host wired `onOpenPlan` (see `MessageThread`'s
   * `collapseStreamingPlan` gate) — without a document surface there is
   * nothing for the card to open, and the plan streams inline instead.
   */
  readonly onOpenPlan?: () => void;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The live counterpart of {@link PlanArtifactCard} — a streaming Plan turn's
 * compact stand-in in the thread while the plan document renders live in the
 * session panel's plan tab. Same anatomy as the completed card (icon, title,
 * a `Writing… · size` meta, trailing actions) so the completion handoff reads
 * as the same card settling, not a new element appearing.
 *
 * The meta line deliberately omits a filename: the artifact's name is derived
 * from the plan's title, which is still streaming in, so a name shown here
 * would change under the user when the plan settles. The completed card
 * introduces the final `<slug>_<id>.plan.md` name once it exists.
 *
 * Deliberately action-light: "Open plan" is the only affordance. Download and
 * Build require the published artifact, which does not exist until the turn
 * completes — at which point `buildThreadItems` swaps this item for the
 * `plan-completion` item under the same list key.
 *
 * The pulsing icon is the progress affordance: a CSS animation inside `.stgm`,
 * covered by the stylesheet's global `prefers-reduced-motion` rule (DD-015),
 * and safe under virtualization (no `@starting-style`).
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanStreamingCard = memo(function PlanStreamingCard({
  title,
  sizeBytes,
  onOpenPlan,
  className,
}: PlanStreamingCardProps) {
  return (
    <div
      role="region"
      aria-label="Plan being written"
      aria-busy="true"
      className={cn(
        "mx-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg",
        "border border-border-muted bg-card px-3 py-2.5",
        className,
      )}
    >
      <PlanIcon className="animate-pulse" />
      <div className="min-w-0 flex-1 basis-48">
        <div className="truncate text-sm font-medium text-foreground">
          {title ?? "Writing plan…"}
        </div>
        <div className="text-[0.65rem] text-muted-foreground-faint">
          <span role="status">Writing…</span>
          <span aria-hidden="true"> · </span>
          <span className="tabular-nums">{formatArtifactSize(sizeBytes)}</span>
        </div>
      </div>

      {onOpenPlan && (
        <button
          type="button"
          onClick={onOpenPlan}
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm",
          )}
        >
          <EyeIcon />
          Open plan
        </button>
      )}
    </div>
  );
});

function PlanIcon({ className }: { readonly className?: string }) {
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
      className={cn("shrink-0 text-muted-foreground-faint", className)}
      aria-hidden="true"
    >
      <path d="M3 4h10M3 8h7M3 12h8" />
      <path d="M12.5 10.5l1.5 1.5-1.5 1.5" />
    </svg>
  );
}

/** An eye glyph — "view/open the plan to read it" (matches PlanArtifactCard). */
function EyeIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M1.5 8S4 3.5 8 3.5s6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}
