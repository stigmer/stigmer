"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { useOptionalOrg } from "../organization/OrgProvider.js";
import { useSingleOrg } from "../server-info.js";
import {
  ORG_ADMIN_SETTINGS_NAV_ITEMS,
  PLATFORM_SETTINGS_NAV_GROUP,
  SETTINGS_NAV_GROUPS,
  SINGLE_ORG_SETTINGS_NAV_GROUPS,
  type SettingsNavGroup,
  type SettingsNavItem,
} from "./settings-nav.js";

/**
 * The `platform` singleton — platform-level permissions are always
 * checked against this one resource (mirrors the server-side
 * `resource_id = "stigmer"` RPC config).
 */
const PLATFORM_RESOURCE = { kind: "platform", id: "stigmer" } as const;

/**
 * The groups both shapes share, shown while the server has not yet said
 * whether it holds one organization: the first group's label and items
 * depend on that answer, so it waits rather than flashing the
 * organization's settings a single-organization server never shows.
 */
const AWAITING_ANSWER_NAV_GROUPS: readonly SettingsNavGroup[] =
  SETTINGS_NAV_GROUPS.slice(1);

/** The entry the organization-gated items follow in the first group. */
const ORG_ADMIN_ITEMS_AFTER = "/settings/teams";

/**
 * Permission-aware settings navigation: {@link SETTINGS_NAV_GROUPS}
 * for everyone ({@link SINGLE_ORG_SETTINGS_NAV_GROUPS} on a server that
 * holds one organization, which never names it; the groups after the
 * first while the server has not answered), plus the
 * {@link PLATFORM_SETTINGS_NAV_GROUP} items the
 * caller's platform permissions unlock (per-item `requiredPermission`,
 * checked against `platform:stigmer`). The group appears when at least
 * one of its items is visible. The {@link ORG_ADMIN_SETTINGS_NAV_ITEMS} the
 * caller's permissions on the active organization unlock join the first
 * group after Teams; outside an `OrgProvider`, or with no organization
 * active, none do.
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
  const orgId = useOptionalOrg()?.activeOrg?.metadata?.id ?? "";
  const serviceAccounts = useCheckPermission(
    orgId ? { kind: "organization", id: orgId } : null,
    "can_create_identity_account",
    { fail: "closed" },
  );
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
  const licenses = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_issue_license",
    { fail: "closed" },
  );
  const plans = useCheckPermission(
    PLATFORM_RESOURCE,
    "can_manage_plans",
    { fail: "closed" },
  );

  const pricingAllowed = pricing.allowed;
  const cursorAccountsAllowed = cursorAccounts.allowed;
  const providerStandingAllowed = providerStanding.allowed;
  const licensesAllowed = licenses.allowed;
  const plansAllowed = plans.allowed;
  const serviceAccountsAllowed = serviceAccounts.allowed;
  const singleOrg = useSingleOrg();
  const baseGroups =
    singleOrg === undefined
      ? AWAITING_ANSWER_NAV_GROUPS
      : singleOrg
        ? SINGLE_ORG_SETTINGS_NAV_GROUPS
        : SETTINGS_NAV_GROUPS;

  return useMemo(() => {
    const verdicts: Record<string, boolean> = {
      can_manage_model_pricing: pricingAllowed,
      can_manage_cursor_accounts: cursorAccountsAllowed,
      can_view_provider_standing: providerStandingAllowed,
      can_issue_license: licensesAllowed,
      can_manage_plans: plansAllowed,
    };

    const visibleItems = PLATFORM_SETTINGS_NAV_GROUP.items.filter(
      // Fail closed on both axes: an item with no declared permission or
      // with a permission this hook does not check yet stays hidden.
      (item) =>
        item.requiredPermission !== undefined &&
        verdicts[item.requiredPermission] === true,
    );

    const orgVerdicts: Record<string, boolean> = {
      can_create_identity_account: serviceAccountsAllowed,
    };
    const orgItems = ORG_ADMIN_SETTINGS_NAV_ITEMS.filter(
      (item) =>
        item.requiredPermission !== undefined &&
        orgVerdicts[item.requiredPermission] === true,
    );
    // While the server has not said whether it holds one organization the
    // first group is held back, so there is nowhere to add these yet.
    const groups =
      orgItems.length === 0 || baseGroups === AWAITING_ANSWER_NAV_GROUPS
        ? baseGroups
        : baseGroups.map((group, index) =>
            index === 0 ? withItemsAfter(group, ORG_ADMIN_ITEMS_AFTER, orgItems) : group,
          );

    if (visibleItems.length === 0) {
      return groups;
    }
    return [
      ...groups,
      { ...PLATFORM_SETTINGS_NAV_GROUP, items: visibleItems },
    ];
  }, [
    baseGroups,
    pricingAllowed,
    cursorAccountsAllowed,
    providerStandingAllowed,
    licensesAllowed,
    plansAllowed,
    serviceAccountsAllowed,
  ]);
}

/** The group with `items` placed after the entry at `afterHref`, or at its end. */
function withItemsAfter(
  group: SettingsNavGroup,
  afterHref: string,
  items: readonly SettingsNavItem[],
): SettingsNavGroup {
  const at = group.items.findIndex((item) => item.href === afterHref);
  const cut = at === -1 ? group.items.length : at + 1;
  return {
    ...group,
    items: [...group.items.slice(0, cut), ...items, ...group.items.slice(cut)],
  };
}
