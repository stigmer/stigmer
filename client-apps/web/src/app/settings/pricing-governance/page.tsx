"use client";

import {
  PricingGovernanceConsole,
  type PricingGovernanceTab,
} from "@stigmer/react";

/**
 * Read the `?tab=` deep-link target once, at mount.
 *
 * Lets external surfaces land directly on a specific tab — e.g. the
 * pricing-governance Discord notification links proposals straight to
 * `?tab=sign-offs`. Read from `window.location` instead of
 * `useSearchParams()` because tab state is deliberately local after
 * landing (the AgentDetailPage `?tab=` precedent) and the static-export
 * prerender has no URL to read (the `useStaticRouteParam` idiom).
 */
function initialTabFromUrl(): PricingGovernanceTab | undefined {
  if (typeof window === "undefined") return undefined;
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "models" || tab === "sign-offs" ? tab : undefined;
}

/**
 * Platform-operator console for model pricing: the unified Models view
 * (catalog + governance state, with search and per-model detail records)
 * and the pending sign-off queue, as tabs.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_manage_model_pricing` on
 * `platform:stigmer`). The nav gate is discoverability only; the server
 * permission is the real boundary, and non-operators who navigate here
 * by URL see the authorization notice the console renders.
 */
export default function PricingGovernancePage() {
  return <PricingGovernanceConsole defaultTab={initialTabFromUrl()} />;
}
