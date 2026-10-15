"use client";

import { create } from "@bufbuild/protobuf";
import {
  GetChannelAgentProfileRequestSchema,
  type ChannelAgentProfile,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { SharingAudience } from "./webChannelDraft.js";

/** Options for {@link useChannelAgentProfile}. */
export interface UseChannelAgentProfileOptions {
  /**
   * Which resolution path to use.
   *
   * - `"public"` (default) — the anonymous `getAgentProfile` RPC. An
   *   org-audience web channel answers NOT_FOUND here by design.
   * - `"org"` — the authenticated `getAgentProfileForMember` RPC, which
   *   resolves org-audience web channels for signed-in members of the
   *   owning organization (and public ones too). Requires a
   *   `StigmerProvider` whose client carries the member's token.
   */
  readonly audience?: SharingAudience;

  /**
   * Chat-link token from the URL's `?k=` parameter (public path only).
   *
   * Required when the chat link has been locked with a rotatable token;
   * harmless on plain links. On a locked link a missing or rotated-away
   * token resolves to `profile === null`, indistinguishable from an
   * agent that does not exist.
   */
  readonly linkToken?: string;
}

/** Return value of {@link useChannelAgentProfile}. */
export interface UseChannelAgentProfileReturn {
  /**
   * The shared agent's public profile, or `null` while loading, on
   * error, or when the agent is not shared.
   */
  readonly profile: ChannelAgentProfile | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the profile from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches a shared agent's public profile by the web
 * channel's id, the one identity a hosted chat link carries
 * (`/chat/<channel id>`). The profile names the agent's organization
 * (`org`) and slug.
 *
 * By default this hook calls the channel's `getAgentProfile` endpoint, which is
 * **public** — it requires no authentication. The server returns a
 * trimmed projection safe for anonymous visitors: name, description,
 * icon, and the channel's agent reference (version included) a session
 * starts on (a name, not a capability — session creation still requires
 * an authorized token, e.g. a guest token from `createGuestAuth`).
 * With `{ audience: "org" }` it calls the authenticated
 * `getAgentProfileForMember` endpoint instead, which resolves
 * org-members-only web channels for a signed-in member.
 *
 * **Not-shared handling:** the server answers NOT_FOUND for "this
 * agent does not exist", "this agent is not shared", and (on the
 * member path) "you are not a member of this organization" — all
 * indistinguishable by design so a chat URL leaks nothing. The hook
 * maps that to `profile === null` without raising an error, matching
 * `useAgent`'s not-found convention:
 * `profile === null && !isLoading && !error` means unavailable.
 *
 * Pass `null` for `channelId` to skip fetching (stable no-op) — useful
 * while route params are still resolving.
 *
 * **Note**: Although authentication is not required by the server,
 * the hook still requires a `StigmerProvider` ancestor because it
 * needs the transport configuration (API base URL) to make the
 * request.
 *
 * @example
 * ```tsx
 * const { profile, isLoading, error } = useChannelAgentProfile(channelId);
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <ErrorCard error={error} />;
 * if (!profile) return <AgentUnavailable />;
 *
 * return <h1>{profile.name}</h1>;
 * ```
 */
export function useChannelAgentProfile(
  channelId: string | null,
  options?: UseChannelAgentProfileOptions,
): UseChannelAgentProfileReturn {
  const stigmer = useStigmer();
  const audience = options?.audience ?? "public";
  const linkToken = options?.linkToken ?? "";

  const fetchFn =
    channelId
      ? async () => {
          try {
            // The member path is tokenless by contract: org-audience access
            // is gated by live membership, and token-locked public links
            // deliberately refuse there (see getAgentProfileForMember).
            return audience === "org"
              ? await stigmer.channel.getAgentProfileForMember(channelId)
              : await stigmer.channel.getAgentProfile(
                  create(GetChannelAgentProfileRequestSchema, { channelId, linkToken }),
                );
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null;

  const { data: profile, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [channelId, audience, linkToken, stigmer],
    null as ChannelAgentProfile | null,
  );

  return { profile, isLoading, isRefetching, error, refetch };
}
