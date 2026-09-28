/**
 * OAuth-app copy shared by more than one surface, so the settings section
 * and anything else that lists an organization's OAuth apps say the same
 * thing.
 *
 * OAuth apps are administrative infrastructure: an app carries its
 * organization's vendor credentials and endpoints, so the organization's
 * admins see and manage it and other members may not see it at all
 * (stigmer/stigmer#1257). An empty list is therefore not evidence that none
 * is configured, so a caller who may not create OAuth apps is told who
 * manages them instead of being told that nothing exists.
 */

/** Shown in place of the empty state to a caller who may not create OAuth apps. */
export const OAUTH_APPS_MANAGED_BY_ADMINS =
  "OAuth apps are managed by your organization's admins.";
