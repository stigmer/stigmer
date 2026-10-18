"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../grant/useCheckPermission.js";

/** Return value of {@link useCanCreateEnvironment}. */
export interface UseCanCreateEnvironmentReturn {
  /** Whether the viewer may create an Environment in the organization; `false` until the server has answered. */
  readonly allowed: boolean;
  /** `true` while the server's answer is in flight. */
  readonly isLoading: boolean;
}

/**
 * Mirrors the server's Environment create bar, `can_create_environment`
 * on the organization, which only its admins hold, so a "New environment"
 * affordance never appears to someone whose create would be refused.
 *
 * Unlike the agent gate, `allowed` stays `false` while the check is in
 * flight: most people who open the Environments list are members, and a
 * create button that shows and then vanishes for each of them is worse
 * than one that appears a moment late for an admin. After that the check's
 * fail-open answer holds, so an outage of the check never hides the
 * affordance from an admin; the server refuses a create the answer missed.
 * On a server without sign-in every check answers allowed.
 *
 * Pass `null` for `org` while it loads: `allowed` stays `false`.
 *
 * @param org  The organization's id, or `null` while loading.
 */
export function useCanCreateEnvironment(org: string | null): UseCanCreateEnvironmentReturn {
  const { allowed, isLoading } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_environment",
  );
  return useMemo(
    () => ({ allowed: !!org && !isLoading && allowed, isLoading: !!org && isLoading }),
    [org, allowed, isLoading],
  );
}
