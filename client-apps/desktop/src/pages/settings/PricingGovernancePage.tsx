import { PricingGovernancePanel } from "@stigmer/react";

/**
 * Platform-operator page for the pricing feedback loop: pending pricing
 * override sign-offs and per-model baseline-vs-effective rates.
 *
 * Deliberately absent from the shared settings navigation — it is gated by
 * `can_manage_model_pricing` on `platform:stigmer`, which customers never
 * hold; non-operators who navigate here see the authorization error the
 * panel renders.
 */
export default function PricingGovernancePage() {
  return <PricingGovernancePanel />;
}
