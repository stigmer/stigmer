"use client";

import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { useDeploymentMode } from "../deployment-mode.js";

/**
 * Whether a channel can answer a template-registry read
 * (`listTemplates`), and if not, which precondition fails first.
 *
 * - `cloud-only` — the deployment is not cloud; the template registry
 *   is part of the cloud channel runtime.
 * - `not-installed` — the provider install has not completed (covers
 *   both pending and revoked; render the per-provider
 *   `describeChannel` sentence, which already distinguishes them).
 * - `channel-off` — the owner's serving switch (`spec.enabled`) is off.
 * - `not-proactive` — `spec.proactive_messaging_enabled` is not set;
 *   business-initiated messaging (and with it the template surface)
 *   is not granted on this channel.
 * - `ready` — the read can be made.
 */
export type ChannelTemplateReadiness =
  | { readonly status: "cloud-only" }
  | { readonly status: "not-installed" }
  | { readonly status: "channel-off" }
  | { readonly status: "not-proactive" }
  | { readonly status: "ready" };

/**
 * Resolve whether a channel's template registry can be read, without a
 * network call — the courtesy pre-check for the Templates surface.
 *
 * Mirrors the server's own gate order for `listTemplates`
 * (`ChannelMessagingReach.resolveDirect`: installed → enabled →
 * proactive grant), answering from fields already on the fetched
 * {@link AgentChannel}. The server stays authoritative: a `ready`
 * verdict here only means the call is worth making, and whatever the
 * server then says wins.
 *
 * Two shape choices are deliberate. `channel-off` and `not-proactive`
 * are split although the server collapses them into one refusal —
 * their fixes differ (flip the card's serving switch vs. grant
 * `proactive_messaging_enabled`). And `not-installed` stays coarse
 * across pending/revoked, because `providerPresentation`'s
 * `describeChannel` already renders the right sentence for each.
 *
 * @example
 * ```tsx
 * const readiness = useChannelTemplateReadiness(channel);
 * if (readiness.status !== "ready") return <TeachingState ... />;
 * ```
 */
export function useChannelTemplateReadiness(
  channel: AgentChannel,
): ChannelTemplateReadiness {
  const deploymentMode = useDeploymentMode();

  if (deploymentMode !== "cloud") return { status: "cloud-only" };
  if (
    channel.status?.installState !== AgentChannelInstallState.installed
  ) {
    return { status: "not-installed" };
  }
  if (!channel.spec?.enabled) return { status: "channel-off" };
  if (!channel.spec.proactiveMessagingEnabled) {
    return { status: "not-proactive" };
  }
  return { status: "ready" };
}
