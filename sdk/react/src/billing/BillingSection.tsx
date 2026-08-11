"use client";

import { useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
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
  className,
}: BillingSectionProps) {
  const { activeOrg } = useOrg();
  const mode = useDeploymentMode();
  const orgId = activeOrg?.metadata?.id ?? "";

  return (
    <section aria-labelledby="billing-heading" className={className}>
      <h2
        id="billing-heading"
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Billing
      </h2>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        Manage credits, purchase credit packs, and view transaction history.
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
          checkoutSuccess={checkoutSuccess}
          onDismissCheckoutSuccess={onDismissCheckoutSuccess}
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
  checkoutSuccess,
  onDismissCheckoutSuccess,
}: {
  orgId: string;
  checkoutSuccess?: boolean;
  onDismissCheckoutSuccess?: () => void;
}) {
  const { account, isLoading, error, refetch } = useBillingAccount(orgId);
  const { createSession, isSubmitting, error: checkoutError, clearError } = useCreateCheckoutSession();
  const { openPortal, isLoading: isPortalLoading } = useCreateBillingPortalSession();
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);

  const handlePurchase = useCallback(
    (packId: string) => {
      setPurchasingPackId(packId);
      clearError();

      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      const billingPath = `${baseUrl}/settings/billing`;

      createSession({
        orgId,
        packId,
        successUrl: `${billingPath}?checkout=success`,
        cancelUrl: billingPath,
      }).catch(() => {
        setPurchasingPackId(null);
      });
    },
    [orgId, createSession, clearError],
  );

  if (isLoading) {
    return (
      <div className="stg:space-y-4" aria-busy="true" aria-label="Loading billing">
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
      </div>
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

  return (
    <div className="stg:space-y-6">
      {checkoutSuccess && (
        <CheckoutSuccessBanner onDismiss={onDismissCheckoutSuccess} />
      )}

      <LowBalanceBanner
        availableMicros={balance.availableMicros}
        thresholdMicros={account.lowBalanceThresholdMicros}
      />

      <CreditBalanceCard balance={balance} isLowBalance={isLowBalance} />

      <PaymentMethodCard
        paymentMethod={account.defaultPaymentMethod}
        accountStatus={account.status}
        isPortalLoading={isPortalLoading}
        onManage={() => openPortal(orgId)}
      />

      <AutoRechargeCard
        orgId={orgId}
        autoRecharge={account.autoRecharge}
        hasPaymentMethod={
          account.defaultPaymentMethod != null &&
          account.defaultPaymentMethod.paymentMethodId !== ""
        }
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
