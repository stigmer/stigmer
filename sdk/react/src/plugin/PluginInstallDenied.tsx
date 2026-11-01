"use client";

// What a person who may not install plugins sees where an install flow
// would be: who can, instead of a form whose install the server would
// refuse at the end. Installing is an organization admin's act
// (`can_create_plugin`); `PluginUploader` draws this on its own for anyone
// else, and a host may draw it in place of any other install form.

import { EmptyState } from "../empty-state/EmptyState.js";

/** Props for {@link PluginInstallDenied}. */
export interface PluginInstallDeniedProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/** The notice in an install form's place: an admin of the organization installs plugins. */
export function PluginInstallDenied({ className }: PluginInstallDeniedProps) {
  return (
    <EmptyState
      variant="permission"
      title="Only admins install plugins here"
      description="Ask an admin of this organization to install the plugin; once installed, you can use it in your chats and agents."
      className={className}
    />
  );
}
