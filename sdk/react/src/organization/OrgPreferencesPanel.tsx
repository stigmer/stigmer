"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toOrganizationUpdateInput } from "@stigmer/sdk";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import { useUpdateOrganization } from "./useUpdateOrganization.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { MemoryEnabledRow } from "../internal/MemoryEnabledRow.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link OrgPreferencesPanel}. */
export interface OrgPreferencesPanelProps {
  /** The ID of the organization whose preferences to display and edit. */
  readonly orgId: string;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for an {@link Organization}'s declared
 * preferences (`spec.preferences.standing_context`).
 *
 * The declared text is snapshotted into every eligible agent execution
 * run by the organization's members (first-party human operators only)
 * and delivered to the agent as background context. Editing requires
 * `can_edit` on the organization; viewers without it get a read-only
 * rendering. On save, calls `organization.update()` with the complete
 * mapped input (full-spec-replace safety) and fires `onUpdated`.
 *
 * All visual properties flow through `--stgm-*` design tokens. Zero
 * dependencies on Console routing, auth context, or layout — platform
 * builders can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgPreferencesPanel orgId="org-id-123" />
 * ```
 */
export function OrgPreferencesPanel({
  orgId,
  onUpdated,
  className,
}: OrgPreferencesPanelProps) {
  const baseId = useId();
  const {
    organization,
    isLoading: isFetching,
    error: fetchError,
    refetch,
  } = useOrganization(orgId || null);

  const {
    update,
    isUpdating,
    error: updateError,
    clearError,
  } = useUpdateOrganization();

  // The memory toggle saves instantly (its own hook instance, so a flip's
  // in-flight/error state never bleeds into the form's Save button).
  const {
    update: updateMemoryFlag,
    isUpdating: isSavingMemoryFlag,
    error: memoryFlagError,
  } = useUpdateOrganization();

  // Fail-open: OSS local mode has no IAM service, so editing stays
  // available there; cloud gets a genuine server verdict.
  const { allowed: canEdit } = useCheckPermission(
    orgId ? { kind: "organization", id: orgId } : null,
    "can_edit",
  );

  const [standingContext, setStandingContext] = useState("");

  const serverStandingContext =
    organization?.spec?.preferences?.standingContext ?? "";

  // Sync the form field when server data changes.
  useEffect(() => {
    if (!organization) return;
    setStandingContext(
      organization.spec?.preferences?.standingContext ?? "",
    );
  }, [organization]);

  const hasChanges = useMemo(
    () => standingContext.trim() !== serverStandingContext,
    [standingContext, serverStandingContext],
  );

  const canSubmit = canEdit && hasChanges && !isUpdating;

  const handleDiscard = useCallback(() => {
    setStandingContext(serverStandingContext);
    clearError();
  }, [serverStandingContext, clearError]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !organization) return;

      clearError();
      try {
        // update() is a full-spec replace: spread the complete mapped input
        // so unedited spec fields survive. `preferences` is a nested message,
        // so the override spreads the mapper's COMPLETE preferences too —
        // fields this form does not own (memory_enabled) survive the save.
        const mapped = toOrganizationUpdateInput(organization);
        const updated = await update({
          ...mapped,
          preferences: {
            ...mapped.preferences,
            standingContext: standingContext.trim() || undefined,
          },
        });
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateOrganization
      }
    },
    [canSubmit, organization, standingContext, update, clearError, refetch, onUpdated],
  );

  // The memory consent flag applies instantly (the UX-checkpoint decision):
  // a consent bit flipped-but-unsaved that silently reverts on navigation is
  // the failure consent UX must not have. Same wipe-safe double spread.
  const handleMemoryToggle = useCallback(
    async (next: boolean) => {
      if (!organization) return;
      try {
        const mapped = toOrganizationUpdateInput(organization);
        const updated = await updateMemoryFlag({
          ...mapped,
          preferences: {
            ...mapped.preferences,
            memoryEnabled: next || undefined,
          },
        });
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by the toggle's own hook instance
      }
    },
    [organization, updateMemoryFlag, refetch, onUpdated],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !organization) {
    return (
      <div
        className={cn("stg:space-y-4", className)}
        aria-busy="true"
        aria-label="Loading organization preferences"
      >
        <div className="stg:bg-muted-subtle stg:h-28 stg:animate-pulse stg:rounded" />
        <div className="stg:bg-muted-subtle stg:h-8 stg:w-32 stg:animate-pulse stg:rounded" />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Fetch error
  // -----------------------------------------------------------------------

  if (fetchError) {
    return (
      <div className={cn("stg:space-y-3", className)} role="alert">
        <p className="stg:text-destructive stg:text-sm">
          {getUserMessage(fetchError)}
        </p>
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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-4", className)}>
      <StandingContextField
        id={`${baseId}-standing-context`}
        value={standingContext}
        onChange={setStandingContext}
        disabled={isUpdating}
        readOnly={!canEdit}
        placeholder={
          "e.g. We deploy to us-east-1. Our stack is Go and TypeScript. Prefer concise answers."
        }
        helperText="Shared with agents as background context — not instructions. Applies to executions started by signed-in members of this organization and is visible on their execution records."
      />

      <MemoryEnabledRow
        id={`${baseId}-memory-enabled`}
        checked={organization.spec?.preferences?.memoryEnabled ?? false}
        onToggle={(next) => void handleMemoryToggle(next)}
        saving={isSavingMemoryFlag}
        readOnly={!canEdit}
        error={memoryFlagError}
        helperText="Allow agents to remember confirmed facts about members of this organization. Each member must also turn memory on in their own account preferences. Changes apply immediately."
      />

      {!canEdit && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          Only organization admins can edit these preferences.
        </p>
      )}

      {updateError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(updateError)}
        </p>
      )}

      {canEdit && (
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
              "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-40",
            )}
          >
            {isUpdating && <SpinnerIcon size={12} />}
            Save changes
          </button>

          {hasChanges && !isUpdating && (
            <button
              type="button"
              onClick={handleDiscard}
              className={cn(
                "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              )}
            >
              Discard
            </button>
          )}
        </div>
      )}
    </form>
  );
}
