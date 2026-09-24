/**
 * Identity-provider copy shared by more than one surface, so the settings
 * list and the organization profile summary say the same thing.
 *
 * Identity providers are administrative infrastructure: an organization's
 * admins (and each provider's creator) manage them, and other members may
 * not see them at all. An empty list is therefore not evidence that none is
 * configured, so a caller who may not create providers is told who manages
 * them instead of being told that nothing exists.
 */

/** Shown in place of the empty state to a caller who may not create identity providers. */
export const IDENTITY_PROVIDERS_MANAGED_BY_ADMINS =
  "Identity providers are managed by your organization's admins.";
