// Billing — the customer-facing surface: subscription plans, credit
// balance and ledger, payment methods, usage reports, and customer model
// pricing. The platform-operator pricing surface (registry baseline
// authoring, override sign-offs) lives in ../pricing-governance.

// Data hooks
export { useBillingAccount } from "./useBillingAccount.js";
export type { UseBillingAccountOptions, UseBillingAccountReturn } from "./useBillingAccount.js";
export { useCreditLedger } from "./useCreditLedger.js";
export type { UseCreditLedgerReturn, UseCreditLedgerOptions } from "./useCreditLedger.js";
export { useBillingUsageReport } from "./useBillingUsageReport.js";
export type { UseBillingUsageReportReturn } from "./useBillingUsageReport.js";
export { useCustomerModelPricing } from "./useCustomerModelPricing.js";
export type { UseCustomerModelPricingReturn } from "./useCustomerModelPricing.js";
export { usePlans } from "./usePlans.js";
export type { UsePlansOptions, UsePlansReturn } from "./usePlans.js";
export { useSubscription } from "./useSubscription.js";
export type { UseSubscriptionReturn } from "./useSubscription.js";
export { useEntitlements } from "./useEntitlements.js";
export type { UseEntitlementsOptions, UseEntitlementsReturn } from "./useEntitlements.js";
export { usePeriodEstimate } from "./usePeriodEstimate.js";
export type { UsePeriodEstimateOptions, UsePeriodEstimateReturn } from "./usePeriodEstimate.js";

// Behavior hooks
export { useCreateCheckoutSession } from "./useCreateCheckoutSession.js";
export type {
  CreateCheckoutSessionInput,
  UseCreateCheckoutSessionReturn,
} from "./useCreateCheckoutSession.js";
export { useCreateBillingPortalSession } from "./useCreateBillingPortalSession.js";
export type { UseCreateBillingPortalSessionReturn } from "./useCreateBillingPortalSession.js";
export { useChangePlan, useCancelSubscription } from "./useChangePlan.js";
export type { UseChangePlanReturn, UseCancelSubscriptionReturn } from "./useChangePlan.js";
export { useCreatePaymentMethodSetupSession } from "./useCreatePaymentMethodSetupSession.js";
export type { UseCreatePaymentMethodSetupSessionReturn } from "./useCreatePaymentMethodSetupSession.js";
export type { BillingRedirect } from "./redirect.js";
export { planStanding, planMove } from "./plan-state.js";
export type { PlanStanding, PlanMove } from "./plan-state.js";
export { useSetAutoRechargeConfig } from "./useSetAutoRechargeConfig.js";
export type {
  SetAutoRechargeConfigInput,
  UseSetAutoRechargeConfigReturn,
} from "./useSetAutoRechargeConfig.js";

// Styled components
export { BillingSection } from "./BillingSection.js";
export type { BillingSectionProps } from "./BillingSection.js";
export { CreditBalanceCard } from "./CreditBalanceCard.js";
export type { CreditBalanceCardProps } from "./CreditBalanceCard.js";
export { PaymentMethodCard } from "./PaymentMethodCard.js";
export type { PaymentMethodCardProps } from "./PaymentMethodCard.js";
export { AutoRechargeCard } from "./AutoRechargeCard.js";
export type { AutoRechargeCardProps } from "./AutoRechargeCard.js";
export { CreditPackGrid } from "./CreditPackGrid.js";
export type { CreditPackGridProps } from "./CreditPackGrid.js";
export { CreditLedgerTable } from "./CreditLedgerTable.js";
export type { CreditLedgerTableProps } from "./CreditLedgerTable.js";
export { LowBalanceBanner } from "./LowBalanceBanner.js";
export type { LowBalanceBannerProps } from "./LowBalanceBanner.js";
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

// Credit pack catalog and formatting utilities
export { CREDIT_PACKS, formatPackPrice, formatCreditCount } from "./credit-packs.js";
export type { CreditPackInfo } from "./credit-packs.js";
export {
  formatCreditBalance,
  formatLedgerAmount,
  ledgerEntryLabel,
  isCredit,
  isHold,
  formatLedgerDate,
} from "./format.js";
