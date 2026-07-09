"use client";

import type { SharedAgentProfile } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useSharedAgentProfile}. */
export interface UseSharedAgentProfileReturn {
  /**
   * The shared agent's public profile, or `null` while loading, on
   * error, or when the agent is not shared.
   */
  readonly profile: SharedAgentProfile | null;
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
 * Data hook that fetches a shared agent's public profile by
 * organization and agent slug.
 *
 * This hook calls the `getSharedProfile` endpoint, which is
 * **public** — it requires no authentication. The server returns a
 * trimmed projection safe for anonymous visitors: name, description,
 * icon, and the default instance id needed to start a session
 * (an identifier, not a capability — session creation still requires
 * an authorized token, e.g. a guest token from `createGuestAuth`).
 *
 * **Not-shared handling:** the server answers NOT_FOUND for both
 * "this agent does not exist" and "this agent is not shared" — the
 * two are indistinguishable by design so a share URL leaks nothing
 * once revoked. The hook maps that to `profile === null` without
 * raising an error, matching `useAgent`'s not-found convention:
 * `profile === null && !isLoading && !error` means unavailable.
 *
 * Pass `null` for either `org` or `slug` to skip fetching (stable
 * no-op) — useful while route params are still resolving.
 *
 * **Note**: Although authentication is not required by the server,
 * the hook still requires a `StigmerProvider` ancestor because it
 * needs the transport configuration (API base URL) to make the
 * request.
 *
 * @example
 * ```tsx
 * const { profile, isLoading, error } = useSharedAgentProfile(org, slug);
 *
 * if (isLoading) return <Spinner />;
 * if (error) return <ErrorCard error={error} />;
 * if (!profile) return <AgentUnavailable />;
 *
 * return <h1>{profile.name}</h1>;
 * ```
 */
export function useSharedAgentProfile(
  org: string | null,
  slug: string | null,
): UseSharedAgentProfileReturn {
  const stigmer = useStigmer();

  const fetchFn =
    org && slug
      ? async () => {
          try {
            return await stigmer.agent.getSharedProfile({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null;

  const { data: profile, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, stigmer],
    null as SharedAgentProfile | null,
  );

  return { profile, isLoading, isRefetching, error, refetch };
}
