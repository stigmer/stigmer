"use client";

import { useCallback } from "react";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { useOrganization } from "../organization/useOrganization.js";
import { useSingleOrg } from "../server-info.js";
import { VisibilityBadge, VisibilitySelector } from "./VisibilitySelector.js";
import {
  blueprintVisibilityLevels,
  environmentVisibilityLevels,
} from "./visibilityLevels.js";
import {
  useUpdateVisibility,
  type VisibilityResourceKind,
} from "./useUpdateVisibility.js";

/**
 * Maps a {@link VisibilityResourceKind} (which mirrors the SDK method namespace,
 * e.g. `mcpServer`) to the FGA object type used in authorization checks
 * (e.g. `mcp_server`). For the three blueprints these coincide, but the mapping
 * keeps the control correct for every kind it may serve.
 */
const FGA_KIND: Record<VisibilityResourceKind, string> = {
  agent: "agent",
  plugin: "plugin",
  skill: "skill",
  mcpServer: "mcp_server",
  environment: "environment",
};

/** Props for {@link ResourceVisibilityControl}. */
export interface ResourceVisibilityControlProps {
  /** Resource kind, selecting both the updateVisibility RPC and the FGA type. */
  readonly kind: VisibilityResourceKind;
  /** Id of the resource whose visibility is shown/edited. */
  readonly resourceId: string;
  /** Current visibility of the resource. */
  readonly visibility: ApiResourceVisibility;
  /**
   * The organization that OWNS the resource (`metadata.org`). Read to learn
   * whether it is itself a child organization, which gates the Child
   * organizations option for blueprints. When omitted, that option is
   * simply not offered (the other levels need no org context).
   */
  readonly org?: string;
  /**
   * Called after a successful visibility change so the host can refresh the
   * resource (e.g. `refetch`) and reflect the new state.
   */
  readonly onChanged?: () => void;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

/**
 * Single source of truth for the resource-visibility control in detail headers.
 *
 * Behavior:
 * - Always renders a legible state: a read-only {@link VisibilityBadge}
 *   is shown to anyone without `can_manage_audience` and while the
 *   permission check is in flight — never a silent blank.
 * - Upgrades to the interactive {@link VisibilitySelector} for users with
 *   `can_manage_audience`, the server's bar on every `updateVisibility`:
 *   visibility decides who reaches the resource, so an editor, who may
 *   change the definition, sees the badge. Persists changes via
 *   {@link useUpdateVisibility} and invokes
 *   {@link ResourceVisibilityControlProps.onChanged} on success.
 *
 * Offered levels are kind- and context-aware (`visibilityLevels.ts`):
 * - Blueprints (agent/skill/mcp_server/plugin): Private /
 *   Organization, plus Child organizations when the server holds more than
 *   one organization ({@link useSingleOrg}) and the owning organization is
 *   not itself a child (its `spec.parent_org`, read with
 *   {@link useOrganization}; anyone who may change a blueprint's audience
 *   holds a role in its organization, so the read succeeds).
 * - Environments: Private / Organization only — secret values never leave
 *   the org boundary. In `local` mode there are no levels to choose (the
 *   open-source edition is single-user), so the control degrades to a badge.
 *
 * The backend remains the enforcer (it refuses child organizations in an
 * organization that is a child, and the retired public level for every
 * kind); the gates here only prevent offering an option that is guaranteed
 * to fail.
 */
export function ResourceVisibilityControl({
  kind,
  resourceId,
  visibility,
  org,
  onChanged,
  className,
}: ResourceVisibilityControlProps) {
  const { updateVisibility, isPending } = useUpdateVisibility(kind, resourceId);
  const deploymentMode = useDeploymentMode();
  const singleOrg = useSingleOrg();

  const isEnvironment = kind === "environment";
  // Only a blueprint can take the child-organizations level, and only a
  // server that holds more than one organization can have children.
  // Passing null makes the hook a stable no-op everywhere else.
  const ownerLookupOrg =
    !isEnvironment && singleOrg === false ? (org ?? null) : null;
  const { organization: owner } = useOrganization(ownerLookupOrg);

  const options = isEnvironment
    ? environmentVisibilityLevels(deploymentMode)
    : blueprintVisibilityLevels({
        offersChildOrgs:
          owner !== null && (owner.spec?.parentOrg ?? "") === "",
      });

  const handleChange = useCallback(
    async (next: ApiResourceVisibility) => {
      try {
        await updateVisibility(next);
        onChanged?.();
      } catch {
        // The RPC error is captured in useUpdateVisibility's `error` state;
        // swallow here so the selector's promise settles without an unhandled
        // rejection. Surfacing a toast is the host app's concern.
      }
    },
    [updateVisibility, onChanged],
  );

  const badge = <VisibilityBadge visibility={visibility} className={className} />;

  // Fewer than two levels means there is nothing to choose (e.g. an
  // environment in local mode) — stay legible with the read-only badge.
  if (options.length < 2) {
    return badge;
  }

  const selector = (
    <VisibilitySelector
      visibility={visibility}
      options={options}
      onVisibilityChange={handleChange}
      isPending={isPending}
      ariaLabel="Resource visibility"
      className={className}
    />
  );

  return (
    <PermissionGate
      resource={{ kind: FGA_KIND[kind], id: resourceId }}
      relation="can_manage_audience"
      fallback={badge}
      loading={badge}
    >
      {selector}
    </PermissionGate>
  );
}
