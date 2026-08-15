"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toIdentityAccountUpdateInput } from "@stigmer/sdk";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "./useUpdateIdentityAccount.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

/** Props for {@link AccountPreferencesPanel}. */
export interface AccountPreferencesPanelProps {
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (account: IdentityAccount) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for the current user's declared preferences
 * (`IdentityAccountSpec.preferences.standing_context`).
 *
 * The declared text is snapshotted into the user's own eligible agent
 * executions and delivered to the agent as background context.
 * Self-service: the account is resolved via `whoAmI()` and updated
 * through the caller's self-ownership permission — no explicit
 * permission check is needed. On save, calls `identityAccount.update()`
 * with the complete mapped input (full-spec-replace safety) and fires
 * `onUpdated`.
 *
 * Cloud-only: the OSS local server has no IdentityAccount (local mode
 * is single-user, so the organization's preferences cover it). In local
 * mode the panel renders a {@link CloudFeatureNotice} instead.
 *
 * All visual properties flow through `--stgm-*` design tokens. Zero
 * dependencies on Console routing, auth context, or layout — platform
 * builders can embed it directly:
 *
 * @example
 * ```tsx
 * <AccountPreferencesPanel />
 * ```
 */
export function AccountPreferencesPanel({
  onUpdated,
  className,
}: AccountPreferencesPanelProps) {
  const baseId = useId();
  const available = useResourceAvailable(ApiResourceKind.identity_account);

  if (!available) {
    return (
      <CloudFeatureNotice className={className}>
        Personal preferences require Stigmer Cloud. Local mode is
        single-user, so the organization&apos;s preferences apply to every
        execution — set standing context there instead.
      </CloudFeatureNotice>
    );
  }

  return (
    <AccountPreferencesForm
      baseId={baseId}
      onUpdated={onUpdated}
      className={className}
    />
  );
}

/**
 * Inner form, mounted only when IdentityAccount is available — keeps the
 * data hooks from issuing doomed RPCs against a local server.
 */
function AccountPreferencesForm({
  baseId,
  onUpdated,
  className,
}: {
  readonly baseId: string;
  readonly onUpdated?: (account: IdentityAccount) => void;
  readonly className?: string;
}) {
  const {
    account,
    isLoading: isFetching,
    error: fetchError,
    refetch,
  } = useMyIdentityAccount();

  const {
    update,
    isUpdating,
    error: updateError,
    clearError,
  } = useUpdateIdentityAccount();

  const [standingContext, setStandingContext] = useState("");

  const serverStandingContext =
    account?.spec?.preferences?.standingContext ?? "";

  // Sync the form field when server data changes.
  useEffect(() => {
    if (!account) return;
    setStandingContext(account.spec?.preferences?.standingContext ?? "");
  }, [account]);

  const hasChanges = useMemo(
    () => standingContext.trim() !== serverStandingContext,
    [standingContext, serverStandingContext],
  );

  const canSubmit = hasChanges && !isUpdating;

  const handleDiscard = useCallback(() => {
    setStandingContext(serverStandingContext);
    clearError();
  }, [serverStandingContext, clearError]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !account) return;

      clearError();
      try {
        // update() is a full-spec replace: spread the complete mapped input
        // so unedited spec fields survive, and override only preferences.
        const updated = await update({
          ...toIdentityAccountUpdateInput(account),
          preferences: { standingContext: standingContext.trim() || undefined },
        });
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateIdentityAccount
      }
    },
    [canSubmit, account, standingContext, update, clearError, refetch, onUpdated],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !account) {
    return (
      <div
        className={cn("stg:space-y-4", className)}
        aria-busy="true"
        aria-label="Loading account preferences"
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

  if (!account) return null;

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
        placeholder={
          "e.g. Keep answers terse. I prefer TypeScript examples. My timezone is IST."
        }
        helperText="Shared with agents as background context — not instructions. Applies only to executions you start and is visible on those execution records."
      />

      {updateError && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(updateError)}
        </p>
      )}

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
    </form>
  );
}
