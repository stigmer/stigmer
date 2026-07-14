"use client";

import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link AgentInstanceEmptyState}. */
export interface AgentInstanceEmptyStateProps {
  /** Called when the user clicks "Create instance". */
  readonly onCreateClick?: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Empty state shown in the Instances tab when no user-created instances exist.
 *
 * Communicates the value proposition of agent instances without mentioning
 * the platform-managed default instance (an implementation detail). For
 * agents, an instance is a reusable, environment-bound deployment you can
 * start sessions against — and share with your team.
 *
 * A thin composition over the shared {@link EmptyState} primitive: only the
 * icon and copy are specific to agent instances.
 */
export function AgentInstanceEmptyState({
  onCreateClick,
  className,
}: AgentInstanceEmptyStateProps) {
  return (
    <EmptyState
      variant="first-use"
      icon={<LayersIcon />}
      title="No instances yet"
      description={
        "Create instances to start sessions with this agent using different " +
        "credentials and settings. Each instance binds environments (secrets, " +
        "configuration) and can be shared with your team independently."
      }
      action={
        onCreateClick
          ? { label: "Create instance", onClick: onCreateClick, icon: <PlusIcon /> }
          : undefined
      }
      className={className}
    />
  );
}

function LayersIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2L2 6l8 4 8-4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
