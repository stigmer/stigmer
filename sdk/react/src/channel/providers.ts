import type { ComponentType } from "react";
import { SlackMarkIcon } from "./SlackMarkIcon.js";
import { WhatsAppMarkIcon } from "./WhatsAppMarkIcon.js";

/**
 * Identifier of a channel provider — matches the `provider_config` oneof
 * case name on `AgentChannelSpec` / `ChannelAppSpec`, which is the wire
 * discriminator every channel surface already switches on.
 */
export type ChannelProviderId = "slack" | "whatsapp";

/**
 * How a provider's install flow runs — the client-side hint for whether
 * connecting needs a browser popup.
 *
 * - `redirect`: an OAuth consent redirect (Slack). The client opens a
 *   popup synchronously inside the user gesture — before `initiateInstall`
 *   answers — because browsers only allow `window.open` from a gesture
 *   call stack.
 * - `direct`: `initiateInstall` runs the whole install server-side and
 *   answers `completed=true` (WhatsApp, DD-WA-1). No popup, no callback
 *   route; the client refetches the channel.
 *
 * The server's `InitiateChannelInstallOutput.completed` field stays the
 * authoritative outcome (DD-WA-1b) — this hint only decides whether to
 * pre-open a popup at all.
 */
export type ChannelInstallStyle = "redirect" | "direct";

/**
 * Display descriptor for a channel provider.
 *
 * The single place a provider's UI identity lives. Adding a provider
 * means adding a registry entry here (plus its presentation copy in
 * providerPresentation.tsx); consumers derive labels, icons, and connect
 * affordances from the registry instead of hardcoding a provider.
 */
export interface ChannelProviderDescriptor {
  readonly id: ChannelProviderId;
  /** Human-readable provider name ("Slack"). */
  readonly label: string;
  /** Brand mark; consumers size it via className. */
  readonly Icon: ComponentType<{ readonly className?: string }>;
  /** How this provider's install flow runs. */
  readonly installStyle: ChannelInstallStyle;
  /**
   * Whether this provider has a message-template registry the console
   * can list (`listTemplates`). Mirrors the server's proactive-sender
   * registry, which is the de-facto provider filter behind that RPC —
   * a provider with no registered sender answers `PROVIDER_UNSUPPORTED`.
   *
   * `false` for Slack is not a gap: Slack has no template concept at
   * all, so consumers hide the Templates affordance entirely rather
   * than disable it — a disabled item would falsely imply it may work
   * there one day.
   */
  readonly supportsMessageTemplates: boolean;
  /**
   * Whether staff can reply into and take over live conversations on
   * this provider. Mirrors the server's `ProactiveMessageSender`
   * registry — the same registry behind `reply`/`takeOver` refusing
   * senderless providers with FAILED_PRECONDITION ("this channel's
   * provider has no send lane for staff messages").
   *
   * Unlike templates, `false` here renders as DISABLED-with-explanation
   * rather than hidden: the send lane is a planned capability (the
   * suppression doors are already wired provider-blind server-side), so
   * the affordance should say why it is off, not pretend it cannot
   * exist. The server refusal stays the authoritative backstop.
   */
  readonly supportsStaffReplies: boolean;
  /**
   * Whether the conversation timeline includes the CUSTOMER's own
   * messages on this provider. Mirrors the cloud stitcher's inbound
   * sources: WhatsApp inbound rides a per-conversation event store;
   * Slack's inbound lane has no timeline source yet, so its timeline
   * shows only replies, sends, and internal events. Consumers render an
   * honest notice instead of a silently one-sided thread.
   */
  readonly timelineIncludesCustomerMessages: boolean;
}

/**
 * All channel providers this UI can render, in display order.
 *
 * With two providers the connect affordance renders as one visible
 * "Connect to {label}" button per provider — deliberately NOT a dropdown
 * menu: two options are clearer side by side (visibility over a hidden
 * menu), and each button keeps its own stable cursor target for the docs
 * demos. A third entry is the signal to fold these into a provider menu.
 */
export const CHANNEL_PROVIDERS: readonly ChannelProviderDescriptor[] = [
  {
    id: "slack",
    label: "Slack",
    Icon: SlackMarkIcon,
    installStyle: "redirect",
    supportsMessageTemplates: false,
    supportsStaffReplies: false,
    timelineIncludesCustomerMessages: false,
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    Icon: WhatsAppMarkIcon,
    installStyle: "direct",
    supportsMessageTemplates: true,
    supportsStaffReplies: true,
    timelineIncludesCustomerMessages: true,
  },
];

/**
 * Resolve a provider descriptor from a `provider_config` oneof case name.
 *
 * Returns `null` for unknown cases (e.g. a newer server returning a
 * provider this UI doesn't know yet) — callers hide or fall back rather
 * than render a half-known provider.
 */
export function channelProviderOf(
  providerCase: string | undefined,
): ChannelProviderDescriptor | null {
  return CHANNEL_PROVIDERS.find((p) => p.id === providerCase) ?? null;
}
