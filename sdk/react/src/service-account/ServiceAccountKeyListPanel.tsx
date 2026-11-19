"use client";

/**
 * The API keys that speak for one service account, with revoke: the same
 * rows and inline confirmation as a person's own key list, fed by
 * `apiKey.listByAccount` instead of the caller's own keys. Revoking is the
 * ordinary key delete, which the organization's admins may make on a
 * service account's key.
 */
import { useEffect } from "react";
import { ApiKeyListView } from "../api-key/ApiKeyListPanel.js";
import { useServiceAccountKeyList } from "./useServiceAccountKeyList.js";

/** Props for {@link ServiceAccountKeyListPanel}. */
export interface ServiceAccountKeyListPanelProps {
  /** The service account whose keys to list, by id. */
  readonly serviceAccountId: string;
  /** Re-expose refetch so a parent re-reads the list after creating a key. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  readonly className?: string;
  /**
   * Reference instant for the "last used" stamp. Deterministic hosts
   * (documentation embeds) pass a frozen instant.
   */
  readonly now?: Date;
  /**
   * Told how many keys the account has once the whole list has loaded, and
   * `null` while it loads, when it failed or while more pages remain: a
   * host's heading carries the count ("API keys 2").
   */
  readonly onCountChange?: (count: number | null) => void;
}

/**
 * Lists a service account's API keys, each revocable.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ServiceAccountKeyListPanel serviceAccountId="ida_01jabc" />
 * ```
 */
export function ServiceAccountKeyListPanel({
  serviceAccountId,
  onRefetchRef,
  className,
  now,
  onCountChange,
}: ServiceAccountKeyListPanelProps) {
  const { apiKeys, isLoading, error, refetch, ...pager } = useServiceAccountKeyList(
    serviceAccountId || null,
  );
  const count = isLoading || error !== null || pager.hasMore ? null : apiKeys.length;
  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  return (
    <ApiKeyListView
      apiKeys={apiKeys}
      isLoading={isLoading}
      error={error}
      onDeleted={refetch}
      onRetry={refetch}
      emptyText="No keys yet"
      emptyDescription="Create one for each place this service account runs."
      className={className}
      now={now}
      pager={pager}
    />
  );
}
