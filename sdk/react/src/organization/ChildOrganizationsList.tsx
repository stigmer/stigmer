"use client";

import { useId } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useSingleOrg } from "../server-info.js";
import { useChildOrganizations } from "./useChildOrganizations.js";
import { useOptionalOrg } from "./OrgProvider.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Button } from "../button/Button.js";
import { Table } from "../internal/surface/Table.js";
import { FieldError } from "../internal/form/Field.js";
import { Tag } from "../internal/surface/Tag.js";

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
 * function ChildOrgs({ onOpen }: { onOpen: (href: string) => void }) {
 *   return <ChildOrganizationsList org="org_acme" onOrgChanged={() => onOpen("/dashboard")} />;
 * }
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
  const { children, hasMore, loadMore, isLoadingMore, loadMoreError, error, refetch } =
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
      <h3 id={headingId} className="stg:m-0 stg:mb-1 stg:text-sm stg:font-semibold stg:text-foreground">
        Child organizations
        {/* How many there are, part of the heading as it is drawn ("Child organizations 3"), once all are loaded. */}
        {!hasMore && children.length > 0 && " "}
        {!hasMore && children.length > 0 && <Tag className="stg:ml-1 stg:align-middle">{children.length}</Tag>}
      </h3>
      <p className="stg:m-0 stg:mb-3 stg:text-xs stg:text-muted-foreground">
        Organizations under this one. This organization&apos;s admins are admins in each of them, as their own
        admins are; each person&apos;s conversations, My vault and memories stay private to them.
        {setActiveOrg && " Open one to work in it as its admin."}
      </p>
      {error !== null ? (
        <ErrorMessage error={error} title="Couldn't load the child organizations." retry={refetch} />
      ) : (
        <Table
          aria-labelledby={headingId}
          rows={children}
          rowKey={(child) => child.metadata?.id ?? ""}
          columns={[
            {
              id: "name",
              header: "Name",
              cell: (child) => <span className="stg:font-medium">{child.metadata?.name}</span>,
            },
            {
              id: "slug",
              header: "Slug",
              cell: (child) => <span className="stg:font-mono">{child.metadata?.slug}</span>,
            },
            {
              id: "external-id",
              header: "External id",
              cell: (child) => <span className="stg:font-mono stg:text-muted-foreground">{child.spec?.externalId || "—"}</span>,
            },
          ]}
          rowAction={
            setActiveOrg
              ? (child) => (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => open(child)}
                    aria-label={`Open ${child.metadata?.name || child.metadata?.slug || "organization"}`}
                  >
                    Open
                  </Button>
                )
              : undefined
          }
        />
      )}
      {loadMoreError !== null && <FieldError className="stg:mt-2">{getUserMessage(loadMoreError)}</FieldError>}
      {hasMore && (
        <Button variant="ghost" size="xs" onClick={loadMore} disabled={isLoadingMore} className="stg:mt-2">
          {isLoadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}
