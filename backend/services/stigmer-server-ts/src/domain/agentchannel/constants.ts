/**
 * AgentChannel domain constants — the byte-pinned wire copy shared with
 * the Go server and the cloud edition. The three cloud-only refusal
 * strings ARE the OSS contract (engineered refusals, not gaps — asserted
 * by the conformance suite where channelMessaging is false); none is
 * editable without an owner-ratified wire change.
 */

/**
 * FailedPrecondition copy for the install lane (T02 §0-b, the documented
 * OSS posture) — Go install.go installUnavailableMessage: this edition
 * has no webhook receiver and no delivery runtime, so an installed
 * channel could never serve traffic; an honest refusal beats a
 * half-connected install.
 */
export const INSTALL_UNAVAILABLE_MESSAGE = "channel installs require Stigmer Cloud";

/**
 * FailedPrecondition copy for the messaging surface (proactive-messaging
 * DD-002/DD-003) — Go message.go proactiveMessagingUnavailableMessage.
 */
export const PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE =
  "proactive channel messaging requires Stigmer Cloud";

/**
 * FailedPrecondition copy for the conversation participation surface
 * (channel-conversations DD-003 D-f) — Go conversation.go
 * conversationParticipationUnavailableMessage.
 */
export const CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE =
  "conversation participation requires Stigmer Cloud";

/**
 * NotFound copy for getMediaDownloadUrl — Go conversation.go, raw status
 * text because the "%s not found: %s" helper shape cannot say it.
 * Byte-identical with the cloud handler's uniform miss (which covers
 * every cause the same way so a prober cannot learn which items exist).
 */
export const NO_DOWNLOADABLE_MEDIA_MESSAGE = "no downloadable media at this timeline item";

/** InvalidArgument copy when metadata.org is absent — Go, byte-pinned. */
export const ORG_REQUIRED_MESSAGE = "metadata.org is required for an agent channel";

/** InvalidArgument copy when spec.agent_ref.slug is absent — Go, pinned. */
export const AGENT_REF_SLUG_REQUIRED_MESSAGE = "spec.agent_ref.slug is required";

/**
 * FailedPrecondition copy for the same-org invariant — Go
 * resolveChannelDefaultsStep, byte-pinned. Unlike shares (decision 013),
 * channels have NO cross-org arm: the channel's org is the billing org
 * and the credentials org, and both must be the agent's (decision 004).
 */
export function sameOrgInvariantMessage(refOrg: string): string {
  return (
    "spec.agent_ref.org must match metadata.org — an agent channel must " +
    `live in the referenced agent's organization (${refOrg})`
  );
}

/**
 * InvalidArgument copy for a WhatsApp channel without an app binding
 * (DD-WA-2: WhatsApp is BYO-only) — Go, byte-pinned; enforced in the
 * defaults resolver, not a field-level CEL, because the rule conditions
 * on the oneof case.
 */
export const APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE =
  "spec.app_ref is required for WhatsApp channels — register your Meta app " +
  "as a channel app and reference it";

/**
 * FailedPrecondition copy for a cross-org app_ref (secrets never cross
 * orgs — the T06 invariant applied to app credentials) — Go, byte-pinned.
 */
export const APP_REF_SAME_ORG_MESSAGE =
  "spec.app_ref.org must match metadata.org — a channel can only install " +
  "through its own organization's channel app";

/**
 * FailedPrecondition copy for rebinding an INSTALLED channel's app — Go
 * validateAppRefUpdate, byte-pinned. Pending and revoked channels rebind
 * freely; the installed freeze exists because the workspace granted THAT
 * app and the stored bot token belongs to it.
 */
export const APP_REF_FROZEN_WHILE_INSTALLED_MESSAGE =
  "spec.app_ref cannot change while the channel is installed — the " +
  "workspace authorized the current app; uninstall or disconnect first, " +
  "then rebind and re-install";

/**
 * FailedPrecondition copy for an agent_ref change on update — Go
 * validateChannelUpdateStep, byte-pinned.
 */
export function agentRefImmutableMessage(org: string, slug: string): string {
  return (
    `spec.agent_ref is immutable (channel connects ${org}/${slug}) — ` +
    "create a new channel to connect a different agent"
  );
}

/**
 * FailedPrecondition copy for a provider-arm change on update — Go
 * validateChannelUpdateStep, byte-pinned. Deliberately a DIFFERENT code
 * than channelapp's provider rule (FailedPrecondition here vs
 * InvalidArgument there) — a pinned cross-domain inconsistency both
 * editions share; harmonization is a post-cutover wire change.
 */
export function providerImmutableMessage(existingProvider: string): string {
  return (
    `spec provider is immutable (channel provider is ${existingProvider}) — ` +
    "create a new channel for a different provider"
  );
}
