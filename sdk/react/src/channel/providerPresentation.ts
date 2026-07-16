import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import type { ChannelProviderId } from "./providers.js";

/**
 * Per-provider copy for the channel management surfaces.
 *
 * Split from {@link ChannelProviderDescriptor} deliberately: the registry
 * carries a provider's *identity* (id, label, icon, install style) —
 * stable facts every surface needs — while this module carries the
 * *prose* the channels panel renders per provider. Keeping prose out of
 * the descriptor keeps the registry declaration-shaped, and keeping it
 * here keeps `AgentChannelsPanel` free of provider `if` branches.
 */
export interface ChannelProviderPresentation {
  readonly id: ChannelProviderId;
  /**
   * One-line install facts under the channel name (the card's second
   * line): where the channel is installed, since when, or why it isn't
   * serving yet.
   */
  readonly describeChannel: (channel: AgentChannel) => string;
  /**
   * The card's serving-app line: which provider app serves the channel
   * and how members reach the agent through it. `servingAppName` is the
   * resolved ChannelApp name, or `null` for the platform app (Slack
   * only — WhatsApp is BYO-only and always has one).
   */
  readonly servingLine: (servingAppName: string | null) => string;
  /** Body copy of the disconnect confirmation prompt. */
  readonly disconnectDescription: (channelName: string) => string;
}

const slackPresentation: ChannelProviderPresentation = {
  id: "slack",
  describeChannel: (channel) => {
    const slack =
      channel.status?.providerStatus?.case === "slack"
        ? channel.status.providerStatus.value
        : null;
    const installedAt = slack?.installedAt
      ? timestampDate(slack.installedAt)
      : null;
    switch (installStateOf(channel)) {
      case AgentChannelInstallState.installed:
        return [
          slack?.teamName ? `Workspace: ${slack.teamName}` : "Workspace connected",
          installedAt ? `since ${formatDate(installedAt)}` : null,
        ]
          .filter(Boolean)
          .join(" \u00b7 ");
      case AgentChannelInstallState.revoked:
        return slack?.teamName
          ? `The Slack app was removed from ${slack.teamName} — reconnect to resume.`
          : "The Slack app was removed from the workspace — reconnect to resume.";
      default:
        return "The Slack install hasn't been completed yet.";
    }
  },
  servingLine: (servingAppName) =>
    servingAppName
      ? `Serving app: ${servingAppName} (your app) — members @mention ${servingAppName}`
      : "Serving app: Stigmer — members @mention Stigmer",
  disconnectDescription: (channelName) =>
    `"${channelName}" stops serving immediately and its stored Slack ` +
    "install (including credentials) is removed. Members of the " +
    "workspace can no longer reach the agent. To pause without " +
    "disconnecting, turn the channel off instead.",
};

const whatsappPresentation: ChannelProviderPresentation = {
  id: "whatsapp",
  describeChannel: (channel) => {
    const whatsapp =
      channel.status?.providerStatus?.case === "whatsapp"
        ? channel.status.providerStatus.value
        : null;
    const installedAt = whatsapp?.installedAt
      ? timestampDate(whatsapp.installedAt)
      : null;
    switch (installStateOf(channel)) {
      case AgentChannelInstallState.installed: {
        const number =
          whatsapp?.displayPhoneNumber || whatsapp?.phoneNumberId || null;
        return [
          number ? `Number: ${number}` : "Number connected",
          whatsapp?.verifiedName ? `(${whatsapp.verifiedName})` : null,
          installedAt ? `since ${formatDate(installedAt)}` : null,
        ]
          .filter(Boolean)
          .join(" \u00b7 ");
      }
      // Meta emits no revocation events (DD-010), so WhatsApp channels
      // never transition to revoked today — handled anyway so a future
      // server that learns to observe revocation degrades sensibly.
      case AgentChannelInstallState.revoked:
        return "The WhatsApp connection was revoked — reconnect to resume.";
      default:
        return "The WhatsApp connection hasn't been completed yet.";
    }
  },
  servingLine: (servingAppName) =>
    servingAppName
      ? `Serving app: ${servingAppName} (your Meta app) — people message the connected number`
      : "Serving app: your Meta app — people message the connected number",
  disconnectDescription: (channelName) =>
    // No "(including credentials)" arm: WhatsApp credentials live on the
    // shared ChannelApp (DD-WA-3) and outlive any one channel.
    `"${channelName}" stops serving immediately and its WhatsApp ` +
    "number binding is removed. People can no longer reach the agent " +
    "on that number. To pause without disconnecting, turn the channel " +
    "off instead.",
};

const PRESENTATIONS: readonly ChannelProviderPresentation[] = [
  slackPresentation,
  whatsappPresentation,
];

/**
 * Fallback presentation for provider cases this UI doesn't know yet (a
 * newer server) — the first registered provider, mirroring the panel's
 * icon fallback to `CHANNEL_PROVIDERS[0]` so an unknown provider renders
 * consistently rather than half-known.
 */
export const DEFAULT_CHANNEL_PRESENTATION: ChannelProviderPresentation =
  slackPresentation;

/**
 * Resolve a provider's presentation from a `provider_config` oneof case
 * name. Returns `null` for unknown cases — callers fall back the same
 * way they do for {@link channelProviderOf}.
 */
export function channelPresentationOf(
  providerCase: string | undefined,
): ChannelProviderPresentation | null {
  return PRESENTATIONS.find((p) => p.id === providerCase) ?? null;
}

function installStateOf(channel: AgentChannel): AgentChannelInstallState {
  return (
    channel.status?.installState ??
    AgentChannelInstallState.agent_channel_install_state_unspecified
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
