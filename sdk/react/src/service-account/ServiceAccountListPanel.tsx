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
import { cn } from "@stigmer/design-tokens";
import { iamRoleDisplayName } from "@stigmer/client";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useResourceAccess } from "../grant/useResourceAccess.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { orgRoleOf } from "./org-role.js";
import { useServiceAccountList } from "./useServiceAccountList.js";

/** Props for {@link ServiceAccountListPanel}. */
export interface ServiceAccountListPanelProps {
  /** The organization whose service accounts to list, by id. */
  readonly org: string;
  /** Fired when the user opens a service account. */
  readonly onOpen?: (serviceAccount: IdentityAccount) => void;
  /** Re-expose refetch so a parent re-reads the list after a change. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  readonly className?: string;
}

/**
 * Lists an organization's service accounts, newest first.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ServiceAccountListPanel org={orgId} onOpen={(account) => setOpen(account)} />
 * ```
 */
export function ServiceAccountListPanel({
  org,
  onOpen,
  onRefetchRef,
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
    return <ErrorMessage error={error} title="The service accounts could not be read" retry={refetch} className={className} />;
  }

  if (serviceAccounts.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title="No service accounts yet"
        description="Make one for each CI job, script or integration, so it keeps working when the person who set it up leaves."
        className={cn("stg:rounded-lg stg:border stg:border-dashed stg:border-border", className)}
      />
    );
  }

  return (
    <div className={cn("stg:space-y-2", className)} role="list" aria-label="Service accounts">
      {serviceAccounts.map((account) => {
        const id = account.metadata?.id ?? "";
        const name = account.metadata?.name || id;
        const role = orgRoleOf(access.members, id);
        const createdAt = account.status?.audit?.specAudit?.createdAt;
        return (
          <div role="listitem" key={id}>
            <button
              type="button"
              onClick={() => onOpen?.(account)}
              aria-label={`Open ${name}`}
              className="stg:flex stg:w-full stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:text-left stg:hover:border-border stg:transition-colors"
            >
              <span className="stg:flex stg:size-8 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted stg:text-xs stg:font-medium stg:text-muted-foreground">
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="stg:min-w-0 stg:flex-1">
                <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
                  {name}
                </span>
                {createdAt && (
                  <span className="stg:block stg:text-xs stg:text-muted-foreground">
                    Created {formatShortDate(timestampDate(createdAt))}
                  </span>
                )}
              </span>
              <span className="stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:text-foreground">
                {access.isLoading ? "…" : role ? iamRoleDisplayName(role.role) : "No role"}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
