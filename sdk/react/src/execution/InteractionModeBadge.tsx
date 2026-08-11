"use client";

import { memo } from "react";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link InteractionModeBadge}. */
export interface InteractionModeBadgeProps {
  /** The interaction mode to display. */
  readonly mode: InteractionMode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays the interaction mode of an execution as a compact inline badge.
 *
 * Only renders for non-default modes (PLAN). Returns `null` for AGENT
 * and UNSPECIFIED since agent mode is the default and does not need
 * visual distinction.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <InteractionModeBadge mode={InteractionMode.PLAN} />
 * ```
 */
export const InteractionModeBadge = memo(function InteractionModeBadge({
  mode,
  className,
}: InteractionModeBadgeProps) {
  if (
    mode !== InteractionMode.PLAN
  ) {
    return null;
  }

  return (
    <span
      role="status"
      aria-label="Plan mode"
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-1.5 stg:py-0.5 stg:text-[0.65rem] stg:font-medium",
        "stg:bg-accent stg:text-muted-foreground",
        className,
      )}
    >
      <PlanIcon />
      Plan
    </span>
  );
});

function PlanIcon() {
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
    >
      <path d="M2 3h8M2 6h5M2 9h6" />
    </svg>
  );
}
