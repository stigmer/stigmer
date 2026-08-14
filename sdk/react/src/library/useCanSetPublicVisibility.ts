"use client";

import { useDeploymentMode } from "../deployment-mode.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/**
 * The `platform` singleton — platform-level permissions are always checked
 * against this one resource (mirrors the server-side `resource_id = "stigmer"`
 * RPC config).
 */
const PLATFORM_RESOURCE = { kind: "platform", id: "stigmer" } as const;

/** Return value of {@link useCanSetPublicVisibility}. */
export interface UseCanSetPublicVisibilityReturn {
  /** Whether the current user may set resources to PUBLIC visibility. */
  readonly allowed: boolean;
  /** `true` while the permission check is in flight (cloud only). */
  readonly isLoading: boolean;
}

/**
 * Whether the current user may set a resource's visibility to PUBLIC — the
 * only level that crosses every org boundary (the cross-org "explore"
 * catalog).
 *
 * In the cloud edition, publishing is a curation decision: the backend
 * gates both write doors (updateVisibility escalation and
 * create-with-public) on `can_set_public_visibility` on `platform:stigmer`,
 * an explicit platform-operator capability. This hook runs the same check
 * so selectors can present the Public option as locked instead of letting
 * the request fail.
 *
 * Fail-closed, deliberately the opposite of the `useCheckPermission`
 * default: an escalation gate must not open while the check is loading or
 * when it errors — a locked option that unlocks a moment later is a far
 * better failure than an unlocked option the server then rejects.
 *
 * In `local` deployment mode (OSS Go backend) the answer is always `true`:
 * the self-hosted operator owns the store, the same scoping cloud#320
 * applied to reserved labels.
 */
export function useCanSetPublicVisibility(): UseCanSetPublicVisibilityReturn {
  const deploymentMode = useDeploymentMode();
  // Hooks run unconditionally; in local mode the null resource skips the
  // RPC entirely and the fail mode's answer is discarded below.
  const { allowed, isLoading } = useCheckPermission(
    deploymentMode === "cloud" ? PLATFORM_RESOURCE : null,
    "can_set_public_visibility",
    { fail: "closed" },
  );

  if (deploymentMode === "local") {
    return { allowed: true, isLoading: false };
  }
  return { allowed, isLoading };
}
