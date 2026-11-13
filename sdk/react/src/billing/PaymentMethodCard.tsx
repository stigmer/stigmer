"use client";

import { Button } from "../button/Button.js";
import { Card } from "../internal/surface/Card.js";
import type { PaymentMethodSummary } from "@stigmer/apis/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/apis/ai/stigmer/billing/v1/enum_pb";

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
  /**
   * Called when the user clicks "Add payment method" with none on file:
   * the host opens Stripe's page to save a card without a charge. Absent,
   * the card has no add action.
   */
  readonly onAdd?: () => void;
  /** `true` while the card page is being opened. */
  readonly isAdding?: boolean;
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
 * function PaymentMethod({ org }: { org: string }) {
 *   const { account } = useBillingAccount(org);
 *   const { openPortal } = useCreateBillingPortalSession();
 *   if (!account) return null;
 *   return (
 *     <PaymentMethodCard paymentMethod={account.defaultPaymentMethod} accountStatus={account.status} onManage={() => openPortal(org)} />
 *   );
 * }
 * ```
 */
export function PaymentMethodCard({
  paymentMethod,
  accountStatus,
  isPortalLoading,
  onManage,
  onAdd,
  isAdding,
  className,
}: PaymentMethodCardProps) {
  const isAccountActive =
    accountStatus === BillingAccountStatus.billing_account_active;
  const hasPm =
    paymentMethod != null && paymentMethod.paymentMethodId !== "";

  return (
    <Card className={className}>
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">
          Payment Method
        </h3>
        {hasPm && (
          <Button
            variant="ghost"
            size="xs"
            disabled={!isAccountActive || isPortalLoading}
            onClick={onManage}
            aria-busy={isPortalLoading}
          >
            {isPortalLoading ? "Opening\u2026" : "Manage"}
          </Button>
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
            No payment method on file. A saved card is needed to subscribe to
            a plan; each period&apos;s invoice is charged to it.
          </p>
          {onAdd && (
            <Button
              variant="ghost"
              size="xs"
              disabled={!isAccountActive || isAdding}
              onClick={onAdd}
              aria-busy={isAdding}
              className="stg:mt-2"
            >
              {isAdding ? "Opening\u2026" : "Add payment method"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function CardBrandIcon({ brand }: { brand: string }) {
  return (
    <div className="stg:flex stg:size-9 stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-background">
      <span className="stg:text-2xs stg:font-bold stg:uppercase stg:text-muted-foreground">
        {brand.slice(0, 4)}
      </span>
    </div>
  );
}
