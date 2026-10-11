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
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleDisplayName } from "@stigmer/sdk";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useResourceAccess } from "../iam-policy/useResourceAccess.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
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
    return (
      <LoadingRegion className={cn("stg:space-y-2", className)} label="Loading service accounts">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg" />
        ))}
      </LoadingRegion>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (serviceAccounts.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        No service accounts yet.
      </p>
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
              <span className="stg:shrink-0 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-foreground">
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
