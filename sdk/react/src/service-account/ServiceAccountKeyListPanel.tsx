"use client";

/**
 * The API keys that speak for one service account, with revoke: the same
 * rows and inline confirmation as a person's own key list, fed by
 * `apiKey.findByAccount` instead of the caller's own keys. Revoking is the
 * ordinary key delete, which the organization's admins may make on a
 * service account's key.
 */
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
}

/**
 * Lists a service account's API keys, each revocable.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ServiceAccountKeyListPanel serviceAccountId={account.metadata!.id} />
 * ```
 */
export function ServiceAccountKeyListPanel({
  serviceAccountId,
  onRefetchRef,
  className,
  now,
}: ServiceAccountKeyListPanelProps) {
  const { apiKeys, isLoading, error, refetch } = useServiceAccountKeyList(
    serviceAccountId || null,
  );

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  return (
    <ApiKeyListView
      apiKeys={apiKeys}
      isLoading={isLoading}
      error={error}
      onDeleted={refetch}
      emptyText="No keys yet. Create one for each place this service account runs."
      className={className}
      now={now}
    />
  );
}
