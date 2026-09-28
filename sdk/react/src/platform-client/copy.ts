/**
 * Platform-client copy shared by more than one surface, so the settings
 * section and anything else that lists an organization's platform clients
 * say the same thing.
 *
 * A platform client is a credential: its creator and the organization's
 * admins see it, and other members may not see it at all. An empty list is
 * therefore not evidence that none exists, so a caller who may not create
 * platform clients is told who manages them instead of being told that
 * nothing is configured (stigmer/stigmer#1302).
 */

/** Shown in place of the empty state to a caller who may not create platform clients. */
export const PLATFORM_CLIENTS_MANAGED_BY_ADMINS =
  "Platform clients are managed by your organization's admins.";
