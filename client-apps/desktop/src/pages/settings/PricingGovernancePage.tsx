import { PricingGovernanceConsole } from "@stigmer/react";

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
  return <PricingGovernanceConsole />;
}
