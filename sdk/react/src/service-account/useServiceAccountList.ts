"use client";

/**
 * Data hook for an organization's service accounts: the accounts its
 * automation acts as through API keys.
 *
 * The server lists every service account of the organization, newest first,
 * including one whose role was removed, so an admin can still find and delete
 * it. An organization has few of them, so the hook reads every page and hands
 * back one list; the page size is the server's to cap. A bounded page count
 * keeps a server that misreports its total from looping the client.
 */
import { create } from "@bufbuild/protobuf";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ListWithIdentityOrgSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/io_pb";
import { PageInfoSchema } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import type { Stigmer } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Accounts asked for per page. */
const PAGE_SIZE = 100;

/** The most pages read, whatever total the server reports. */
const MAX_PAGES = 20;

/** Return value of {@link useServiceAccountList}. */
export interface UseServiceAccountListReturn {
  /** The organization's service accounts, newest first. Empty while loading or on error. */
  readonly serviceAccounts: readonly IdentityAccount[];
  /** `true` while the first fetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight and stale data is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list from the server, after a create, rename or delete. */
  readonly refetch: () => void;
}

/**
 * Data hook that lists an organization's service accounts
 * (`identityAccount.listServiceAccounts`).
 *
 * Pass `null` to skip fetching. The server answers only a caller who holds
 * `can_create_identity_account` on the organization (its admins).
 *
 * @example
 * ```tsx
 * const { serviceAccounts, isLoading, error } = useServiceAccountList(orgId);
 * serviceAccounts.map((account) => account.metadata?.name);
 * ```
 */
export function useServiceAccountList(
  org: string | null,
): UseServiceAccountListReturn {
  const stigmer = useStigmer();

  const { data: serviceAccounts, isLoading, isRefetching, error, refetch } = useFetch(
    org ? () => listEveryServiceAccount(stigmer, org) : null,
    [org, stigmer],
    [] as IdentityAccount[],
  );

  return { serviceAccounts, isLoading, isRefetching, error, refetch };
}

async function listEveryServiceAccount(
  stigmer: Stigmer,
  org: string,
): Promise<IdentityAccount[]> {
  const accounts: IdentityAccount[] = [];
  for (let num = 1; num <= MAX_PAGES; num++) {
    const page = await stigmer.identityAccount.listServiceAccounts(
      create(ListWithIdentityOrgSchema, {
        org,
        page: create(PageInfoSchema, { num, size: PAGE_SIZE }),
      }),
    );
    accounts.push(...page.entries);
    if (page.entries.length === 0 || num >= page.totalPages) break;
  }
  return accounts;
}
