"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { saveErrorMessage } from "@stigmer/react-core/internal";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useOrganization } from "./useOrganization.js";
import { useUpdateOrganization } from "./useUpdateOrganization.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { EditCheckFailed } from "./EditCheckFailed.js";
import { useServerInfo } from "../server-info.js";
import { MemoryEnabledRow } from "../internal/MemoryEnabledRow.js";
import { DefaultEnvironmentRow } from "./DefaultEnvironmentRow.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Button } from "../button/Button.js";
import { FieldError } from "../internal/form/Field.js";
import { Section } from "../resource-detail/Section.js";
import { useOrgDisplayName } from "./useOrgDisplayName.js";

/** The memory row's copy where each member's own switch must also be on. */
const MEMBER_CONSENT_MEMORY_HELPER_TEXT =
  "Each member must also turn memory on in their own preferences. Once a member has many memories, each conversation recalls the most relevant ones, shown on the run. Saves as you switch it.";

/** The memory row's copy on a server where this switch alone decides memory. */
const ORG_ALONE_MEMORY_HELPER_TEXT =
  "On this server this switch alone decides memory. Once there are many memories, each conversation recalls the most relevant ones, shown on the run. Saves as you switch it.";

/** Props for {@link OrgPreferencesPanel}. */
export interface OrgPreferencesPanelProps {
  /** The ID of the organization whose preferences to display and edit. */
  readonly org: string;
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (org: Organization) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for an {@link Organization}'s declared
 * preferences (`spec.preferences.standing_context`, `memory_enabled` and
 * `default_environment_ref`).
 *
 * The declared text is snapshotted into every eligible run
 * run by the organization's members (first-party human operators only)
 * and delivered to the agent as background context. Editing requires
 * `can_edit` on the organization; viewers without it get a read-only
 * rendering. On save, calls `organization.update()` naming only the
 * preference it edits, with the etag the organization was loaded at, and
 * fires `onUpdated`.
 *
 * All visual properties flow through `--stgm-*` design tokens. Zero
 * dependencies on Console routing, auth context, or layout — platform
 * builders can embed it directly:
 *
 * @example
 * ```tsx
 * <OrgPreferencesPanel org="org-id-123" />
 * ```
 */
export function OrgPreferencesPanel({
  org,
  onUpdated,
  className,
}: OrgPreferencesPanelProps) {
  const baseId = useId();
  const {
    organization,
    isLoading: isFetching,
    error: fetchError,
    refetch,
  } = useOrganization(org || null);

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

  // On a server that trusts every request, this switch alone decides memory:
  // there is no person's switch to also turn on (the account panel says so
  // in its place).
  // Named by its slug only where the server holds several organizations.
  const orgName = useOrgDisplayName(organization?.metadata?.slug);
  const { serverInfo } = useServerInfo();
  const memoryHelperText =
    serverInfo?.authenticationRequired === false
      ? ORG_ALONE_MEMORY_HELPER_TEXT
      : MEMBER_CONSENT_MEMORY_HELPER_TEXT;

  // Editing is the admins' (`can_edit`), offered only on the server's yes:
  // never while the check is in flight and never on a failed check (the
  // check fails closed), so a member never sees an editable form. A settled
  // no says who can; a failed check says it could not check, and the
  // content stays read-only (stigmer#2662).
  const editCheck = useCheckPermission(org ? { kind: "organization", id: org } : null, "can_edit", { fail: "closed" });
  const canEdit = !editCheck.isLoading && editCheck.allowed;
  const checkFailed = !editCheck.isLoading && editCheck.error !== null;
  const editDenied = !editCheck.isLoading && !checkFailed && !editCheck.allowed;

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
        // The update names the one preference this form owns: every other
        // preference (memory_enabled) and every other field keep their
        // stored values.
        const updated = await update(
          {
            metadata: { id: organization.metadata?.id ?? "", etag: organization.metadata?.etag ?? "" },
            spec: { preferences: { standingContext: standingContext.trim() } },
          },
          ["spec.preferences.standing_context"],
        );
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
  // the failure consent UX must not have. It names the flag alone.
  const handleMemoryToggle = useCallback(
    async (next: boolean) => {
      if (!organization) return;
      try {
        const updated = await updateMemoryFlag(
          {
            metadata: { id: organization.metadata?.id ?? "", etag: organization.metadata?.etag ?? "" },
            spec: { preferences: { memoryEnabled: next } },
          },
          ["spec.preferences.memory_enabled"],
        );
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by the toggle's own hook instance
      }
    },
    [organization, updateMemoryFlag, refetch, onUpdated],
  );

  // The default Environment saves the moment it is picked, like the
  // memory switch, through the row's own update.
  const handleDefaultEnvironmentSaved = useCallback(
    (updated: Organization) => {
      refetch();
      onUpdated?.(updated);
    },
    [refetch, onUpdated],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !organization) {
    return <SettingsSkeleton label="Loading organization preferences" rows={2} className={className} />;
  }

  // -----------------------------------------------------------------------
  // Fetch error
  // -----------------------------------------------------------------------

  if (fetchError) {
    return <ErrorMessage error={fetchError} title="Couldn't load the preferences." retry={refetch} className={className} />;
  }

  if (!organization) return null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      {editDenied && (
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">Only admins of {orgName} change these.</p>
      )}
      {checkFailed && <EditCheckFailed what="edit these preferences" onRetry={editCheck.refetch} />}

      <Section title={`What agents should know about ${orgName}`}>
        <div className="stg:flex stg:flex-col stg:gap-3 stg:p-4">
          <StandingContextField
            id={`${baseId}-standing-context`}
            value={standingContext}
            onChange={setStandingContext}
            disabled={isUpdating}
            readOnly={!canEdit}
            placeholder={
              "e.g. We deploy to us-east-1. Our stack is Go and TypeScript. Prefer concise answers."
            }
            helperText={`Shared with agents as background, not as instructions. Applies to runs started by signed-in members of ${orgName} and shows on their run records.`}
          />

          {updateError && <FieldError>{saveErrorMessage(updateError, "organization")}</FieldError>}

          {canEdit && (
            <div className="stg:flex stg:items-center stg:gap-2">
              <Button type="submit" disabled={!canSubmit} icon={isUpdating ? <SpinnerIcon size={12} /> : undefined}>
                Save
              </Button>

              {hasChanges && !isUpdating && (
                <Button variant="ghost" onClick={handleDiscard}>
                  Discard
                </Button>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Memory">
        <div className="stg:p-4">
          <MemoryEnabledRow
            id={`${baseId}-memory-enabled`}
            label="Agents may remember confirmed facts"
            checked={organization.spec?.preferences?.memoryEnabled ?? false}
            onToggle={(next) => void handleMemoryToggle(next)}
            saving={isSavingMemoryFlag}
            readOnly={!canEdit}
            error={memoryFlagError}
            helperText={memoryHelperText}
          />
        </div>
      </Section>

      <Section title="Default environment">
        <div className="stg:p-4">
          <DefaultEnvironmentRow
            id={`${baseId}-default-environment`}
            organization={organization}
            readOnly={!canEdit}
            onSaved={handleDefaultEnvironmentSaved}
          />
        </div>
      </Section>
    </form>
  );
}
