"use client";

/**
 * An organization's policies: what it lets its members do, one switch per
 * policy, each saved the moment it is flipped (the instant-apply pattern
 * of the memory consent row). Editing needs `can_edit` on the
 * organization (its admins); anyone else reads the switches.
 */
import { useCallback, useId } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import {
  organizationPoliciesOf,
  useUpdateOrganizationPolicies,
} from "./useUpdateOrganizationPolicies.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { Switch } from "../switch/Switch.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

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
  // Fail-open: a server without sign-in answers every check allowed, and
  // the server refuses a save the answer missed.
  const { allowed: canEdit } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_edit",
  );

  const policies = organizationPoliciesOf(organization);

  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!organization) return;
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
    return (
      <LoadingRegion className={cn("stg:space-y-4", className)} label="Loading organization policies">
        <div className="stg:bg-muted-subtle stg:h-12 stg:animate-pulse stg:rounded" />
      </LoadingRegion>
    );
  }

  if (fetchError) {
    return (
      <div className={cn("stg:space-y-3", className)} role="alert">
        <p className="stg:text-destructive stg:text-sm">{getUserMessage(fetchError)}</p>
        <button
          type="button"
          onClick={refetch}
          className={cn(
            "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
          )}
        >
          Retry
        </button>
      </div>
    );
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
            <p id={descriptionId} className="stg:text-[0.65rem] stg:leading-snug stg:text-muted-foreground">
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
          <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
            {getUserMessage(error)}
          </p>
        )}
      </div>

      {!canEdit && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Only organization admins can change these policies.
        </p>
      )}
    </div>
  );
}
