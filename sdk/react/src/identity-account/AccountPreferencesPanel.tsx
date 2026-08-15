"use client";

import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toIdentityAccountUpdateInput } from "@stigmer/sdk";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "./useUpdateIdentityAccount.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { useModelRegistry } from "../models/index.js";
import { HARNESS_META, type HarnessOption } from "../models/harness.js";
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
  const [defaultHarness, setDefaultHarness] = useState("");
  const [defaultNativeModel, setDefaultNativeModel] = useState("");
  const [defaultCursorModel, setDefaultCursorModel] = useState("");

  const serverPreferences = account?.spec?.preferences;
  const serverStandingContext = serverPreferences?.standingContext ?? "";
  const serverDefaultHarness = serverPreferences?.defaultHarness ?? "";
  const serverDefaultNativeModel = serverPreferences?.defaultNativeModel ?? "";
  const serverDefaultCursorModel = serverPreferences?.defaultCursorModel ?? "";

  // Sync the form fields when server data changes.
  useEffect(() => {
    if (!account) return;
    const prefs = account.spec?.preferences;
    setStandingContext(prefs?.standingContext ?? "");
    setDefaultHarness(prefs?.defaultHarness ?? "");
    setDefaultNativeModel(prefs?.defaultNativeModel ?? "");
    setDefaultCursorModel(prefs?.defaultCursorModel ?? "");
  }, [account]);

  const hasChanges = useMemo(
    () =>
      standingContext.trim() !== serverStandingContext ||
      defaultHarness !== serverDefaultHarness ||
      defaultNativeModel !== serverDefaultNativeModel ||
      defaultCursorModel !== serverDefaultCursorModel,
    [
      standingContext,
      defaultHarness,
      defaultNativeModel,
      defaultCursorModel,
      serverStandingContext,
      serverDefaultHarness,
      serverDefaultNativeModel,
      serverDefaultCursorModel,
    ],
  );

  const canSubmit = hasChanges && !isUpdating;

  const handleDiscard = useCallback(() => {
    setStandingContext(serverStandingContext);
    setDefaultHarness(serverDefaultHarness);
    setDefaultNativeModel(serverDefaultNativeModel);
    setDefaultCursorModel(serverDefaultCursorModel);
    clearError();
  }, [
    serverStandingContext,
    serverDefaultHarness,
    serverDefaultNativeModel,
    serverDefaultCursorModel,
    clearError,
  ]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !account) return;

      clearError();
      try {
        // update() is a full-spec replace: spread the complete mapped input
        // so unedited spec fields survive. `preferences` is a nested message,
        // so the override spreads the mapper's COMPLETE preferences too —
        // fields this form does not own (added by later phases) survive.
        const mapped = toIdentityAccountUpdateInput(account);
        const updated = await update({
          ...mapped,
          preferences: {
            ...mapped.preferences,
            standingContext: standingContext.trim() || undefined,
            defaultHarness: defaultHarness || undefined,
            defaultNativeModel: defaultNativeModel || undefined,
            defaultCursorModel: defaultCursorModel || undefined,
          },
        });
        refetch();
        onUpdated?.(updated);
      } catch {
        // error state is managed by useUpdateIdentityAccount
      }
    },
    [
      canSubmit,
      account,
      standingContext,
      defaultHarness,
      defaultNativeModel,
      defaultCursorModel,
      update,
      clearError,
      refetch,
      onUpdated,
    ],
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

      <div className="stg:space-y-3">
        <div>
          <h3 className="stg:text-xs stg:font-medium stg:text-foreground">
            Execution defaults
          </h3>
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Seed new sessions across your devices and the CLI. An explicit
            pick in the composer always wins for that device.
          </p>
        </div>

        <DefaultHarnessRadioGroup
          baseId={baseId}
          value={defaultHarness}
          onChange={setDefaultHarness}
          disabled={isUpdating}
        />

        <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2">
          <DefaultModelSelect
            id={`${baseId}-default-native-model`}
            harness="native"
            label={`Default model — ${HARNESS_META.native.label}`}
            value={defaultNativeModel}
            onChange={setDefaultNativeModel}
            disabled={isUpdating}
          />
          <DefaultModelSelect
            id={`${baseId}-default-cursor-model`}
            harness="cursor"
            label={`Default model — ${HARNESS_META.cursor.label}`}
            value={defaultCursorModel}
            onChange={setDefaultCursorModel}
            disabled={isUpdating}
          />
        </div>
      </div>

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

/**
 * Only harnesses with a shipped runtime are offerable as a default — must
 * stay in lockstep with the proto's `default_harness` in-list validation.
 */
const OFFERABLE_HARNESSES: readonly HarnessOption[] = ["native", "cursor"];

/**
 * Default-harness choice: Platform default plus each shipped harness.
 * A mutually exclusive, always-visible set — radio group, not a select.
 */
function DefaultHarnessRadioGroup({
  baseId,
  value,
  onChange,
  disabled,
}: {
  readonly baseId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  const name = `${baseId}-default-harness`;
  const options: readonly { value: string; label: string }[] = [
    { value: "", label: "Platform default" },
    ...OFFERABLE_HARNESSES.map((h) => ({ value: h, label: HARNESS_META[h].label })),
  ];

  return (
    <fieldset className="stg:space-y-1" disabled={disabled}>
      <legend className="stg:text-xs stg:font-medium stg:text-foreground">
        Default harness
      </legend>
      <div className="stg:flex stg:flex-wrap stg:gap-x-4 stg:gap-y-1">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-1.5 stg:text-xs stg:text-foreground",
              disabled && "stg:cursor-default stg:opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              disabled={disabled}
              className="stg:accent-primary stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Per-harness default model select, fed by the harness-filtered registry.
 *
 * A saved model that the registry no longer lists is rendered as its own
 * "(unavailable)" option so the select never lies about the stored value;
 * composers self-heal such a preference to the platform default on read.
 */
function DefaultModelSelect({
  id,
  harness,
  label,
  value,
  onChange,
  disabled,
}: {
  readonly id: string;
  readonly harness: HarnessOption;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}) {
  const { models, isLoading } = useModelRegistry({ harness });
  const isStale = value !== "" && !isLoading && !models.some((m) => m.modelId === value);

  return (
    <div className="stg:space-y-1">
      <label
        htmlFor={id}
        className="stg:text-xs stg:font-medium stg:text-foreground"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || isLoading}
        className={cn(
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      >
        <option value="">Platform default</option>
        {isStale && <option value={value}>{value} (unavailable)</option>}
        {models.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.displayName || model.modelId}
          </option>
        ))}
      </select>
    </div>
  );
}
