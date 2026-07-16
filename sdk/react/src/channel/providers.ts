import type { ComponentType } from "react";
import { SlackMarkIcon } from "./SlackMarkIcon.js";

/**
 * Identifier of a channel provider — matches the `provider_config` oneof
 * case name on `AgentChannelSpec` / `ChannelAppSpec`, which is the wire
 * discriminator every channel surface already switches on.
 */
export type ChannelProviderId = "slack";

/**
 * Display descriptor for a channel provider.
 *
 * The single place a provider's UI identity lives. Adding a provider
 * (WhatsApp, T05) means adding a registry entry here; consumers derive
 * labels, icons, and provider menus from the registry instead of
 * hardcoding Slack.
 */
export interface ChannelProviderDescriptor {
  readonly id: ChannelProviderId;
  /** Human-readable provider name ("Slack"). */
  readonly label: string;
  /** Brand mark; consumers size it via className. */
  readonly Icon: ComponentType<{ readonly className?: string }>;
}

/**
 * All channel providers this UI can render, in display order.
 *
 * While the registry has a single entry, connect affordances render as a
 * direct "Connect to {label}" action (a one-option picker is noise —
 * Hick's law); a second entry is the signal for those affordances to
 * become a provider menu.
 */
export const CHANNEL_PROVIDERS: readonly ChannelProviderDescriptor[] = [
  { id: "slack", label: "Slack", Icon: SlackMarkIcon },
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
