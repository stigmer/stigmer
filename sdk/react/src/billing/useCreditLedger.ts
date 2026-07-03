"use client";

import type {
  CreditLedgerResponse,
} from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type {
  LedgerEntryType,
  LedgerView,
} from "@stigmer/protos/ai/stigmer/billing/v1/enum_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link useCreditLedger}. */
export interface UseCreditLedgerReturn {
  /** The ledger response, or `null` before the first successful fetch. */
  readonly ledger: CreditLedgerResponse | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

/** Options for {@link useCreditLedger}. */
export interface UseCreditLedgerOptions {
  /** 1-based page number. Defaults to 1. */
  readonly pageNum?: number;
  /** Page size. Defaults to 20. */
  readonly pageSize?: number;
  /** Filter to specific ledger entry types. Empty means all types. */
  readonly typeFilter?: LedgerEntryType[];
  /**
   * Server-resolved ledger slice. When set to `LedgerView.statement`, the
   * server returns only customer-facing money-movement entry types and
   * excludes internal mechanics (per-call usage debits, reservation
   * holds/releases). Defaults to the full ledger.
   */
  readonly view?: LedgerView;
}

/**
 * Data hook that fetches paginated credit ledger entries for an organization.
 *
 * Calls `billing.getCreditLedger` with optional pagination and type
 * filtering. Returns the entries and total page count for building
 * pagination controls.
 *
 * Pass `null` as `orgId` to skip fetching (stable no-op).
 *
 * @param orgId - Organization ID, or `null` to skip.
 * @param options - Pagination and filter options.
 *
 * @example
 * ```tsx
 * const { ledger, isLoading } = useCreditLedger(orgId, { pageNum: 1 });
 *
 * if (isLoading) return <Skeleton />;
 * if (!ledger) return null;
 *
 * return ledger.entries.map(entry => <LedgerRow key={entry.entryId} entry={entry} />);
 * ```
 */
export function useCreditLedger(
  orgId: string | null,
  options: UseCreditLedgerOptions = {},
): UseCreditLedgerReturn {
  const stigmer = useStigmer();
  const { pageNum = 1, pageSize = 20, typeFilter, view } = options;

  const typeFilterKey = typeFilter?.join(",") ?? "";

  const { data: ledger, isLoading, isRefetching, error, refetch } = useFetch(
    orgId
      ? () =>
          stigmer.billing.getCreditLedger({
            orgId,
            // The SDK page number is 0-based (matches the proto/backend); the
            // hook's pageNum is 1-based for ergonomic UI controls.
            page: { num: pageNum - 1, size: pageSize },
            typeFilter,
            view,
          })
      : null,
    [orgId, pageNum, pageSize, typeFilterKey, view, stigmer],
    null as CreditLedgerResponse | null,
  );

  return { ledger, isLoading, isRefetching, error, refetch };
}
