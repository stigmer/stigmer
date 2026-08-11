"use client";

import { useState, useCallback, useEffect } from "react";
import { cn } from "@stigmer/theme";
import type { AutoRechargeConfig } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useSetAutoRechargeConfig } from "./useSetAutoRechargeConfig.js";

/** Props for {@link AutoRechargeCard}. */
export interface AutoRechargeCardProps {
  /** Organization ID. */
  readonly orgId: string;
  /** Current auto-recharge configuration from the billing account. */
  readonly autoRecharge?: AutoRechargeConfig;
  /** Whether the account has a saved payment method. */
  readonly hasPaymentMethod: boolean;
  /** Account status — config disabled when suspended or closed. */
  readonly accountStatus: BillingAccountStatus;
  /** Called after a successful save so the parent can refresh account data. */
  readonly onSaved?: () => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

const MICROS_PER_DOLLAR = BigInt(1_000_000);

function microsToDollars(micros: bigint): string {
  if (micros === BigInt(0)) return "";
  const dollars = Number(micros) / 1_000_000;
  return dollars.toString();
}

function dollarsToMicros(value: string): bigint {
  const num = parseFloat(value);
  if (isNaN(num) || num < 0) return BigInt(0);
  return BigInt(Math.round(num * 1_000_000));
}

/**
 * Auto-recharge configuration card for the billing settings page.
 *
 * Shows a toggle to enable/disable auto-recharge, with input fields
 * for threshold, recharge amount, and monthly cap. Displays a
 * disabled state with an explanatory message when no payment method
 * is on file. Validates inputs client-side before submitting.
 *
 * @example
 * ```tsx
 * <AutoRechargeCard
 *   orgId={orgId}
 *   autoRecharge={account.autoRecharge}
 *   hasPaymentMethod={!!account.defaultPaymentMethod?.paymentMethodId}
 *   accountStatus={account.status}
 *   onSaved={refetch}
 * />
 * ```
 */
export function AutoRechargeCard({
  orgId,
  autoRecharge,
  hasPaymentMethod,
  accountStatus,
  onSaved,
  className,
}: AutoRechargeCardProps) {
  const { setConfig, isSubmitting, error, clearError } =
    useSetAutoRechargeConfig();

  const [enabled, setEnabled] = useState(autoRecharge?.enabled ?? false);
  const [threshold, setThreshold] = useState(
    microsToDollars(autoRecharge?.thresholdMicros ?? BigInt(0)),
  );
  const [amount, setAmount] = useState(
    microsToDollars(autoRecharge?.rechargeAmountMicros ?? BigInt(0)),
  );
  const [cap, setCap] = useState(
    microsToDollars(autoRecharge?.monthlyCapMicros ?? BigInt(0)),
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!autoRecharge) return;
    setEnabled(autoRecharge.enabled);
    setThreshold(microsToDollars(autoRecharge.thresholdMicros));
    setAmount(microsToDollars(autoRecharge.rechargeAmountMicros));
    setCap(microsToDollars(autoRecharge.monthlyCapMicros));
  }, [autoRecharge]);

  const isAccountActive =
    accountStatus === BillingAccountStatus.billing_account_active;
  const canConfigure = hasPaymentMethod && isAccountActive;

  const hasChanges =
    enabled !== (autoRecharge?.enabled ?? false) ||
    dollarsToMicros(threshold) !==
      (autoRecharge?.thresholdMicros ?? BigInt(0)) ||
    dollarsToMicros(amount) !==
      (autoRecharge?.rechargeAmountMicros ?? BigInt(0)) ||
    dollarsToMicros(cap) !== (autoRecharge?.monthlyCapMicros ?? BigInt(0));

  const handleSave = useCallback(async () => {
    clearError();
    setSaved(false);

    try {
      await setConfig({
        orgId,
        enabled,
        thresholdMicros: dollarsToMicros(threshold),
        rechargeAmountMicros: dollarsToMicros(amount),
        monthlyCapMicros: dollarsToMicros(cap),
      });
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // error state is managed by the hook
    }
  }, [orgId, enabled, threshold, amount, cap, setConfig, clearError, onSaved]);

  return (
    <div
      className={cn(
        "stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-4 stg:py-4",
        className,
      )}
    >
      <div className="stg:flex stg:items-center stg:justify-between">
        <div>
          <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">
            Auto-Recharge
          </h3>
          <p className="stg:mt-0.5 stg:text-[0.7rem] stg:text-muted-foreground">
            Automatically add credits when your balance runs low.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={!canConfigure || isSubmitting}
          onClick={() => setEnabled((prev) => !prev)}
          className={cn(
            "stg:relative stg:inline-flex stg:h-5 stg:w-9 stg:shrink-0 stg:rounded-full stg:transition-colors",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
            enabled ? "stg:bg-primary" : "stg:bg-muted",
          )}
        >
          <span
            className={cn(
              "stg:pointer-events-none stg:block stg:size-4 stg:rounded-full stg:bg-background stg:shadow-sm stg:ring-0 stg:transition-transform",
              enabled ? "stg:translate-x-4" : "stg:translate-x-0.5",
              "stg:mt-0.5",
            )}
          />
        </button>
      </div>

      {!hasPaymentMethod && (
        <p className="stg:mt-3 stg:text-xs stg:text-muted-foreground">
          A saved payment method is required to enable auto-recharge.
          Purchase a credit pack first to save a card.
        </p>
      )}

      {canConfigure && (
        <div className="stg:mt-4 stg:space-y-3">
          <DollarInput
            id="ar-threshold"
            label="When balance drops below"
            value={threshold}
            onChange={setThreshold}
            disabled={isSubmitting}
            placeholder="e.g. 5"
          />
          <DollarInput
            id="ar-amount"
            label="Recharge amount"
            value={amount}
            onChange={setAmount}
            disabled={isSubmitting}
            placeholder="e.g. 50"
          />
          <DollarInput
            id="ar-cap"
            label="Monthly cap"
            value={cap}
            onChange={setCap}
            disabled={isSubmitting}
            placeholder="e.g. 200"
          />

          <div className="stg:flex stg:items-center stg:gap-3 stg:pt-1">
            <button
              type="button"
              disabled={!hasChanges || isSubmitting}
              onClick={handleSave}
              className={cn(
                "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:transition-colors",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                "stg:disabled:pointer-events-none stg:disabled:opacity-50",
              )}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Saving\u2026" : "Save"}
            </button>
            {saved && (
              <span className="stg:text-xs stg:text-emerald-600 stg:dark:text-emerald-400">
                Saved
              </span>
            )}
          </div>

          {error && (
            <p className="stg:text-xs stg:text-destructive" role="alert">
              {getUserMessage(error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DollarInput (internal)
// ---------------------------------------------------------------------------

function DollarInput({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="stg:block stg:text-xs stg:text-muted-foreground">
        {label}
      </label>
      <div className="stg:relative stg:mt-1">
        <span className="stg:pointer-events-none stg:absolute stg:left-2.5 stg:top-1/2 stg:-translate-y-1/2 stg:text-xs stg:text-muted-foreground">
          $
        </span>
        <input
          id={id}
          type="number"
          min="0"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={placeholder}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:py-1.5 stg:pl-6 stg:pr-3 stg:text-xs stg:tabular-nums",
            "stg:text-foreground stg:placeholder:text-muted-foreground-subtle",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:cursor-not-allowed stg:disabled:opacity-50",
          )}
        />
      </div>
    </div>
  );
}
