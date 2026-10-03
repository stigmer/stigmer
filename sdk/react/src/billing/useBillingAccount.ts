"use client";

import { create } from "@bufbuild/protobuf";
import {
  GetOrCreateBillingAccountInputSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { BillingAccount } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Options for {@link useBillingAccount}. */
export interface UseBillingAccountOptions {
  /**
   * Re-read the account when the window regains focus: for a host that
   * sends Stripe's pages to another window (the system browser), so a card
   * saved there shows on return. Default `false`.
   */
  readonly refetchOnWindowFocus?: boolean;
}

/** Return value of {@link useBillingAccount}. */
export interface UseBillingAccountReturn {
  /** The billing account, or `null` before the first successful fetch. */
  readonly account: BillingAccount | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches the billing account for an organization.
 *
 * Calls `billing.getOrCreateBillingAccount` which is idempotent —
 * creates the account on first call, returns the existing account
 * on subsequent calls. The returned `BillingAccount` includes
 * the embedded `CreditBalance` with available, reserved,
 * promotional, and purchased breakdowns.
 *
 * Pass `null` as `org` to skip fetching (stable no-op).
 *
 * @param org - Organization ID, or `null` to skip.
 *
 * @example
 * ```tsx
 * const { account, isLoading, error } = useBillingAccount(org);
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <ErrorMessage error={error} />;
 * if (!account) return null;
 *
 * return <div>Balance: {formatCreditBalance(account.balance?.availableMicros)}</div>;
 * ```
 */
export function useBillingAccount(
  org: string | null,
  options?: UseBillingAccountOptions,
): UseBillingAccountReturn {
  const stigmer = useStigmer();

  const { data: account, isLoading, isRefetching, error, refetch } = useFetch(
    org
      ? () =>
          stigmer.billing.getOrCreateBillingAccount(org)
      : null,
    [org, stigmer],
    null as BillingAccount | null,
    { refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false },
  );

  return { account, isLoading, isRefetching, error, refetch };
}
