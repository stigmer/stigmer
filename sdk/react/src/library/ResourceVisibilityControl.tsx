"use client";

import { useCallback } from "react";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  ApiResourceKind,
  useDeploymentMode,
  useResourceAvailable,
} from "../deployment-mode.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { useSsoProvider } from "../identity-provider/useSsoProvider.js";
import { VisibilityBadge, VisibilitySelector } from "./VisibilitySelector.js";
import {
  blueprintVisibilityLevels,
  environmentVisibilityLevels,
  instanceVisibilityLevels,
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
  workflow: "workflow",
  plugin: "plugin",
  skill: "skill",
  mcpServer: "mcp_server",
  agentInstance: "agent_instance",
  workflowInstance: "workflow_instance",
  environment: "environment",
};

const INSTANCE_KINDS: ReadonlySet<VisibilityResourceKind> = new Set([
  "agentInstance",
  "workflowInstance",
]);

/** Props for {@link ResourceVisibilityControl}. */
export interface ResourceVisibilityControlProps {
  /** Resource kind, selecting both the updateVisibility RPC and the FGA type. */
  readonly kind: VisibilityResourceKind;
  /** Id of the resource whose visibility is shown/edited. */
  readonly resourceId: string;
  /** Current visibility of the resource. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Slug of the organization that OWNS the resource (`metadata.org`).
   * Used to look up whether the org operates an IdentityProvider, which
   * gates the Platform option for blueprints. When omitted, Platform is
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
 *   is shown to viewers without `can_edit` and while the permission check
 *   is in flight — never a silent blank.
 * - Upgrades to the interactive {@link VisibilitySelector} for users with
 *   `can_edit`, persisting changes via {@link useUpdateVisibility} and invoking
 *   {@link ResourceVisibilityControlProps.onChanged} on success.
 *
 * Offered levels are kind- and context-aware (`visibilityLevels.ts`):
 * - Blueprints (agent/workflow/skill/mcp_server/plugin): Private /
 *   Organization, plus Platform when the owning org operates an
 *   IdentityProvider (checked via {@link useSsoProvider}, the only
 *   permission-free IdP lookup — blueprint owners editing visibility are
 *   not necessarily org admins). The lookup runs only where the edition
 *   serves the IdentityProvider kind at all, asked of the kind registry
 *   rather than of the deployment mode, so a new edition answers by its
 *   tier table.
 * - Instances: Private / Organization — platform is excluded by design to
 *   preserve tenant isolation.
 * - Environments: Private / Organization only — secret values never leave
 *   the org boundary. In `local` mode there are no levels to choose (the
 *   open-source edition is single-user), so the control degrades to a badge.
 *
 * The backend remains the enforcer (`ValidateVisibilityStep` rejects
 * platform without an IdP and refuses the retired public level for every
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
  const servesIdentityProviders = useResourceAvailable(
    ApiResourceKind.identity_provider,
  );

  const isInstance = INSTANCE_KINDS.has(kind);
  const isEnvironment = kind === "environment";
  // Only a blueprint can take the platform level, and only an edition that
  // serves IdentityProvider resources can have one to look up. Passing null
  // makes the hook a stable no-op everywhere else.
  const idpLookupOrg =
    !isInstance && !isEnvironment && servesIdentityProviders
      ? (org ?? null)
      : null;
  const { ssoProvider } = useSsoProvider(idpLookupOrg);

  const options = isEnvironment
    ? environmentVisibilityLevels(deploymentMode)
    : isInstance
      ? instanceVisibilityLevels()
      : blueprintVisibilityLevels({
          hasIdentityProvider: ssoProvider !== null,
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
      ariaLabel={isInstance ? "Instance visibility" : "Resource visibility"}
      className={className}
    />
  );

  return (
    <PermissionGate
      resource={{ kind: FGA_KIND[kind], id: resourceId }}
      relation="can_edit"
      fallback={badge}
      loading={badge}
    >
      {selector}
    </PermissionGate>
  );
}
