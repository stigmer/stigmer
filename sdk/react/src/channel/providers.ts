import type { ComponentType } from "react";
import type { DeploymentMode } from "@stigmer/client";
import { SlackMarkIcon } from "./SlackMarkIcon.js";
import { WhatsAppMarkIcon } from "./WhatsAppMarkIcon.js";

/**
 * Identifier of a channel provider — matches the `type` oneof case name
 * on `ChannelSpec` (its Slack and WhatsApp arms) and the `provider_config`
 * case name on `ChannelAppSpec`, the wire discriminators every channel
 * surface already switches on.
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
 *   answers `completed=true` (WhatsApp). No popup, no callback
 *   route; the client refetches the channel.
 *
 * The server's `InitiateChannelInstallOutput.completed` field stays the
 * authoritative outcome — this hint only decides whether to
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
 * These are the vendors a channel is installed into. A chat link (the
 * `web` type) is a channel too, but not a vendor: it has no install, no
 * template registry and no staff send lane, so it lives in the channel
 * type registry ({@link CHANNEL_TYPES}) beside these entries rather than
 * among them.
 *
 * With two providers, connecting once rendered as one visible "Connect
 * to {label}" button per provider, and a third type was the signal to fold
 * them into a menu. The chat link was that third type: a Channels tab with
 * channels listed offers one "Add channel" menu, while its empty state
 * keeps one visible button per type, where a newcomer chooses. Each
 * keeps its stable cursor target (`connect-<id>`) for the docs demos.
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
 * Resolve a provider descriptor from a `ChannelSpec.type` (or
 * `ChannelAppSpec.provider_config`) oneof case name.
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

/**
 * Whether the connected edition can install a channel into a vendor
 * (Slack, WhatsApp): the facility is the hosted webhook and delivery
 * runtime that receives the vendor's events and sends the agent's
 * replies, and only Stigmer Cloud composes one. Every channel surface
 * asks this one predicate, so the panel and the connect dialogs never
 * disagree. Channel configuration (create, edit, the on/off switch,
 * delete) needs no runtime and works in every edition, chat links
 * included.
 */
export function channelInstallsAvailable(mode: DeploymentMode): boolean {
  return mode === "cloud";
}
