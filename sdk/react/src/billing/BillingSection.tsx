"use client";

import { useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { useDeploymentMode } from "../deployment-mode";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice";
import { useOrg } from "../organization/OrgProvider";
import { useBillingAccount } from "./useBillingAccount";
import { useCreateCheckoutSession } from "./useCreateCheckoutSession";
import { CreditBalanceCard } from "./CreditBalanceCard";
import { CreditPackGrid } from "./CreditPackGrid";
import { CreditLedgerTable } from "./CreditLedgerTable";
import { LowBalanceBanner } from "./LowBalanceBanner";

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
        className="text-foreground mb-1 text-sm font-semibold"
      >
        Billing
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">
        Manage credits, purchase credit packs, and view transaction history.
      </p>

      {mode === "local" ? (
        <CloudFeatureNotice>
          Billing is available on Stigmer Cloud. Connect to a Cloud
          organization to manage credits and purchase credit packs.
        </CloudFeatureNotice>
      ) : !orgId ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
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
      <div className="space-y-4" aria-busy="true" aria-label="Loading billing">
        <div className="h-24 animate-pulse rounded-lg bg-muted-subtle" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg bg-muted-subtle"
            />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-lg bg-muted-subtle" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-destructive text-xs" role="alert">
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
    <div className="space-y-6">
      {checkoutSuccess && (
        <CheckoutSuccessBanner onDismiss={onDismissCheckoutSuccess} />
      )}

      <LowBalanceBanner
        availableMicros={balance.availableMicros}
        thresholdMicros={account.lowBalanceThresholdMicros}
      />

      <CreditBalanceCard balance={balance} isLowBalance={isLowBalance} />

      <CreditPackGrid
        accountStatus={account.status}
        purchasingPackId={isSubmitting ? purchasingPackId : null}
        onPurchase={handlePurchase}
      />

      {checkoutError && (
        <p className="text-destructive text-xs" role="alert">
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
      className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-3 text-xs text-emerald-700 dark:text-emerald-300"
    >
      <p>
        <span className="font-medium">Payment received</span>
        {" \u2014 "}
        credits will appear in your balance shortly.
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-emerald-500/10"
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
