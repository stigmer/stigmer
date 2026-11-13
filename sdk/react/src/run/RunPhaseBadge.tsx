"use client";

import { memo } from "react";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { cn } from "@stigmer/design-tokens";
import { StatusBadge } from "../status/StatusBadge.js";
import type { StatusPhase } from "../resource-workbench/types.js";

/** Props for {@link RunPhaseBadge}. */
export interface RunPhaseBadgeProps {
  /** The run phase to display. */
  readonly phase: RunPhase;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

interface PhaseConfig {
  readonly label: string;
  readonly status: StatusPhase;
}

/** Each run phase as the console's status pill: its word, and the state it reads as. */
const PHASE_CONFIG: ReadonlyMap<RunPhase, PhaseConfig> = new Map([
  [RunPhase.RUN_PENDING, { label: "Pending", status: "pending" }],
  [RunPhase.RUN_IN_PROGRESS, { label: "Running", status: "running" }],
  [RunPhase.RUN_COMPLETED, { label: "Completed", status: "ready" }],
  [RunPhase.RUN_FAILED, { label: "Failed", status: "failed" }],
  [RunPhase.RUN_CANCELLED, { label: "Cancelled", status: "disabled" }],
  [RunPhase.RUN_TERMINATED, { label: "Terminated", status: "failed" }],
  [RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "Waiting for approval", status: "degraded" }],
  [RunPhase.RUN_PAUSED, { label: "Paused", status: "degraded" }],
]);

/**
 * Displays the lifecycle phase of a `Run` as the console's status pill
 * (`StatusBadge`): the phase in words beside a dot, on its state's tint,
 * announced as a status.
 *
 * Renders nothing for `RUN_PHASE_UNSPECIFIED`.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
 *
 * <RunPhaseBadge phase={RunPhase.RUN_COMPLETED} />;
 * ```
 */
export const RunPhaseBadge = memo(function RunPhaseBadge({
  phase,
  className,
}: RunPhaseBadgeProps) {
  const config = PHASE_CONFIG.get(phase);
  if (!config) return null;

  return (
    <span role="status" aria-label={config.label} className={cn("stg:inline-flex", className)}>
      <StatusBadge phase={config.status} label={config.label} />
    </span>
  );
});
