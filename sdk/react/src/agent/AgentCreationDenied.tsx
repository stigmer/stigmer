"use client";

import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link AgentCreationDenied}. */
export interface AgentCreationDeniedProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * What a person who may not create agents sees where the create flow would
 * be: who can, and the setting that lets them. Rendered by
 * {@link AgentCreationWizard} on its own, and by a host's new-agent page in
 * place of its creation picker.
 */
export function AgentCreationDenied({ className }: AgentCreationDeniedProps) {
  return (
    <EmptyState
      variant="permission"
      title="Only admins can create agents here"
      description="Ask an admin to turn on 'Members can create agents'."
      className={className}
    />
  );
}
