/**
 * Identity-provider copy shared by more than one surface, so the settings
 * list and the organization profile summary say the same thing.
 *
 * Identity providers are administrative infrastructure: an organization's
 * admins manage them, and other members may
 * not see them at all. An empty list is therefore not evidence that none is
 * configured, so a caller who may not create providers is told who manages
 * them instead of being told that nothing exists.
 *
 * The expected audience is asked for the same way on every form. An
 * identity provider is identified by its issuer and its audience together,
 * so the value must be the organization's own registration at the issuer; a
 * placeholder that suggested one shared value would suggest the one value
 * another organization may already hold.
 */

/** Shown in place of the empty state to a caller who may not create identity providers. */
export const IDENTITY_PROVIDERS_MANAGED_BY_ADMINS =
  "Identity providers are managed by your organization's admins.";

/** The expected-audience field's placeholder: what kind of value, never a value to copy. */
export const EXPECTED_AUDIENCE_PLACEHOLDER = "API identifier or client ID";

/** The expected-audience field's hint. */
export const EXPECTED_AUDIENCE_HINT =
  "The aud claim your identity provider puts in tokens for Stigmer: an API identifier or client ID your organization registered there";
