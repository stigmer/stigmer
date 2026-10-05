"use client";

import { useId } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { useSingleOrg } from "../server-info.js";
import { useChildOrganizations } from "./useChildOrganizations.js";

/** Props for {@link ChildOrganizationsList}. */
export interface ChildOrganizationsListProps {
  /** The id of the parent organization whose children to list. */
  readonly org: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Read-only list of an organization's child organizations: each child's
 * name, slug and external id (the parent's own identifier for it), newest
 * first, with "Load more" while the server holds more.
 *
 * Renders nothing unless the caller may manage the organization's children
 * (`can_manage_child_orgs`, checked fail-closed so nothing flashes for a
 * caller the server would refuse), the server holds more than one
 * organization, and the organization has at least one child. A parent's
 * admins manage a child's settings and members and see its billing, but
 * read none of its resources; the list says so.
 *
 * @example
 * ```tsx
 * <ChildOrganizationsList org="org-id-123" />
 * ```
 */
export function ChildOrganizationsList({ org, className }: ChildOrganizationsListProps) {
  const headingId = useId();
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

  return (
    <section aria-labelledby={headingId} className={cn("stg:mt-8", className)}>
      <h3 id={headingId} className="stg:text-foreground stg:mb-1 stg:text-xs stg:font-semibold">
        Child organizations
      </h3>
      <p className="stg:text-muted-foreground stg:mb-3 stg:text-xs">
        Organizations under this one. Their admins and this organization&apos;s admins manage them; this
        organization&apos;s admins see none of their agents, sessions or files unless they join as a member.
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
