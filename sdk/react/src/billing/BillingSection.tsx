"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useOrg } from "../organization/OrgProvider.js";
import { useBillingAccount } from "./useBillingAccount.js";
import { useCreateCheckoutSession } from "./useCreateCheckoutSession.js";
import { useCreateBillingPortalSession } from "./useCreateBillingPortalSession.js";
import { CreditBalanceCard } from "./CreditBalanceCard.js";
import { PaymentMethodCard } from "./PaymentMethodCard.js";
import { AutoRechargeCard } from "./AutoRechargeCard.js";
import { CreditPackGrid } from "./CreditPackGrid.js";
import { CreditLedgerTable } from "./CreditLedgerTable.js";
import { LowBalanceBanner } from "./LowBalanceBanner.js";
import { PlanSection } from "./PlanSection.js";
import { billingReturnUrl, type BillingRedirect } from "./redirect.js";
import { useCreatePaymentMethodSetupSession } from "./useCreatePaymentMethodSetupSession.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link BillingSection}. */
export interface BillingSectionProps {
  /**
   * Whether a checkout just completed (e.g., `?checkout=success`).
   *
   * When `true`, an optimistic banner is shown indicating that
   * credits will appear shortly. This prop is typically driven
   * by the host application's URL query parameters.
   */
  readonly checkoutSuccess?: boolean;
  /** Callback to dismiss the checkout success banner. */
  readonly onDismissCheckoutSuccess?: () => void;
  /**
   * The plan the person was choosing when they left to save a card: the
   * `plan` query Stripe returns with after `?setup=success`. The plan
   * section reopens that choice for an explicit confirm.
   */
  readonly resumePlanId?: string;
  /** Called once the resumed plan choice is taken up, so the host can clear its query. */
  readonly onResumeHandled?: () => void;
  /**
   * The host's seam for Stripe-hosted pages (checkout, card setup and the
   * billing portal). Absent, this window navigates to them and Stripe
   * returns to this origin's `/settings/billing`. A desktop host opens the
   * system browser and names the web console's billing page instead; its
   * reads refresh when the window regains focus.
   */
  readonly redirect?: BillingRedirect;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Top-level billing settings section.
 *
 * Composes the billing sub-components into a cohesive settings page:
 * low-balance warning, checkout success banner, credit balance display,
 * credit pack purchase grid, and transaction history. Handles the
 * deployment mode gate (billing unavailable in local mode) and the
 * org-not-selected state.
 *
 * @example
 * ```tsx
 * // In a settings page:
 * <BillingSection checkoutSuccess={searchParams.checkout === "success"} />
 * ```
 */
export function BillingSection({
  checkoutSuccess,
  onDismissCheckoutSuccess,
  resumePlanId,
  onResumeHandled,
  redirect,
  className,
}: BillingSectionProps) {
  const headingId = useId();
  const { activeOrg } = useOrg();
  const mode = useDeploymentMode();
  const orgId = activeOrg?.metadata?.id ?? "";
  const managed = activeOrg?.spec?.managementMode === ManagementMode.platform_managed;

  return (
    <section aria-labelledby={headingId} className={className}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Billing
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Your plan, credits, payment method and transaction history.
      </p>

      {mode === "local" ? (
        <CloudFeatureNotice>
          Credit billing and purchases are available on Stigmer Cloud. Local
          mode uses your own LLM API keys directly — no Stigmer credits
          needed.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view billing.
        </p>
      ) : (
        <BillingContent
          orgId={orgId}
          managed={managed}
          checkoutSuccess={checkoutSuccess}
          onDismissCheckoutSuccess={onDismissCheckoutSuccess}
          resumePlanId={resumePlanId}
          onResumeHandled={onResumeHandled}
          redirect={redirect}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// BillingContent (internal)
// ---------------------------------------------------------------------------

function BillingContent({
  orgId,
  managed,
  checkoutSuccess,
  onDismissCheckoutSuccess,
  resumePlanId,
  onResumeHandled,
  redirect,
}: {
  orgId: string;
  managed: boolean;
  checkoutSuccess?: boolean;
  onDismissCheckoutSuccess?: () => void;
  resumePlanId?: string;
  onResumeHandled?: () => void;
  redirect?: BillingRedirect;
}) {
  const { account, isLoading, error, refetch } = useBillingAccount(orgId, {
    refetchOnWindowFocus: redirect?.openUrl !== undefined,
  });
  const { createSession, isSubmitting, error: checkoutError, clearError } = useCreateCheckoutSession(redirect);
  const { openPortal, isLoading: isPortalLoading } = useCreateBillingPortalSession(redirect);
  const setup = useCreatePaymentMethodSetupSession(redirect);
  const returnUrl = redirect?.returnUrl;
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);

  const handlePurchase = useCallback(
    (packId: string) => {
      setPurchasingPackId(packId);
      clearError();

      const billingPath = billingReturnUrl({ returnUrl });

      createSession({
        orgId,
        packId,
        successUrl: `${billingPath}?checkout=success`,
        cancelUrl: billingPath,
      }).catch(() => {
        setPurchasingPackId(null);
      });
    },
    [orgId, createSession, clearError, returnUrl],
  );

  if (isLoading) {
    return (
      <LoadingRegion className="stg:space-y-4" label="Loading billing">
        <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        <div className="stg:grid stg:grid-cols-3 stg:gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="stg:h-36 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle"
            />
          ))}
        </div>
        <div className="stg:h-48 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
      </LoadingRegion>
    );
  }

  if (error) {
    return (
      <p className="stg:text-destructive stg:text-xs" role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (!account) return null;

  const balance = account.balance;
  if (!balance) return null;

  const isLowBalance =
    balance.availableMicros < account.lowBalanceThresholdMicros;
  const hasPaymentMethod =
    account.defaultPaymentMethod != null && account.defaultPaymentMethod.paymentMethodId !== "";

  return (
    <div className="stg:space-y-6">
      {checkoutSuccess && (
        <CheckoutSuccessBanner onDismiss={onDismissCheckoutSuccess} />
      )}

      <LowBalanceBanner
        availableMicros={balance.availableMicros}
        thresholdMicros={account.lowBalanceThresholdMicros}
      />

      <PlanSection
        orgId={orgId}
        managed={managed}
        hasPaymentMethod={hasPaymentMethod}
        onRefreshAccount={refetch}
        redirect={redirect}
        resumePlanId={resumePlanId}
        onResumeHandled={onResumeHandled}
      />

      <CreditBalanceCard balance={balance} isLowBalance={isLowBalance} />

      <PaymentMethodCard
        paymentMethod={account.defaultPaymentMethod}
        accountStatus={account.status}
        isPortalLoading={isPortalLoading}
        onManage={() => openPortal(orgId)}
        onAdd={() => {
          setup.addPaymentMethod(orgId).catch(() => undefined);
        }}
        isAdding={setup.isSubmitting}
      />
      {setup.error && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(setup.error)}
        </p>
      )}

      <AutoRechargeCard
        orgId={orgId}
        autoRecharge={account.autoRecharge}
        hasPaymentMethod={hasPaymentMethod}
        accountStatus={account.status}
        onSaved={refetch}
      />

      <CreditPackGrid
        accountStatus={account.status}
        purchasingPackId={isSubmitting ? purchasingPackId : null}
        onPurchase={handlePurchase}
      />

      {checkoutError && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(checkoutError)}
        </p>
      )}

      <CreditLedgerTable orgId={orgId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CheckoutSuccessBanner (internal)
// ---------------------------------------------------------------------------

function CheckoutSuccessBanner({
  onDismiss,
}: {
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      className="stg:flex stg:items-center stg:justify-between stg:gap-3 stg:rounded-lg stg:border stg:border-emerald-500/30 stg:bg-emerald-500/5 stg:px-3.5 stg:py-3 stg:text-xs stg:text-emerald-700 stg:dark:text-emerald-300"
    >
      <p>
        <span className="stg:font-medium">Payment received</span>
        {" \u2014 "}
        credits will appear in your balance shortly.
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="stg:shrink-0 stg:rounded stg:p-0.5 stg:transition-colors stg:hover:bg-emerald-500/10"
          aria-label="Dismiss"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
