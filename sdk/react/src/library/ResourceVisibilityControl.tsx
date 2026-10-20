"use client";

import { useCallback } from "react";
import type { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PermissionGate } from "../grant/PermissionGate.js";
import { useOrganization } from "../organization/useOrganization.js";
import { useSingleOrg } from "../server-info.js";
import { VisibilityBadge, VisibilitySelector } from "./VisibilitySelector.js";
import {
  blueprintVisibilityLevels,
  orgVisibilityLevels,
  vaultVisibilityLevels,
} from "./visibilityLevels.js";
import { kindVisibility } from "./kindVisibility.js";
import {
  useUpdateVisibility,
  type VisibilityResourceKind,
} from "./useUpdateVisibility.js";

/**
 * Maps a {@link VisibilityResourceKind} (which mirrors the SDK method
 * namespace) to the FGA object type used in authorization checks. For the
 * kinds served today these coincide, but the mapping keeps the control
 * correct for a kind whose namespace and type differ.
 */
const FGA_KIND: Record<VisibilityResourceKind, string> = {
  agent: "agent",
  plugin: "plugin",
  skill: "skill",
  vault: "vault",
  environment: "environment",
  file: "file",
};

/** The contract's kind for each {@link VisibilityResourceKind}, whose `kind_meta` declares its levels. */
const API_RESOURCE_KIND: Record<VisibilityResourceKind, ApiResourceKind> = {
  agent: ApiResourceKind.agent,
  plugin: ApiResourceKind.plugin,
  skill: ApiResourceKind.skill,
  vault: ApiResourceKind.vault,
  environment: ApiResourceKind.environment,
  file: ApiResourceKind.file,
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
 * Offered levels are the ones the kind declares in the contract
 * (`kind_meta`'s visibility, read by {@link kindVisibility}), never chosen
 * by the kind's name, narrowed by context (`visibilityLevels.ts`):
 * - A kind that declares child organizations (agent, skill, plugin,
 *   environment): Private / Organization, plus Child organizations when the
 *   server holds more than one organization ({@link useSingleOrg}) and the
 *   owning organization is not itself a child (its `spec.parent_org`, read
 *   with {@link useOrganization}; anyone who may change a blueprint's
 *   audience holds a role in its organization, so the read succeeds).
 * - A kind that declares the organization alone (a shared vault, a File):
 *   Private / Organization. A vault's levels keep their own words: saved
 *   values never leave the org boundary, and organization visibility lets
 *   every member use it.
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
  const singleOrg = useSingleOrg();

  const declared = kindVisibility(API_RESOURCE_KIND[kind]);
  // Only a kind that declares the child-organizations level can take it,
  // and only a server that holds more than one organization can have
  // children. Passing null makes the hook a stable no-op everywhere else.
  const ownerLookupOrg =
    declared.supportsChildOrgs && singleOrg === false ? (org ?? null) : null;
  const { organization: owner } = useOrganization(ownerLookupOrg);

  const options = declared.supportsChildOrgs
    ? blueprintVisibilityLevels({
        offersChildOrgs:
          owner !== null && (owner.spec?.parentOrg ?? "") === "",
      })
    : !declared.supportsOrg
      ? []
      : kind === "vault"
        ? vaultVisibilityLevels()
        : orgVisibilityLevels();

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

  // Fewer than two levels means there is nothing to choose — stay legible
  // with the read-only badge.
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
