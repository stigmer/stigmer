"use client";

import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link EnvironmentCreationDenied}. */
export interface EnvironmentCreationDeniedProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * What a person who may not create Environments sees where the create form
 * would be: only the organization's admins create them. Rendered by a
 * host's new-environment page for a direct visit; the list never offers
 * the way there to such a person.
 */
export function EnvironmentCreationDenied({ className }: EnvironmentCreationDeniedProps) {
  return (
    <EmptyState
      variant="permission"
      title="Only admins can create environments here"
      description="Ask an admin of this organization to create the environment you need."
      className={className}
    />
  );
}
