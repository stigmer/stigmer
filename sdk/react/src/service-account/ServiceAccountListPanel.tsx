"use client";

/**
 * An organization's service accounts as a list an admin opens one from: each
 * row names the account, its organization role and when it was created.
 *
 * The role comes from the organization's access list, the one the Members
 * page reads, so both pages agree on it. An account whose role was removed is
 * still listed, with no role, so it can be given one again or deleted.
 */
import { useCallback } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { iamRoleDisplayName } from "@stigmer/client";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useResourceAccess } from "../grant/useResourceAccess.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";
import { orgRoleOf } from "./org-role.js";
import { useServiceAccountList } from "./useServiceAccountList.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Tag } from "../internal/surface/Tag.js";

/** Props for {@link ServiceAccountListPanel}. */
export interface ServiceAccountListPanelProps {
  /** The organization whose service accounts to list, by id. */
  readonly org: string;
  /** Fired when the user opens a service account. */
  readonly onOpen?: (serviceAccount: IdentityAccount) => void;
  /** Re-expose refetch so a parent re-reads the list after a change. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  readonly className?: string;
  /**
   * The page's create act, carried by the empty list (the same label and
   * handler as the page header's button). Absent when the caller may not
   * create one, or a create is already open.
   */
  readonly emptyAction?: EmptyStateAction;
}

/**
 * Lists an organization's service accounts, newest first.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
 *
 * function ServiceAccounts({ onOpen }: { onOpen: (account: IdentityAccount) => void }) {
 *   return <ServiceAccountListPanel org="org_acme" onOpen={onOpen} />;
 * }
 * ```
 */
export function ServiceAccountListPanel({
  org,
  onOpen,
  onRefetchRef,
  emptyAction,
  className,
}: ServiceAccountListPanelProps) {
  const { serviceAccounts, isLoading, error, refetch } = useServiceAccountList(
    org || null,
  );
  const access = useResourceAccess(org ? { kind: "organization", id: org } : null);
  const refetchAccess = access.refetch;

  const refetchBoth = useCallback(() => {
    refetch();
    refetchAccess();
  }, [refetch, refetchAccess]);

  if (onRefetchRef) {
    onRefetchRef(refetchBoth);
  }

  if (isLoading) {
    return <SettingsSkeleton label="Loading service accounts" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the service accounts." retry={refetch} className={className} />;
  }

  if (serviceAccounts.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title="No service accounts yet"
        description="Make one for each CI job, script or integration, so it keeps working when the person who set it up leaves."
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <List aria-label="Service accounts" className={className}>
      {serviceAccounts.map((account) => {
        const id = account.metadata?.id ?? "";
        const name = account.metadata?.name || id;
        const role = orgRoleOf(access.members, id);
        const createdAt = account.status?.audit?.specAudit?.createdAt;
        return (
          <ListRow
            key={id}
            onClick={() => onOpen?.(account)}
            leading={
              <span className="stg:flex stg:size-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
                {name.charAt(0).toUpperCase()}
              </span>
            }
            name={
              <>
                {/* The row's button is named "Open <name>", as it was when the whole row was the button. */}
                <span className="stg:sr-only">Open </span>
                {name}
              </>
            }
            description={createdAt ? `Created ${formatShortDate(timestampDate(createdAt))}` : undefined}
            trailing={
              <Tag>{access.isLoading ? "…" : role ? iamRoleDisplayName(role.role) : "No role"}</Tag>
            }
          />
        );
      })}
    </List>
  );
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
