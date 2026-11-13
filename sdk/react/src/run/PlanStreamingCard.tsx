"use client";

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
import { PlanCard } from "./PlanCard.js";

/** Props for {@link PlanStreamingCard}. */
export interface PlanStreamingCardProps {
  /**
   * The plan's title (its leading `# H1`), streaming in live. Falls back to
   * "Plan" until the title has arrived (the subline says "Writing the plan…").
   */
  readonly title?: string;
  /**
   * Live size of the plan text streamed so far (UTF-16 length, not encoded
   * bytes). The card no longer draws it: its subline says only that the plan
   * is being written. Kept so existing callers compile.
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
 * The live counterpart of {@link PlanFileCard}: a streaming Plan turn's
 * stand-in in the thread while the plan document renders live in the
 * session panel's plan tab. It is the same plan card (list glyph, title,
 * subline, acts) so the completion handoff reads as the same card settling,
 * not a new element appearing.
 *
 * The subline says "Writing the plan…", pulsing (still where the person
 * asked for reduced motion), and names no File: the plan File's name is
 * derived from the plan's title, which is still streaming in, so a name
 * shown here would change under the user when the plan settles. The title
 * reads "Plan" until the plan's own title has streamed in.
 *
 * Deliberately action-light: Open is the only act. Download and Build
 * require the plan File, which does not exist until the turn completes — at
 * which point `buildThreadItems` swaps this item for the `plan-completion`
 * item under the same list key.
 *
 * All visual properties flow through `--stgm-*` tokens; the component is
 * self-contained and embeddable.
 */
export const PlanStreamingCard = memo(function PlanStreamingCard({
  title,
  onOpenPlan,
  className,
}: PlanStreamingCardProps) {
  return (
    <PlanCard
      role="region"
      aria-label="Plan being written"
      aria-busy="true"
      state="writing"
      title={title ?? "Plan"}
      open={onOpenPlan === undefined ? undefined : { label: "Open plan", onClick: onOpenPlan }}
      className={cn("stg:mx-4", className)}
    />
  );
});
