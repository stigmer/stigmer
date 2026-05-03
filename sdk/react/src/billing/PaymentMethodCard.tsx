"use client";

import { cn } from "@stigmer/theme";
import type { PaymentMethodSummary } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";

/** Props for {@link PaymentMethodCard}. */
export interface PaymentMethodCardProps {
  /** The saved payment method, or undefined if none is on file. */
  readonly paymentMethod?: PaymentMethodSummary;
  /** Account status — portal button disabled when suspended or closed. */
  readonly accountStatus: BillingAccountStatus;
  /** `true` while the portal session is being created. */
  readonly isPortalLoading?: boolean;
  /** Called when the user clicks "Manage payment methods". */
  readonly onManage: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

const BRAND_DISPLAY: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
};

function formatBrand(brand: string): string {
  return BRAND_DISPLAY[brand.toLowerCase()] ?? brand;
}

function formatExpiry(month: number, year: number): string {
  const m = String(month).padStart(2, "0");
  const y = String(year).slice(-2);
  return `${m}/${y}`;
}

/**
 * Displays the saved payment method with a button to open the
 * Stripe Customer Portal for management.
 *
 * Shows card brand, last 4 digits, and expiry when a payment method
 * is on file. Shows an empty state prompt when none exists. The
 * "Manage" button opens the Stripe Customer Portal where users can
 * add, update, or remove payment methods.
 *
 * @example
 * ```tsx
 * <PaymentMethodCard
 *   paymentMethod={account.defaultPaymentMethod}
 *   accountStatus={account.status}
 *   onManage={() => openPortal(orgId)}
 * />
 * ```
 */
export function PaymentMethodCard({
  paymentMethod,
  accountStatus,
  isPortalLoading,
  onManage,
  className,
}: PaymentMethodCardProps) {
  const isAccountActive =
    accountStatus === BillingAccountStatus.billing_account_active;
  const hasPm =
    paymentMethod != null && paymentMethod.paymentMethodId !== "";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card px-4 py-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">
          Payment Method
        </h3>
        {hasPm && (
          <button
            type="button"
            disabled={!isAccountActive || isPortalLoading}
            onClick={onManage}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "text-muted-foreground hover:bg-accent hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
            aria-busy={isPortalLoading}
          >
            {isPortalLoading ? "Opening\u2026" : "Manage"}
          </button>
        )}
      </div>

      {hasPm ? (
        <div className="mt-2 flex items-center gap-3">
          <CardBrandIcon brand={paymentMethod.brand} />
          <div>
            <div className="text-sm font-medium text-foreground">
              {formatBrand(paymentMethod.brand)} ····{" "}
              {paymentMethod.last4}
            </div>
            <div className="text-xs text-muted-foreground">
              Expires{" "}
              {formatExpiry(paymentMethod.expMonth, paymentMethod.expYear)}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-xs text-muted-foreground">
            No payment method on file. A card will be saved automatically
            when you purchase your first credit pack.
          </p>
        </div>
      )}
    </div>
  );
}

function CardBrandIcon({ brand }: { brand: string }) {
  return (
    <div className="flex size-9 items-center justify-center rounded-md border border-border bg-background">
      <span className="text-[0.6rem] font-bold uppercase text-muted-foreground">
        {brand.slice(0, 4)}
      </span>
    </div>
  );
}
