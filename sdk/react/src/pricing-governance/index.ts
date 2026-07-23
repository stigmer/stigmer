// Pricing governance — the platform-operator surface for the model
// registry baseline and the reconciliation-driven pricing feedback loop.
// Every export here is gated on `can_manage_model_pricing` on
// `platform:stigmer`; nothing in this module is customer-facing (customer
// billing lives in ../billing). The module boundary is deliberate: the
// docs generator excludes operator-only domains wholesale, so operator
// exports must never be mixed into customer modules.

// Data hooks
export { usePricingGovernance } from "./usePricingGovernance.js";
export type { UsePricingGovernanceReturn } from "./usePricingGovernance.js";
export { useModelPricingBaselines } from "./useModelPricingBaselines.js";
export type {
  UseModelPricingBaselinesOptions,
  UseModelPricingBaselinesReturn,
} from "./useModelPricingBaselines.js";
export { useModelGovernanceView } from "./useModelGovernanceView.js";
export type {
  GovernanceFlow,
  ModelGovernanceRow,
  UseModelGovernanceViewReturn,
} from "./useModelGovernanceView.js";

// Behavior hooks
export { useDecidePricingOverride } from "./useDecidePricingOverride.js";
export type {
  DecidePricingOverrideInput,
  UseDecidePricingOverrideReturn,
} from "./useDecidePricingOverride.js";
export { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
export type {
  UpsertModelPricingBaselineInput,
  UseUpsertModelPricingBaselineReturn,
} from "./useUpsertModelPricingBaseline.js";
export { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";
export type {
  RetireModelPricingBaselineInput,
  UseRetireModelPricingBaselineReturn,
} from "./useRetireModelPricingBaseline.js";

// Styled components
export { PricingGovernancePanel } from "./PricingGovernancePanel.js";
export type { PricingGovernancePanelProps } from "./PricingGovernancePanel.js";
export { ModelCatalogPanel } from "./ModelCatalogPanel.js";
export type { ModelCatalogPanelProps } from "./ModelCatalogPanel.js";
export { PricingGovernanceConsole } from "./PricingGovernanceConsole.js";
export type {
  PricingGovernanceConsoleProps,
  PricingGovernanceTab,
} from "./PricingGovernanceConsole.js";
