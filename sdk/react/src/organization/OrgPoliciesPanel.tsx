"use client";

/**
 * An organization's policies: what it lets its members do, one switch per
 * policy, each saved the moment it is flipped (the instant-apply pattern
 * of the memory consent row). Editing needs `can_edit` on the
 * organization (its admins); anyone else reads the switches, and nobody
 * can flip one until the server has said yes.
 */
import { useCallback, useId } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import {
  organizationPoliciesOf,
  useUpdateOrganizationPolicies,
} from "./useUpdateOrganizationPolicies.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { EditCheckFailed } from "./EditCheckFailed.js";
import { Switch } from "../switch/Switch.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";

/** Props for {@link OrgPoliciesPanel}. */
export interface OrgPoliciesPanelProps {
  /** The ID of the organization whose policies to display and edit. */
  readonly org: string;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for an organization's policies
 * (`spec.policies`), saved through `organization.updatePolicies()`.
 *
 * All visual properties flow through `--stgm-*` design tokens; no routing
 * or auth dependencies, so a platform builder can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgPoliciesPanel org="org-id-123" />
 * ```
 */
export function OrgPoliciesPanel({ org, onUpdated, className }: OrgPoliciesPanelProps) {
  const baseId = useId();
  const switchId = `${baseId}-members-create-agents`;
  const titleId = `${switchId}-title`;
  const descriptionId = `${switchId}-description`;

  const { organization, isLoading, error: fetchError, refetch } = useOrganization(org || null);
  const { updatePolicies, isUpdating, error } = useUpdateOrganizationPolicies();
  // Editing is the admins' (`can_edit`), offered only on the server's yes:
  // never while the check is in flight and never on a failed check (the
  // check fails closed), so a member never sees an editable form. A settled
  // no says who can; a failed check says it could not check, and the
  // content stays read-only (stigmer#2662).
  const editCheck = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_edit", { fail: "closed" });
  const canEdit = !editCheck.isLoading && editCheck.allowed;
  const checkFailed = !editCheck.isLoading && editCheck.error !== null;
  const editDenied = !editCheck.isLoading && !checkFailed && !editCheck.allowed;

  const policies = organizationPoliciesOf(organization);

  // The switch renders only once the organization has loaded, so the
  // stored policies spread here are the organization's own.
  const handleToggle = useCallback(
    async (next: boolean) => {
      try {
        const updated = await updatePolicies(org, {
          ...organizationPoliciesOf(organization),
          membersCanCreateAgents: next,
        });
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOrganizationPolicies
      }
    },
    [organization, org, updatePolicies, refetch, onUpdated],
  );

  if (isLoading && !organization) {
    return <SettingsSkeleton label="Loading organization policies" rows={2} className={className} />;
  }

  if (fetchError) {
    return <ErrorMessage error={fetchError} title="Couldn't load the policies." retry={refetch} className={className} />;
  }

  if (!organization) return null;

  return (
    <div className={cn("stg:space-y-4", className)}>
      <div className="stg:space-y-1">
        <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
          <div className="stg:min-w-0 stg:flex-1">
            <span id={titleId} className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
              Members can create agents
            </span>
            <p id={descriptionId} className="stg:text-2xs stg:leading-snug stg:text-muted-foreground">
              When on, every member can create agents. A member&apos;s agent is theirs to keep
              private or share with the organization. When off, only admins create agents.
              Changes apply immediately.
            </p>
          </div>
          <span className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
            {isUpdating && <SpinnerIcon size={12} />}
            <Switch
              id={switchId}
              checked={policies.membersCanCreateAgents}
              onCheckedChange={(next) => void handleToggle(next)}
              disabled={isUpdating || !canEdit}
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
            />
          </span>
        </div>
        {error && (
          <p className="stg:text-2xs stg:text-destructive" role="alert">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      {editDenied && (
        <p className="stg:text-2xs stg:text-muted-foreground">
          Only organization admins can change these policies.
        </p>
      )}
      {checkFailed && <EditCheckFailed what="change these policies" onRetry={editCheck.refetch} />}
    </div>
  );
}
