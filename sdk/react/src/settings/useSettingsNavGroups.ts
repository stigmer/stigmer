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
 * for everyone, plus the {@link PLATFORM_SETTINGS_NAV_GROUP} items the
 * caller's platform permissions unlock (per-item `requiredPermission`,
 * checked against `platform:stigmer`). The group appears when at least
 * one of its items is visible.
 *
 * The checks run fail-closed — the opposite of the `useCheckPermission`
 * default — because navigation is *discoverability*, not *capability*:
 * an action gate can safely fail open (the server re-checks every
 * request), but an operator-only nav entry must not appear while the
 * check is loading, when it errors, or on deployments where the IAM
 * service (and the surface it points to) does not exist.
 *
 * Implementation note: hooks must be called unconditionally, so each
 * distinct platform permission gets its own static check below. When a
 * new platform surface adds a new permission, add its check to
 * PLATFORM_PERMISSION_CHECKS' shape here — the exhaustiveness guard in
 * the tests catches a forgotten one.
 *
 * @example
 * ```tsx
 * const groups = useSettingsNavGroups();
 * return groups.map((group) => <NavGroup key={group.label} group={group} />);
 * ```
 */
export function useSettingsNavGroups(): readonly SettingsNavGroup[] {
  const pricing = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_manage_model_pricing",
    { fail: "closed" },
  );
  const cursorAccounts = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_manage_cursor_accounts",
    { fail: "closed" },
  );
  const providerStanding = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_view_provider_standing",
    { fail: "closed" },
  );

  const pricingAllowed = pricing.allowed;
  const cursorAccountsAllowed = cursorAccounts.allowed;
  const providerStandingAllowed = providerStanding.allowed;

  return useMemo(() => {
    const verdicts: Record<string, boolean> = {
      can_manage_model_pricing: pricingAllowed,
      can_manage_cursor_accounts: cursorAccountsAllowed,
      can_view_provider_standing: providerStandingAllowed,
    };

    const visibleItems = PLATFORM_SETTINGS_NAV_GROUP.items.filter(
      // Fail closed on both axes: an item with no declared permission or
      // with a permission this hook does not check yet stays hidden.
      (item) =>
        item.requiredPermission !== undefined &&
        verdicts[item.requiredPermission] === true,
    );

    if (visibleItems.length === 0) {
      return SETTINGS_NAV_GROUPS;
    }
    return [
      ...SETTINGS_NAV_GROUPS,
      { ...PLATFORM_SETTINGS_NAV_GROUP, items: visibleItems },
    ];
  }, [pricingAllowed, cursorAccountsAllowed, providerStandingAllowed]);
}
