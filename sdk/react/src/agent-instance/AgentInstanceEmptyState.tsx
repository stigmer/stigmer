"use client";

import { cn } from "@stigmer/theme";

/** Props for {@link AgentInstanceEmptyState}. */
export interface AgentInstanceEmptyStateProps {
  /** Called when the user clicks "Create Instance". */
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
 */
export function AgentInstanceEmptyState({
  onCreateClick,
  className,
}: AgentInstanceEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-muted p-3">
        <LayersIcon />
      </div>

      <h3 className="text-sm font-semibold text-foreground mb-1">
        No instances yet
      </h3>

      <p className="text-sm text-muted-foreground max-w-sm mb-6">
        Create instances to start sessions with this agent using different
        credentials and settings. Each instance binds environments (secrets,
        configuration) and can be shared with your team independently.
      </p>

      {onCreateClick && (
        <button
          type="button"
          onClick={onCreateClick}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
            "text-sm font-medium",
            "bg-primary text-primary-foreground",
            "hover:bg-primary/90",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          )}
        >
          <PlusIcon />
          Create Instance
        </button>
      )}
    </div>
  );
}

function LayersIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2L2 6l8 4 8-4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-muted-foreground"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
