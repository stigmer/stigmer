"use client";

import { memo } from "react";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { cn } from "@stigmer/design-tokens";
import { Tag } from "../internal/surface/Tag.js";

/** Props for {@link InteractionModeBadge}. */
export interface InteractionModeBadgeProps {
  /** The interaction mode to display. */
  readonly mode: InteractionMode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays the interaction mode of a run as the kit's neutral `Tag`
 * ("Plan"), drawn inline so it reads before the message's first line.
 *
 * Only renders for non-default modes (PLAN). Returns `null` for AGENT
 * and UNSPECIFIED since agent mode is the default and does not need
 * visual distinction. Its accessible name is "Plan mode".
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
 *
 * <InteractionModeBadge mode={InteractionMode.PLAN} />;
 * ```
 */
export const InteractionModeBadge = memo(function InteractionModeBadge({
  mode,
  className,
}: InteractionModeBadgeProps) {
  if (mode !== InteractionMode.PLAN) {
    return null;
  }

  return (
    <Tag role="status" aria-label="Plan mode" className={cn("stg:me-2 stg:align-middle", className)}>
      Plan
    </Tag>
  );
});
