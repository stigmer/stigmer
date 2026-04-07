"use client";

import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";

/** Props for {@link ExecutionPhaseBadge}. */
export interface ExecutionPhaseBadgeProps {
  /** The execution phase to display. */
  readonly phase: ExecutionPhase;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

interface PhaseConfig {
  readonly label: string;
  readonly icon: () => React.JSX.Element;
  readonly colorClass: string;
}

const PHASE_CONFIG: ReadonlyMap<ExecutionPhase, PhaseConfig> = new Map([
  [
    ExecutionPhase.EXECUTION_PENDING,
    {
      label: "Pending",
      icon: PulseDotIcon,
      colorClass: "text-muted-foreground",
    },
  ],
  [
    ExecutionPhase.EXECUTION_IN_PROGRESS,
    {
      label: "Running",
      icon: PulseDotIcon,
      colorClass: "text-foreground",
    },
  ],
  [
    ExecutionPhase.EXECUTION_COMPLETED,
    {
      label: "Completed",
      icon: CheckIcon,
      colorClass: "text-success",
    },
  ],
  [
    ExecutionPhase.EXECUTION_FAILED,
    {
      label: "Failed",
      icon: XIcon,
      colorClass: "text-destructive",
    },
  ],
  [
    ExecutionPhase.EXECUTION_CANCELLED,
    {
      label: "Cancelled",
      icon: XIcon,
      colorClass: "text-muted-foreground",
    },
  ],
  [
    ExecutionPhase.EXECUTION_TERMINATED,
    {
      label: "Terminated",
      icon: StopIcon,
      colorClass: "text-destructive",
    },
  ],
  [
    ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    {
      label: "Waiting for approval",
      icon: ClockIcon,
      colorClass: "text-warning",
    },
  ],
  [
    ExecutionPhase.EXECUTION_PAUSED,
    {
      label: "Paused",
      icon: PauseIcon,
      colorClass: "text-muted-foreground",
    },
  ],
]);

/**
 * Displays the lifecycle phase of an `AgentExecution` as an
 * inline badge with a status icon and label.
 *
 * Renders nothing for `EXECUTION_PHASE_UNSPECIFIED`.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <ExecutionPhaseBadge phase={ExecutionPhase.EXECUTION_COMPLETED} />
 * ```
 */
export function ExecutionPhaseBadge({
  phase,
  className,
}: ExecutionPhaseBadgeProps) {
  const config = PHASE_CONFIG.get(phase);
  if (!config) return null;

  const Icon = config.icon;

  return (
    <span
      role="status"
      aria-label={config.label}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
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
}

function DotIcon() {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="currentColor"
    >
      <circle cx="4" cy="4" r="3" />
    </svg>
  );
}

function PulseDotIcon() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
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

function ClockIcon() {
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
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
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
