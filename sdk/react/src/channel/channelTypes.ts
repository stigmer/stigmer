// The channel types an agent's Channels tab lists and adds, in display
// order: a chat link (the `web` type), then the vendors.
//
// Every channel shares one card frame and one Add affordance; a type
// supplies only what differs: its label and icon, the word its delete
// uses, and how adding one starts. Vendor facts (install style, template
// registry, staff replies) stay on `ChannelProviderDescriptor`, which
// a vendor entry here points at; a chat link has none of them, so it is a
// type without a provider rather than a provider whose flags all read "no".

import type { ComponentType } from "react";
import { Link } from "lucide-react";
import {
  CHANNEL_PROVIDERS,
  type ChannelProviderDescriptor,
  type ChannelProviderId,
} from "./providers.js";

/**
 * Identifier of a channel type — the `type` oneof case name on
 * `ChannelSpec`, the wire discriminator every channel surface switches on.
 */
export type ChannelTypeId = "web" | ChannelProviderId;

/** Display descriptor for one channel type. */
export interface ChannelTypeDescriptor {
  readonly id: ChannelTypeId;
  /** The type's name on a card and in the Add menu ("Chat link", "Slack"). */
  readonly label: string;
  /** The type's mark; consumers size it via className. */
  readonly Icon: ComponentType<{ readonly className?: string }>;
  /**
   * The empty state's button text for adding one ("Create a chat link",
   * "Connect to Slack").
   */
  readonly addLabel: string;
  /**
   * The stable `data-cursor-target` of this type's add affordance, the
   * same on the empty state's button and the Add menu's item, so the docs
   * demos find it either way.
   */
  readonly addCursorTarget: string;
  /**
   * The word the card's destructive action uses: a chat link is deleted;
   * a vendor channel is disconnected, which also removes its stored
   * install.
   */
  readonly deleteLabel: string;
  /** The vendor behind this type, or `null` for a chat link. */
  readonly provider: ChannelProviderDescriptor | null;
}

/** The chat link's type: a hosted link to the agent, made in Stigmer. */
export const CHAT_LINK_TYPE: ChannelTypeDescriptor = {
  id: "web",
  label: "Chat link",
  Icon: Link,
  addLabel: "Create a chat link",
  addCursorTarget: "add-chat-link",
  deleteLabel: "Delete",
  provider: null,
};

/** Every channel type this UI can list and add, in display order. */
export const CHANNEL_TYPES: readonly ChannelTypeDescriptor[] = [
  CHAT_LINK_TYPE,
  ...CHANNEL_PROVIDERS.map(
    (provider): ChannelTypeDescriptor => ({
      id: provider.id,
      label: provider.label,
      Icon: provider.Icon,
      addLabel: `Connect to ${provider.label}`,
      addCursorTarget: `connect-${provider.id}`,
      deleteLabel: "Disconnect",
      provider,
    }),
  ),
];

/**
 * Resolve a type descriptor from a `ChannelSpec.type` oneof case name.
 *
 * Returns `null` for unknown cases (a newer server returning a type this
 * UI doesn't know yet); callers fall back rather than render a half-known
 * type.
 */
export function channelTypeOf(
  typeCase: string | undefined,
): ChannelTypeDescriptor | null {
  return CHANNEL_TYPES.find((t) => t.id === typeCase) ?? null;
}
