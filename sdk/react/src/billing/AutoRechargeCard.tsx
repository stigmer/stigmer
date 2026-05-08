"use client";

import { useState, useCallback, useEffect } from "react";
import { cn } from "@stigmer/theme";
import type { AutoRechargeConfig } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { BillingAccountStatus } from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useSetAutoRechargeConfig } from "./useSetAutoRechargeConfig";

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
        "rounded-lg border border-border bg-card px-4 py-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold text-foreground">
            Auto-Recharge
          </h3>
          <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
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
            "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            enabled ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
              enabled ? "translate-x-4" : "translate-x-0.5",
              "mt-0.5",
            )}
          />
        </button>
      </div>

      {!hasPaymentMethod && (
        <p className="mt-3 text-xs text-muted-foreground">
          A saved payment method is required to enable auto-recharge.
          Purchase a credit pack first to save a card.
        </p>
      )}

      {canConfigure && (
        <div className="mt-4 space-y-3">
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

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={!hasChanges || isSubmitting}
              onClick={handleSave}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                "bg-primary text-primary-foreground hover:bg-primary-hover",
                "disabled:pointer-events-none disabled:opacity-50",
              )}
              aria-busy={isSubmitting}
            >
              {isSubmitting ? "Saving\u2026" : "Save"}
            </button>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                Saved
              </span>
            )}
          </div>

          {error && (
            <p className="text-xs text-destructive" role="alert">
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
      <label htmlFor={id} className="block text-xs text-muted-foreground">
        {label}
      </label>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
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
            "w-full rounded-md border border-input bg-background py-1.5 pl-6 pr-3 text-xs tabular-nums",
            "text-foreground placeholder:text-muted-foreground-subtle",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      </div>
    </div>
  );
}
