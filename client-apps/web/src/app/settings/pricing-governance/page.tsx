"use client";

import { ModelCatalogPanel, PricingGovernancePanel } from "@stigmer/react";

/**
 * Platform-operator page for the pricing feedback loop: pending pricing
 * override sign-offs, per-model baseline-vs-effective rates, and the
 * baseline catalog editor (add/edit/retire models — DD-004).
 *
 * Deliberately absent from the shared settings navigation — it is gated by
 * `can_manage_model_pricing` on `platform:stigmer`, which customers never
 * hold; non-operators who navigate here see the authorization error the
 * panels render.
 */
export default function PricingGovernancePage() {
  return (
    <div className="space-y-8">
      <PricingGovernancePanel />
      <ModelCatalogPanel />
    </div>
  );
}
