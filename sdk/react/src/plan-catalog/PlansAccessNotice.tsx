"use client";

import { EmptyState } from "../empty-state/index.js";
import type { SettingsPageDenial } from "../settings/SettingsPage.js";

/** What the plan catalogue says to a person who is not a platform operator. */
export const PLANS_DENIAL: SettingsPageDenial = {
  title: "Platform operator access required",
  description:
    "The plan catalog is managed by Stigmer's platform operators: a plan's terms are what every subscriber on it is invoiced. Organization roles do not grant access; organizations choose their plan under Billing.",
};

/**
 * The access-denied state for the plan catalog's operator surface.
 * Server-side authorization (`can_manage_plans` on `platform:stigmer`) is
 * the real gate; this is the designed face of it for anyone who reaches
 * the route without the permission.
 */
export function PlansAccessNotice({ className }: { readonly className?: string }) {
  return (
    <EmptyState
      variant="permission"
      className={className}
      title={PLANS_DENIAL.title}
      description={PLANS_DENIAL.description}
    />
  );
}
