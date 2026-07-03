"use client";

import { create } from "@bufbuild/protobuf";
import {
  GetOrCreateBillingAccountInputSchema,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { BillingAccount } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

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
 * Pass `null` as `orgId` to skip fetching (stable no-op).
 *
 * @param orgId - Organization ID, or `null` to skip.
 *
 * @example
 * ```tsx
 * const { account, isLoading, error } = useBillingAccount(orgId);
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <ErrorMessage error={error} />;
 * if (!account) return null;
 *
 * return <div>Balance: {formatCreditBalance(account.balance?.availableMicros)}</div>;
 * ```
 */
export function useBillingAccount(
  orgId: string | null,
): UseBillingAccountReturn {
  const stigmer = useStigmer();

  const { data: account, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.billing.getOrCreateBillingAccount(orgId)
      : null,
    [orgId, stigmer],
    null as BillingAccount | null,
  );

  return { account, isLoading, isRefetching, error, refetch };
}
