"use client";

import { useCallback } from "react";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { PermissionGate } from "../iam-policy/PermissionGate";
import { VisibilityBadge, VisibilityToggle } from "./VisibilityToggle";
import {
  useUpdateVisibility,
  type VisibilityResourceKind,
} from "./useUpdateVisibility";

/**
 * Maps a {@link VisibilityResourceKind} (which mirrors the SDK method namespace,
 * e.g. `mcpServer`) to the FGA object type used in authorization checks
 * (e.g. `mcp_server`). For the three blueprints these coincide, but the mapping
 * keeps the control correct for every kind it may serve.
 */
const FGA_KIND: Record<VisibilityResourceKind, string> = {
  agent: "agent",
  workflow: "workflow",
  skill: "skill",
  mcpServer: "mcp_server",
  agentInstance: "agent_instance",
  workflowInstance: "workflow_instance",
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
 *   (Private/Public) is shown to viewers without `can_edit` and while the
 *   permission check is in flight — never a silent blank.
 * - Upgrades to the interactive {@link VisibilityToggle} for users with
 *   `can_edit`, persisting changes via {@link useUpdateVisibility} and invoking
 *   {@link ResourceVisibilityControlProps.onChanged} on success.
 *
 * Blueprints (agent/workflow/skill/mcp_server) expose Private/Public; the toggle
 * intentionally offers only those two levels (org-scoped sharing for instances is
 * handled by `InstanceVisibilitySelector`).
 */
export function ResourceVisibilityControl({
  kind,
  resourceId,
  visibility,
  onChanged,
  className,
}: ResourceVisibilityControlProps) {
  const { updateVisibility, isPending } = useUpdateVisibility(kind, resourceId);

  const handleChange = useCallback(
    async (next: ApiResourceVisibility) => {
      try {
        await updateVisibility(next);
        onChanged?.();
      } catch {
        // The RPC error is captured in useUpdateVisibility's `error` state;
        // swallow here so the toggle's promise settles without an unhandled
        // rejection. Surfacing a toast is the host app's concern.
      }
    },
    [updateVisibility, onChanged],
  );

  const badge = <VisibilityBadge visibility={visibility} className={className} />;

  return (
    <PermissionGate
      resource={{ kind: FGA_KIND[kind], id: resourceId }}
      relation="can_edit"
      fallback={badge}
      loading={badge}
    >
      <VisibilityToggle
        visibility={visibility}
        onVisibilityChange={handleChange}
        isPending={isPending}
        className={className}
      />
    </PermissionGate>
  );
}
