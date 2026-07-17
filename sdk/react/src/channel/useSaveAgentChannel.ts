"use client";

import { useCallback, useState } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannelInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/**
 * Rebuild the {@link AgentChannelInput} that reproduces an existing
 * channel verbatim.
 *
 * `apply` replaces the channel's whole spec, so a caller toggling one
 * field must supply the full configuration — this helper makes that safe:
 *
 * ```ts
 * save({ ...agentChannelToInput(channel), enabled: false });
 * ```
 *
 * Provider config carries over per arm: the Slack config is an empty
 * marker message in v1 (all concrete facts are OAuth-observed and live
 * in `status`, which survives every save verbatim); the WhatsApp config
 * carries its declared `phone_number_id`. Dropping the arm is never an
 * option — the provider oneof is immutable server-side, so a save
 * without it would be refused outright. The channel's bound tool
 * credentials (`environment_refs`) and its channel-app binding
 * (`app_ref`) carry over too — apply semantics would otherwise silently
 * unbind them on every toggle (and an installed channel's app_ref is
 * frozen server-side, so dropping it would refuse the save outright).
 */
export function agentChannelToInput(channel: AgentChannel): AgentChannelInput {
  const metadata = channel.metadata;
  const spec = channel.spec;
  const labels = metadata?.labels ?? {};
  const environmentRefs = spec?.environmentRefs ?? [];

  return {
    name: metadata?.name ?? "",
    ...(metadata?.slug ? { slug: metadata.slug } : {}),
    org: metadata?.org ?? "",
    ...(Object.keys(labels).length > 0 ? { labels: { ...labels } } : {}),
    ...(metadata?.visibility ? { visibility: metadata.visibility } : {}),
    agentRef: {
      org: spec?.agentRef?.org ?? "",
      slug: spec?.agentRef?.slug ?? "",
    },
    enabled: spec?.enabled ?? false,
    ...(spec?.providerConfig?.case === "slack" ? { slack: {} } : {}),
    ...(spec?.providerConfig?.case === "whatsapp"
      ? { whatsapp: { phoneNumberId: spec.providerConfig.value.phoneNumberId } }
      : {}),
    ...(spec?.appRef?.slug
      ? {
          appRef: {
            org: spec.appRef.org,
            slug: spec.appRef.slug,
          },
        }
      : {}),
    ...(environmentRefs.length > 0
      ? {
          environmentRefs: environmentRefs.map((ref) => ({
            org: ref.org,
            slug: ref.slug,
          })),
        }
      : {}),
  };
}

/** Return value of {@link useSaveAgentChannel}. */
export interface UseSaveAgentChannelReturn {
  /**
   * Create or update an agent channel (`apply` semantics: upsert by
   * org + slug). Returns the persisted resource.
   *
   * Disabling is a config-preserving pause: save with `enabled: false`
   * and the provider install (and its credentials) survive. Deleting is
   * the full teardown — see `useDeleteAgentChannel`.
   */
  readonly save: (input: AgentChannelInput) => Promise<AgentChannel>;
  /** `true` while the save request is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed save, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that creates or updates an {@link AgentChannel}.
 *
 * Wraps `stigmer.agentChannel.apply()` with loading/error state. The
 * caller is responsible for post-save UI updates (e.g. refreshing the
 * channel list). Pair with {@link agentChannelToInput} to change a single
 * field of an existing channel without dropping the rest of its spec.
 *
 * @example
 * ```tsx
 * const { save, isPending } = useSaveAgentChannel();
 *
 * const handleToggle = async (channel: AgentChannel, enabled: boolean) => {
 *   await save({ ...agentChannelToInput(channel), enabled });
 *   refetch(); // refresh the channel list
 * };
 * ```
 */
export function useSaveAgentChannel(): UseSaveAgentChannelReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback(
    async (input: AgentChannelInput): Promise<AgentChannel> => {
      setIsPending(true);
      setError(null);

      try {
        return await stigmer.agentChannel.apply(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsPending(false);
      }
    },
    [stigmer],
  );

  return { save, isPending, error, clearError };
}
