"use client";

import type { SharedAgentProfile } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { SharingAudience } from "./useUpdateAgentSharing.js";

/** Options for {@link useSharedAgentProfile}. */
export interface UseSharedAgentProfileOptions {
  /**
   * Which resolution path to use.
   *
   * - `"public"` (default) — the anonymous `getSharedProfile` RPC. An
   *   org-audience share answers NOT_FOUND here by design.
   * - `"org"` — the authenticated `getSharedProfileForMember` RPC, which
   *   resolves org-audience shares for signed-in members of the owning
   *   organization (and public shares too). Requires a `StigmerProvider`
   *   whose client carries the member's token.
   */
  readonly audience?: SharingAudience;
}

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
 * By default this hook calls the `getSharedProfile` endpoint, which is
 * **public** — it requires no authentication. The server returns a
 * trimmed projection safe for anonymous visitors: name, description,
 * icon, and the default instance id needed to start a session
 * (an identifier, not a capability — session creation still requires
 * an authorized token, e.g. a guest token from `createGuestAuth`).
 * With `{ audience: "org" }` it calls the authenticated
 * `getSharedProfileForMember` endpoint instead, which resolves
 * org-members-only shares for a signed-in member.
 *
 * **Not-shared handling:** the server answers NOT_FOUND for "this
 * agent does not exist", "this agent is not shared", and (on the
 * member path) "you are not a member of this organization" — all
 * indistinguishable by design so a share URL leaks nothing. The hook
 * maps that to `profile === null` without raising an error, matching
 * `useAgent`'s not-found convention:
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
  options?: UseSharedAgentProfileOptions,
): UseSharedAgentProfileReturn {
  const stigmer = useStigmer();
  const audience = options?.audience ?? "public";

  const fetchFn =
    org && slug
      ? async () => {
          try {
            return audience === "org"
              ? await stigmer.agent.getSharedProfileForMember({ org, slug })
              : await stigmer.agent.getSharedProfile({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null;

  const { data: profile, isLoading, isRefetching, error, refetch } = useFetch(
    fetchFn,
    [org, slug, audience, stigmer],
    null as SharedAgentProfile | null,
  );

  return { profile, isLoading, isRefetching, error, refetch };
}
