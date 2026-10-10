"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/** Return value of {@link useCanCreateAgent}. */
export interface UseCanCreateAgentReturn {
  /** Whether the viewer may create an agent in the organization. */
  readonly allowed: boolean;
  /** `true` while the server's answer is in flight. */
  readonly isLoading: boolean;
}

/**
 * Mirrors the server's agent create bar, `can_create_agent` on the
 * organization, so a "Create agent" affordance never appears to someone
 * whose create would be refused.
 *
 * Admins always may. Members may while the organization's policy
 * "Members can create agents" is on, which it is by default; an admin
 * turns it off in the organization's settings (`OrgPoliciesPanel`). A
 * viewer never may.
 *
 * On a server without sign-in every check answers allowed. The check
 * fails open on an error, as every capability gate does: the server
 * refuses a create the answer missed.
 *
 * Pass `null` for `org` while it loads: `allowed` stays `false`, so no
 * affordance flashes before the gate can be evaluated.
 *
 * @param org  The organization's id, or `null` while loading.
 */
export function useCanCreateAgent(org: string | null): UseCanCreateAgentReturn {
  const { allowed, isLoading } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_agent",
  );
  return useMemo(
    () => ({ allowed: !!org && allowed, isLoading: !!org && isLoading }),
    [org, allowed, isLoading],
  );
}
