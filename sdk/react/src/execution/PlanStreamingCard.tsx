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
        "stg:mx-4 stg:flex stg:flex-wrap stg:items-center stg:gap-x-3 stg:gap-y-2 stg:rounded-lg",
        "stg:border stg:border-border-muted stg:bg-card stg:px-3 stg:py-2.5",
        className,
      )}
    >
      <PlanIcon className="stg:animate-pulse" />
      <div className="stg:min-w-0 stg:flex-1 stg:basis-48">
        <div className="stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {title ?? "Writing plan…"}
        </div>
        <div className="stg:text-[0.65rem] stg:text-muted-foreground-faint">
          <span role="status">Writing…</span>
          <span aria-hidden="true"> · </span>
          <span className="stg:tabular-nums">{formatArtifactSize(sizeBytes)}</span>
        </div>
      </div>

      {onOpenPlan && (
        <button
          type="button"
          onClick={onOpenPlan}
          className={cn(
            "stg:ml-auto stg:inline-flex stg:items-center stg:gap-1 stg:text-xs stg:font-medium stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:focus-visible:rounded-sm",
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
      className={cn("stg:shrink-0 stg:text-muted-foreground-faint", className)}
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
      className="stg:shrink-0"
      aria-hidden="true"
    >
      <path d="M1.5 8S4 3.5 8 3.5s6.5 4.5 6.5 4.5-2.5 4.5-6.5 4.5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}
