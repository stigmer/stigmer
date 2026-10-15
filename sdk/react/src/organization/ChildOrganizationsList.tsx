"use client";

import { useId } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useSingleOrg } from "../server-info.js";
import { useChildOrganizations } from "./useChildOrganizations.js";
import { useOptionalOrg } from "./OrgProvider.js";

/** Props for {@link ChildOrganizationsList}. */
export interface ChildOrganizationsListProps {
  /** The id of the parent organization whose children to list. */
  readonly org: string;
  /**
   * Called when the user opens a child organization from the list, after
   * it has become the active organization.
   *
   * This fires only on the user's act, as `OrgSwitcher`'s callback of the
   * same name does. Use it to navigate (to the child's dashboard, say);
   * without it the page stays where it is and renders as the child's.
   */
  readonly onOrgChanged?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * List of an organization's child organizations: each child's name, slug
 * and external id (the parent's own identifier for it), newest first, with
 * "Load more" while the server holds more.
 *
 * Inside an {@link OrgProvider} each row has an Open action that makes the
 * child the active organization (the provider keeps it across reloads, and
 * `OrgSwitcher` shows it while it is open), then calls `onOrgChanged`.
 * Outside one the list has no actions.
 *
 * Renders nothing unless the caller may manage the organization's children
 * (`can_manage_child_orgs`, checked fail-closed so nothing flashes for a
 * caller the server would refuse), the server holds more than one
 * organization, and the organization has at least one child. A parent's
 * admins are admins in every child, with no joining step, while each
 * person's conversations, My vault and memories stay private to them; the
 * list says so.
 *
 * @example
 * ```tsx
 * <ChildOrganizationsList org="org-id-123" onOrgChanged={() => navigate("/dashboard")} />
 * ```
 */
export function ChildOrganizationsList({
  org,
  onOrgChanged,
  className,
}: ChildOrganizationsListProps) {
  const headingId = useId();
  const setActiveOrg = useOptionalOrg()?.setActiveOrg;
  const singleOrg = useSingleOrg();
  const check = useCheckPermission(
    org && singleOrg === false ? { kind: "organization", id: org } : null,
    "can_manage_child_orgs",
    { fail: "closed" },
  );
  const allowed = singleOrg === false && !check.isLoading && check.allowed;
  const { children, hasMore, loadMore, isLoadingMore, loadMoreError, error } =
    useChildOrganizations(allowed ? org : null);

  if (!allowed || (children.length === 0 && error === null)) {
    return null;
  }

  const open = (child: Organization) => {
    setActiveOrg?.(child);
    onOrgChanged?.(child);
  };

  return (
    <section aria-labelledby={headingId} className={cn("stg:mt-8", className)}>
      <h3 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-xs stg:font-semibold">
        Child organizations
      </h3>
      <p className="stg:text-muted-foreground stg:mb-3 stg:text-xs">
        Organizations under this one. This organization&apos;s admins are admins in each of them, as their own
        admins are; each person&apos;s conversations, My vault and memories stay private to them.
        {setActiveOrg && " Open one to work in it as its admin."}
      </p>
      {error !== null ? (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(error)}
        </p>
      ) : (
        <table className="stg:w-full stg:text-left stg:text-xs">
          <thead className="stg:text-muted-foreground">
            <tr>
              <th scope="col" className="stg:py-1.5 stg:font-medium">Name</th>
              <th scope="col" className="stg:py-1.5 stg:font-medium">Slug</th>
              <th scope="col" className="stg:py-1.5 stg:font-medium">External id</th>
              {setActiveOrg && (
                <th scope="col" className="stg:py-1.5">
                  <span className="stg:sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {children.map((child) => (
              <tr key={child.metadata?.id} className="stg:border-t stg:border-border">
                <td className="stg:py-1.5 stg:text-foreground">{child.metadata?.name}</td>
                <td className="stg:py-1.5 stg:font-mono stg:text-foreground">{child.metadata?.slug}</td>
                <td className="stg:py-1.5 stg:font-mono stg:text-muted-foreground">
                  {child.spec?.externalId || "—"}
                </td>
                {setActiveOrg && (
                  <td className="stg:py-1.5 stg:text-right">
                    <button
                      type="button"
                      onClick={() => open(child)}
                      aria-label={`Open ${child.metadata?.name || child.metadata?.slug || "organization"}`}
                      className="stg:text-primary stg:text-xs stg:font-medium stg:hover:underline"
                    >
                      Open
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {loadMoreError !== null && (
        <p className="stg:text-destructive stg:mt-2 stg:text-xs" role="alert">
          {getUserMessage(loadMoreError)}
        </p>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={loadMore}
          disabled={isLoadingMore}
          className="stg:text-primary stg:mt-2 stg:text-xs stg:font-medium stg:hover:underline stg:disabled:opacity-50"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
