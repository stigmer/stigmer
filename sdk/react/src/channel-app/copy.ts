/**
 * Channel-app copy shared by more than one surface, so the settings section
 * and anything else that lists an organization's channel apps say the same
 * thing.
 *
 * A channel app carries its organization's Slack or Meta app secrets, so the
 * model shows it to its creator, anyone granted viewer on it and the
 * organization's admins, and plain members and viewers may not see it at all
 * (stigmer/stigmer#1384). An empty list is therefore not evidence that none
 * is registered, so a caller who may not create channel apps is told who
 * manages them instead of being told that nothing exists.
 */

/** Shown in place of the empty state to a caller who may not create channel apps. */
export const CHANNEL_APPS_MANAGED_BY_ADMINS =
  "Channel apps are managed by your organization's admins.";
