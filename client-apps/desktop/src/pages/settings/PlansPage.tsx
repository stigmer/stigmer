import { PlanCatalogConsole } from "@stigmer/react";

/**
 * Platform-operator console for the Stigmer Cloud plan catalog: every plan
 * with its terms, retiring one, and creating one.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_manage_plans` on
 * `platform:stigmer`). The nav gate is discoverability only; the server
 * permission is the real boundary, and anyone else who navigates here by
 * URL sees the access notice the console renders.
 */
export default function PlansPage() {
  return <PlanCatalogConsole />;
}
