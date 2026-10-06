"use client";

import { memo } from "react";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link WorkflowExecutionPhaseBadge}. */
export interface WorkflowExecutionPhaseBadgeProps {
  /** The workflow execution phase to display. */
  readonly phase: RunPhase;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

interface PhaseConfig {
  readonly label: string;
  readonly icon: () => React.JSX.Element;
  readonly colorClass: string;
}

const PHASE_CONFIG: ReadonlyMap<RunPhase, PhaseConfig> = new Map([
  [
    RunPhase.RUN_PENDING,
    {
      label: "Pending",
      icon: PulseDotIcon,
      colorClass: "stg:text-muted-foreground",
    },
  ],
  [
    RunPhase.RUN_IN_PROGRESS,
    {
      label: "Running",
      icon: PulseDotIcon,
      colorClass: "stg:text-foreground",
    },
  ],
  [
    RunPhase.RUN_COMPLETED,
    {
      label: "Completed",
      icon: CheckIcon,
      colorClass: "stg:text-success",
    },
  ],
  [
    RunPhase.RUN_FAILED,
    {
      label: "Failed",
      icon: XIcon,
      colorClass: "stg:text-destructive",
    },
  ],
  [
    RunPhase.RUN_CANCELLED,
    {
      label: "Cancelled",
      icon: XIcon,
      colorClass: "stg:text-muted-foreground",
    },
  ],
  [
    RunPhase.RUN_TERMINATED,
    {
      label: "Terminated",
      icon: StopIcon,
      colorClass: "stg:text-destructive",
    },
  ],
  [
    RunPhase.RUN_PAUSED,
    {
      label: "Paused",
      icon: PauseIcon,
      colorClass: "stg:text-muted-foreground",
    },
  ],
]);

/**
 * Displays the lifecycle phase of a `WorkflowExecution` as an
 * inline badge with a status icon and label.
 *
 * Renders nothing for `EXECUTION_PHASE_UNSPECIFIED`.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <WorkflowExecutionPhaseBadge phase={ExecutionPhase.EXECUTION_COMPLETED} />
 * ```
 */
export const WorkflowExecutionPhaseBadge = memo(function WorkflowExecutionPhaseBadge({
  phase,
  className,
}: WorkflowExecutionPhaseBadgeProps) {
  const config = PHASE_CONFIG.get(phase);
  if (!config) return null;

  const Icon = config.icon;

  return (
    <span
      role="status"
      aria-label={config.label}
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1.5 stg:text-xs stg:font-medium",
        config.colorClass,
        className,
      )}
    >
      <span aria-hidden="true">
        <Icon />
      </span>
      {config.label}
    </span>
  );
});

function PulseDotIcon() {
  return (
    <span className="stg:relative stg:flex stg:h-2 stg:w-2">
      <span className="stg:absolute stg:inline-flex stg:h-full stg:w-full stg:animate-ping stg:rounded-full stg:bg-current stg:opacity-75" />
      <span className="stg:relative stg:inline-flex stg:h-2 stg:w-2 stg:rounded-full stg:bg-current" />
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6L5 8.5L9.5 3.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3L9 9M9 3L3 9" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <rect x="2" y="2" width="8" height="8" rx="1" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="currentColor"
    >
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.5" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.5" />
    </svg>
  );
}
