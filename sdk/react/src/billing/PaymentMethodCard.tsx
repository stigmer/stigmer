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
        "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-4",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">
          Payment Method
        </h3>
        {hasPm && (
          <button
            type="button"
            disabled={!isAccountActive || isPortalLoading}
            onClick={onManage}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:text-muted-foreground stg:hover:bg-accent stg:hover:text-foreground",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
            aria-busy={isPortalLoading}
          >
            {isPortalLoading ? "Opening\u2026" : "Manage"}
          </button>
        )}
      </div>

      {hasPm ? (
        <div className="stg:mt-2 stg:flex stg:items-center stg:gap-3">
          <CardBrandIcon brand={paymentMethod.brand} />
          <div>
            <div className="stg:text-sm stg:font-medium stg:text-foreground">
              {formatBrand(paymentMethod.brand)} ····{" "}
              {paymentMethod.last4}
            </div>
            <div className="stg:text-xs stg:text-muted-foreground">
              Expires{" "}
              {formatExpiry(paymentMethod.expMonth, paymentMethod.expYear)}
            </div>
          </div>
        </div>
      ) : (
        <div className="stg:mt-2">
          <p className="stg:text-xs stg:text-muted-foreground">
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
    <div className="stg:flex stg:size-9 stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-background">
      <span className="stg:text-[0.6rem] stg:font-bold stg:uppercase stg:text-muted-foreground">
        {brand.slice(0, 4)}
      </span>
    </div>
  );
}
