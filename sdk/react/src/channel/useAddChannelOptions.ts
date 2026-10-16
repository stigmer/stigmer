"use client";

// The behaviour behind an agent's "Add channel" affordance, headless: for
// every channel type, whether this viewer can add one here, how adding it
// starts, and, when they cannot, why in words a UI can show. The Channels
// panel renders it; a platform builder with their own UI asks the same
// questions and gets the same answers.
//
// Three facts decide it: the create bar (useCanCreateChannel, one bar for
// every type), the edition (channelInstallsAvailable: vendor installs need
// the hosted delivery runtime), and the host's external hand-off for
// redirect-style installs (a desktop webview that cannot open a popup hands
// Slack's OAuth to the system browser, where the web console has the
// runtime).

import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import { CHANNEL_TYPES, type ChannelTypeDescriptor } from "./channelTypes.js";
import { channelInstallsAvailable } from "./providers.js";
import { useCanCreateChannel } from "./useCanCreateChannel.js";

/** Why a channel type cannot be added here. */
export const ADD_CHANNEL_NEEDS_PERMISSION =
  "Needs an organization admin who owns this agent";
/** Why a vendor channel cannot be connected on this edition. */
export const ADD_CHANNEL_NEEDS_CLOUD = "Needs Stigmer Cloud";

/** One channel type the viewer may (or may not) add to the agent. */
export interface AddChannelOption {
  /** The channel type. */
  readonly type: ChannelTypeDescriptor;
  /** Whether adding this type here would be accepted. */
  readonly available: boolean;
  /**
   * How adding starts when available: `"dialog"` runs in this surface (the
   * chat-link dialog, or the vendor's connect dialog); `"external"` hands
   * the install to the host's `onConnectExternal`. `null` when unavailable.
   */
  readonly via: "dialog" | "external" | null;
  /** Why not, in a sentence a UI can show; `null` when available. */
  readonly reason: string | null;
}

/** Options for {@link useAddChannelOptions}. */
export interface UseAddChannelOptionsOptions {
  /**
   * The host's hand-off for redirect-style installs (Slack), as on
   * `ChannelsPanel`. When given, a Slack connect runs through it on every
   * edition, because the host's other surface has the runtime.
   */
  readonly onConnectExternal?: (channel: Channel | null) => void;
}

/** Return value of {@link useAddChannelOptions}. */
export interface UseAddChannelOptionsReturn {
  /**
   * Whether the viewer may add any channel to this agent: the server's
   * create bar. When `false`, hosts hide the Add affordance entirely.
   */
  readonly canAdd: boolean;
  /** Every channel type, in display order, with its availability. */
  readonly options: readonly AddChannelOption[];
}

/**
 * Behaviour hook for adding a channel to an agent: one option per channel
 * type (a chat link, Slack, WhatsApp), each saying whether this viewer can
 * add it here and why not.
 *
 * - A chat link needs only the create bar; it works in every edition.
 * - A vendor channel also needs the hosted delivery runtime
 *   ({@link channelInstallsAvailable}), unless the host hands a
 *   redirect-style install off through `onConnectExternal`.
 *
 * Pass `null` for `agent` while it loads; every option stays unavailable
 * so no affordance flashes before the bar is evaluated.
 *
 * @param agent The agent to add a channel to, or `null` while loading.
 */
export function useAddChannelOptions(
  agent: Agent | null,
  options: UseAddChannelOptionsOptions = {},
): UseAddChannelOptionsReturn {
  const { onConnectExternal } = options;
  const { allowed: canAdd } = useCanCreateChannel(agent);
  const installsAvailable = channelInstallsAvailable(useDeploymentMode());
  const hasExternal = onConnectExternal !== undefined;

  return useMemo(
    () => ({
      canAdd,
      options: CHANNEL_TYPES.map((type) =>
        optionFor(type, canAdd, installsAvailable, hasExternal),
      ),
    }),
    [canAdd, installsAvailable, hasExternal],
  );
}

function optionFor(
  type: ChannelTypeDescriptor,
  canAdd: boolean,
  installsAvailable: boolean,
  hasExternal: boolean,
): AddChannelOption {
  if (!canAdd) {
    return { type, available: false, via: null, reason: ADD_CHANNEL_NEEDS_PERMISSION };
  }
  const provider = type.provider;
  if (provider === null) {
    return { type, available: true, via: "dialog", reason: null };
  }
  // A redirect-style install hands off to the host whenever it can: the
  // host gave the delegate because its own surface cannot run the popup.
  if (provider.installStyle === "redirect" && hasExternal) {
    return { type, available: true, via: "external", reason: null };
  }
  if (installsAvailable) {
    return { type, available: true, via: "dialog", reason: null };
  }
  return { type, available: false, via: null, reason: ADD_CHANNEL_NEEDS_CLOUD };
}
