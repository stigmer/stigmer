"use client";

import { memo } from "react";
import { cn } from "@stigmer/design-tokens";
import { PlanCard } from "./PlanCard.js";
import { useBuildFromPlanHotkey } from "./use-build-from-plan-hotkey.js";

/** Props for {@link PlanCompletionCard}. */
export interface PlanCompletionCardProps {
  /** Called when the user clicks the "Build" button. */
  readonly onImplement?: () => void;
  /** Disables the CTA button (e.g., while a run is active). */
  readonly disabled?: boolean;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The Build card shown in the {@link MessageThread} after a completed
 * Plan-mode run that did **not** return a `plan.md` File (older runs, or a
 * plan whose upload failed): the plan is held only as message text. When
 * the plan File exists, `PlanFileCard` is shown instead.
 *
 * Drawn as the thread's one plan card in its no-File state: the list glyph,
 * "Plan", and **Build**, the one primary, with the same card-scoped
 * `Cmd/Ctrl+Enter` accelerator as `PlanFileCard`. The ready card's Build
 * says what the old "ready to build?" line asked. The consumer wires the
 * action to switch the interaction mode to Agent and submit the implement
 * turn. A host that can put Build on the plan's own text passes
 * `onImplement` to `PlanDocumentMessage` instead, so the plan shows once.
 *
 * Renders nothing when `onImplement` is not provided, so the card is fully
 * opt-in from the consumer's perspective. All visual properties flow through
 * `--stgm-*` tokens.
 */
export const PlanCompletionCard = memo(function PlanCompletionCard({
  onImplement,
  disabled,
  className,
}: PlanCompletionCardProps) {
  const handleKeyDown = useBuildFromPlanHotkey(onImplement, disabled);

  if (!onImplement) return null;

  return (
    <PlanCard
      role="status"
      aria-label="Plan complete"
      onKeyDown={handleKeyDown}
      state="text"
      title="Plan"
      build={{ onClick: onImplement, disabled }}
      className={cn("stg:mx-4", className)}
    />
  );
});
