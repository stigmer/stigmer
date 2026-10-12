// Model catalog — the platform-operator surface for the model registry
// baseline: the catalog of models, their capabilities and list prices,
// which operators search, open, edit, add and retire. Every export here
// is gated on `can_manage_model_pricing` on `platform:stigmer`; nothing
// in this module is customer-facing (customer billing lives in
// ../billing). The module boundary is deliberate: the docs generator
// excludes operator-only domains wholesale, so operator exports must
// never be mixed into customer modules.

// Data hooks
export { useModelPricingBaselines } from "./useModelPricingBaselines.js";
export type {
  UseModelPricingBaselinesOptions,
  UseModelPricingBaselinesReturn,
} from "./useModelPricingBaselines.js";
export { useModelCatalogView } from "./useModelCatalogView.js";
export type {
  ModelCatalogFlow,
  ModelCatalogRow,
  UseModelCatalogViewReturn,
} from "./useModelCatalogView.js";

// Behavior hooks
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
export { ModelCatalogConsole } from "./ModelCatalogConsole.js";
export type { ModelCatalogConsoleProps } from "./ModelCatalogConsole.js";
