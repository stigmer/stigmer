"use client";

import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link SkillCreationDenied}. */
export interface SkillCreationDeniedProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * What a person who may not upload skills sees where the upload would be:
 * only the organization's admins upload them (`can_create_skill`). Rendered
 * by a host's upload-skill page for a direct visit; the Skills list never
 * offers the way there to such a person.
 */
export function SkillCreationDenied({ className }: SkillCreationDeniedProps) {
  return (
    <EmptyState
      variant="permission"
      title="Only admins can upload skills here"
      description="Ask an admin of this organization to add the know-how your agents need."
      className={className}
    />
  );
}
