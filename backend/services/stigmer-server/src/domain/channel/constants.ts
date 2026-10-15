/**
 * Channel domain constants: the wire copy of the channel's refusals, shared
 * with the cloud edition. Every string here is asserted by the conformance
 * suite or the cross-edition error contract; none is editable without a
 * deliberate wire change. The three "requires Stigmer Cloud" strings ARE
 * the open-source contract for a Slack or WhatsApp channel's runtime
 * (engineered refusals, not gaps, asserted where channelMessaging is
 * false).
 */

/**
 * FailedPrecondition copy for a Slack or WhatsApp channel's install lane
 * (the documented open-source posture): this edition has no webhook
 * receiver and no delivery runtime, so an installed channel could never
 * serve traffic; an honest refusal beats a half-connected install.
 */
export const INSTALL_UNAVAILABLE_MESSAGE = "channel installs require Stigmer Cloud";

/** FailedPrecondition copy for the messaging surface. */
export const PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE =
  "proactive channel messaging requires Stigmer Cloud";

/** FailedPrecondition copy for the conversation participation surface. */
export const CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE =
  "conversation participation requires Stigmer Cloud";

/**
 * NotFound copy for getMediaDownloadUrl, raw status text because the
 * "%s not found: %s" helper shape cannot say it. Byte-identical with the
 * cloud handler's uniform miss (which covers every cause the same way so a
 * prober cannot learn which items exist).
 */
export const NO_DOWNLOADABLE_MEDIA_MESSAGE = "no downloadable media at this timeline item";

/**
 * FailedPrecondition copy for an install RPC on a web channel: a chat link
 * has nothing to install.
 */
export const INSTALL_NOT_APPLICABLE_MESSAGE =
  "a web channel has nothing to install — installs are for Slack and WhatsApp channels";

/**
 * FailedPrecondition copy for rotateLink on a Slack or WhatsApp channel: only
 * a web channel has a link.
 */
export const ROTATE_LINK_NOT_APPLICABLE_MESSAGE =
  "only a web channel has a link to rotate";

/**
 * Entropy behind a rotated link: 20 bytes, 27 url-safe base64 characters.
 * Comfortably beyond guessability for a rate-limited public endpoint while
 * keeping the chat link short.
 */
export const LINK_TOKEN_BYTES = 20;

/**
 * InvalidArgument copy when metadata.org is absent. The channel's org is
 * the billing org and the credentials org, so it can never be inferred.
 */
export const ORG_REQUIRED_MESSAGE = "metadata.org is required for a channel";

/** InvalidArgument copy when spec.agent_ref names no agent, by slug or by id. */
export const AGENT_REF_REQUIRED_MESSAGE = "spec.agent_ref is required";

/**
 * FailedPrecondition copy when spec.agent_ref names another organization's
 * agent. A channel offers an agent its own organization owns, billed to
 * that organization, with credentials bound from it; to offer another
 * organization's agent, install the plugin that carries it and make a
 * channel for the installed copy.
 */
export function sameOrgInvariantMessage(refOrg: string): string {
  return (
    "spec.agent_ref.org must match metadata.org — a channel must live in " +
    `the referenced agent's organization (${refOrg})`
  );
}

/**
 * InvalidArgument copy for a WhatsApp channel without an app binding
 * (WhatsApp installs only through the organization's own Meta app),
 * enforced in the defaults step, not a field-level rule, so the refusal
 * says what to do.
 */
export const APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE =
  "spec.whatsapp.app_ref is required for WhatsApp channels — register your " +
  "Meta app as a channel app and reference it";

/**
 * FailedPrecondition copy for a cross-org app_ref (secrets never cross
 * orgs, applied to app credentials). `arm` is the channel's type field
 * (slack or whatsapp), the path the manifest wrote.
 */
export function appRefSameOrgMessage(arm: string): string {
  return (
    `spec.${arm}.app_ref.org must match metadata.org — a channel can only ` +
    "install through its own organization's channel app"
  );
}

/**
 * FailedPrecondition copy for rebinding an installed channel's app.
 * Pending and revoked channels rebind freely; the installed freeze exists
 * because the workspace granted that app and the stored bot token belongs
 * to it.
 */
export function appRefFrozenWhileInstalledMessage(arm: string): string {
  return (
    `spec.${arm}.app_ref cannot change while the channel is installed — ` +
    "the workspace authorized the current app; uninstall or disconnect " +
    "first, then rebind and re-install"
  );
}

/**
 * FailedPrecondition copy for an agent_ref change on update: a channel
 * serves one agent; re-pointing it would silently move its traffic and
 * its billing.
 */
export function agentRefImmutableMessage(org: string, slug: string): string {
  return (
    `spec.agent_ref is immutable (channel serves ${org}/${slug}) — ` +
    "create a new channel for a different agent"
  );
}

/**
 * FailedPrecondition copy for a type change on update: the link token,
 * the install state, credentials and delivery records are all type-shaped.
 */
export function typeImmutableMessage(existingType: string): string {
  return (
    `spec type is immutable (channel type is ${existingType}) — ` +
    "create a new channel of a different type"
  );
}
