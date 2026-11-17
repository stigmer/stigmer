"use client";

/**
 * An organization's policies: what it lets its members do, one switch per
 * policy, each saved the moment it is flipped (the instant-apply pattern
 * of the memory consent row). Editing needs `can_edit` on the
 * organization (its admins); anyone else reads the switches, and nobody
 * can flip one until the server has said yes.
 */
import { useCallback } from "react";
import { cn } from "@stigmer/design-tokens";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import {
  organizationPoliciesOf,
  useUpdateOrganizationPolicies,
} from "./useUpdateOrganizationPolicies.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { EditCheckFailed } from "./EditCheckFailed.js";
import { SwitchField } from "../internal/form/SwitchField.js";
import { FieldError } from "../internal/form/Field.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";

/** Props for {@link OrgPoliciesPanel}. */
export interface OrgPoliciesPanelProps {
  /** The ID of the organization whose policies to display and edit. */
  readonly org: string;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (org: Organization) => void;
  /**
   * Drawn inside another page's section (Organization preferences), which
   * says once who may change it: the panel then leaves out its own
   * "only admins" line. A permission check of its own that fails is still
   * said here, with its Try again, since it can fail while the host page's
   * check succeeds.
   */
  readonly embedded?: boolean;
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
export function OrgPoliciesPanel({ org, onUpdated, embedded = false, className }: OrgPoliciesPanelProps) {

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

  const stillOn = policies.membersCanCreateAgents ? "on" : "off";
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-3", className)}>
      <div className="stg:flex stg:items-start stg:gap-2">
        <SwitchField
          className="stg:flex-1"
          label="Members can create agents"
          hint="When on, every member can create agents. A member's agent is theirs to keep private or share with the organization. When off, only admins create agents."
          checked={policies.membersCanCreateAgents}
          onCheckedChange={(next) => void handleToggle(next)}
          disabled={isUpdating || !canEdit}
        />
        {isUpdating && <SpinnerIcon size={12} />}
      </div>
      {error && (
        <FieldError>
          Couldn&apos;t change the policy. It&apos;s still {stillOn}; try again.
        </FieldError>
      )}

      {editDenied && !embedded && (
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          Only organization admins can change these policies.
        </p>
      )}
      {/* Its own check can fail while the host page's succeeds: always said here, with Try again. */}
      {checkFailed && <EditCheckFailed what="change these policies" onRetry={editCheck.refetch} />}
    </div>
  );
}
