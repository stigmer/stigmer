// Billing — the customer-facing surface: subscription plans, the card on
// file and the Stripe billing portal, and provider keys. Token usage lives
// in ../usage; the platform-operator model catalog (registry baseline
// authoring) lives in ../model-catalog.

// Data hooks
export { useBillingAccount } from "./useBillingAccount.js";
export type { UseBillingAccountOptions, UseBillingAccountReturn } from "./useBillingAccount.js";
export { usePlans } from "./usePlans.js";
export type { UsePlansOptions, UsePlansReturn } from "./usePlans.js";
export { useSubscription } from "./useSubscription.js";
export type { UseSubscriptionReturn } from "./useSubscription.js";
export { useEntitlements } from "./useEntitlements.js";
export type { UseEntitlementsOptions, UseEntitlementsReturn } from "./useEntitlements.js";
export { usePeriodEstimate } from "./usePeriodEstimate.js";
export type { UsePeriodEstimateOptions, UsePeriodEstimateReturn } from "./usePeriodEstimate.js";
export { useProviderKeys, useProviderKeyActions } from "./useProviderKeys.js";
export type {
  ProviderKeyProvider,
  UseProviderKeysOptions,
  UseProviderKeysReturn,
  UseProviderKeyActionsReturn,
} from "./useProviderKeys.js";

// Behavior hooks
export { useCreateBillingPortalSession } from "./useCreateBillingPortalSession.js";
export type { UseCreateBillingPortalSessionReturn } from "./useCreateBillingPortalSession.js";
export { useChangePlan, useCancelSubscription } from "./useChangePlan.js";
export type { UseChangePlanReturn, UseCancelSubscriptionReturn } from "./useChangePlan.js";
export { useCreatePaymentMethodSetupSession } from "./useCreatePaymentMethodSetupSession.js";
export type { UseCreatePaymentMethodSetupSessionReturn } from "./useCreatePaymentMethodSetupSession.js";
export type { BillingRedirect } from "./redirect.js";
export { planStanding, planMove } from "./plan-state.js";
export type { PlanStanding, PlanMove } from "./plan-state.js";

// Styled components
export { ProviderKeysSection } from "./ProviderKeysSection.js";
export type { ProviderKeysSectionProps } from "./ProviderKeysSection.js";
export { BillingSection } from "./BillingSection.js";
export type { BillingSectionProps } from "./BillingSection.js";
export { PaymentMethodCard } from "./PaymentMethodCard.js";
export type { PaymentMethodCardProps } from "./PaymentMethodCard.js";
export { PlanSection } from "./PlanSection.js";
export type { PlanSectionProps } from "./PlanSection.js";
export { PlanCard } from "./PlanCard.js";
export type { PlanCardProps } from "./PlanCard.js";
export { PlanPicker, ENTERPRISE_CONTACT_URL } from "./PlanPicker.js";
export type { PlanPickerProps } from "./PlanPicker.js";
export { ChangePlanDialog, PAYMENT_METHOD_REQUIRED } from "./ChangePlanDialog.js";
export type { ChangePlanDialogProps } from "./ChangePlanDialog.js";
export { UpgradeNotice, planUpgradeFeature, PLAN_UPGRADE_REQUIRED, DEFAULT_BILLING_HREF } from "./UpgradeNotice.js";
export type { UpgradeNoticeProps } from "./UpgradeNotice.js";
export {
  ProviderKeyNotice,
  providerKeyRequired,
  PROVIDER_KEY_REQUIRED,
  DEFAULT_PROVIDER_KEYS_HREF,
} from "./ProviderKeyNotice.js";
export type { ProviderKeyNoticeProps, ProviderKeyRequired } from "./ProviderKeyNotice.js";

// Formatting utilities
export { formatUsd } from "./format.js";
