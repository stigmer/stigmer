"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import {
  PLATFORM_SETTINGS_NAV_GROUP,
  SETTINGS_NAV_GROUPS,
  type SettingsNavGroup,
} from "./settings-nav.js";

/**
 * The `platform` singleton — platform-level permissions are always
 * checked against this one resource (mirrors the server-side
 * `resource_id = "stigmer"` RPC config).
 */
const PLATFORM_RESOURCE = { kind: "platform", id: "stigmer" } as const;

/**
 * Permission-aware settings navigation: {@link SETTINGS_NAV_GROUPS}
 * for everyone, plus {@link PLATFORM_SETTINGS_NAV_GROUP} appended when
 * the caller holds `can_manage_model_pricing` on `platform:stigmer`
 * (i.e. is a platform operator).
 *
 * The check runs fail-closed — the opposite of the `useCheckPermission`
 * default — because navigation is *discoverability*, not *capability*:
 * an action gate can safely fail open (the server re-checks every
 * request), but an operator-only nav entry must not appear while the
 * check is loading, when it errors, or on deployments where the IAM
 * service (and the surface it points to) does not exist.
 *
 * Gating is deliberately group-level on this single permission — it is
 * the only operator console surface today. If a second platform surface
 * with a different permission arrives, extend {@link SettingsNavItem}
 * with a per-item `requiredPermission` and filter here, rather than
 * adding more one-off hooks.
 *
 * @example
 * ```tsx
 * const groups = useSettingsNavGroups();
 * return groups.map((group) => <NavGroup key={group.label} group={group} />);
 * ```
 */
export function useSettingsNavGroups(): readonly SettingsNavGroup[] {
  const { allowed } = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_manage_model_pricing",
    { fail: "closed" },
  );

  return useMemo(
    () =>
      allowed
        ? [...SETTINGS_NAV_GROUPS, PLATFORM_SETTINGS_NAV_GROUP]
        : SETTINGS_NAV_GROUPS,
    [allowed],
  );
}
