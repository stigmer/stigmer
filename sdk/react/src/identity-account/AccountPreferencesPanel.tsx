"use client";

import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, toIdentityAccountUpdateInput } from "@stigmer/sdk";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "./useUpdateIdentityAccount.js";
import { useResourceAvailable, ApiResourceKind } from "../deployment-mode.js";
import { useModelRegistry } from "../models/index.js";
import { HARNESS_META, type HarnessOption } from "../models/harness.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { MemoryEnabledRow } from "../internal/MemoryEnabledRow.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Switch } from "../switch/Switch.js";

/** Props for {@link AccountPreferencesPanel}. */
export interface AccountPreferencesPanelProps {
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (account: IdentityAccount) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained editor for the current user's declared preferences
 * (`IdentityAccountSpec.preferences`): standing context plus the
 * execution defaults (default harness, per-harness default models, and
 * the auto-approve default).
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

  // The memory toggle saves instantly (its own hook instance, so a flip's
  // in-flight/error state never bleeds into the form's Save button).
  const {
    update: updateMemoryFlag,
    isUpdating: isSavingMemoryFlag,
    error: memoryFlagError,
  } = useUpdateIdentityAccount();

  const [standingContext, setStandingContext] = useState("");
  const [defaultHarness, setDefaultHarness] = useState("");
  const [defaultNativeModel, setDefaultNativeModel] = useState("");
  const [defaultCursorModel, setDefaultCursorModel] = useState("");
  const [defaultAutoApprove, setDefaultAutoApprove] = useState(false);

  const serverPreferences = account?.spec?.preferences;
  const serverStandingContext = serverPreferences?.standingContext ?? "";
  const serverDefaultHarness = serverPreferences?.defaultHarness ?? "";
  const serverDefaultNativeModel = serverPreferences?.defaultNativeModel ?? "";
  const serverDefaultCursorModel = serverPreferences?.defaultCursorModel ?? "";
  const serverDefaultAutoApprove = serverPreferences?.defaultAutoApprove ?? false;

  // Sync the form fields when server data changes.
  useEffect(() => {
    if (!account) return;
    const prefs = account.spec?.preferences;
    setStandingContext(prefs?.standingContext ?? "");
    setDefaultHarness(prefs?.defaultHarness ?? "");
    setDefaultNativeModel(prefs?.defaultNativeModel ?? "");
    setDefaultCursorModel(prefs?.defaultCursorModel ?? "");
    setDefaultAutoApprove(prefs?.defaultAutoApprove ?? false);
  }, [account]);

  const hasChanges = useMemo(
    () =>
      standingContext.trim() !== serverStandingContext ||
      defaultHarness !== serverDefaultHarness ||
      defaultNativeModel !== serverDefaultNativeModel ||
      defaultCursorModel !== serverDefaultCursorModel ||
      defaultAutoApprove !== serverDefaultAutoApprove,
    [
      standingContext,
      defaultHarness,
      defaultNativeModel,
      defaultCursorModel,
      defaultAutoApprove,
      serverStandingContext,
      serverDefaultHarness,
      serverDefaultNativeModel,
      serverDefaultCursorModel,
      serverDefaultAutoApprove,
    ],
  );

  const canSubmit = hasChanges && !isUpdating;

  const handleDiscard = useCallback(() => {
    setStandingContext(serverStandingContext);
    setDefaultHarness(serverDefaultHarness);
    setDefaultNativeModel(serverDefaultNativeModel);
    setDefaultCursorModel(serverDefaultCursorModel);
    setDefaultAutoApprove(serverDefaultAutoApprove);
    clearError();
  }, [
    serverStandingContext,
    serverDefaultHarness,
    serverDefaultNativeModel,
    serverDefaultCursorModel,
    serverDefaultAutoApprove,
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
            defaultAutoApprove: defaultAutoApprove || undefined,
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
      defaultAutoApprove,
      update,
      clearError,
      refetch,
      onUpdated,
    ],
  );

  // The memory consent flag applies instantly (the UX-checkpoint decision):
  // a consent bit flipped-but-unsaved that silently reverts on navigation is
  // the failure consent UX must not have. Same wipe-safe double spread.
  const handleMemoryToggle = useCallback(
    async (next: boolean) => {
      if (!account) return;
      try {
        const mapped = toIdentityAccountUpdateInput(account);
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
    [account, updateMemoryFlag, refetch, onUpdated],
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

        <fieldset className="stg:space-y-2" disabled={isUpdating}>
          <legend className="stg:text-xs stg:font-medium stg:text-foreground stg:mb-1">
            Default harness
          </legend>
          <HarnessOptionRow
            radioName={`${baseId}-default-harness`}
            value=""
            label="Platform default"
            description="Stigmer picks the harness for new sessions."
            checked={defaultHarness === ""}
            onSelect={setDefaultHarness}
            disabled={isUpdating}
          />
          <HarnessOptionRow
            radioName={`${baseId}-default-harness`}
            value="native"
            label={HARNESS_META.native.label}
            description={HARNESS_META.native.description}
            checked={defaultHarness === "native"}
            onSelect={setDefaultHarness}
            disabled={isUpdating}
          >
            <DefaultModelSelect
              id={`${baseId}-default-native-model`}
              harness="native"
              label="Default model"
              value={defaultNativeModel}
              onChange={setDefaultNativeModel}
              disabled={isUpdating}
            />
          </HarnessOptionRow>
          <HarnessOptionRow
            radioName={`${baseId}-default-harness`}
            value="cursor"
            label={HARNESS_META.cursor.label}
            description={HARNESS_META.cursor.description}
            checked={defaultHarness === "cursor"}
            onSelect={setDefaultHarness}
            disabled={isUpdating}
          >
            <DefaultModelSelect
              id={`${baseId}-default-cursor-model`}
              harness="cursor"
              label="Default model"
              value={defaultCursorModel}
              onChange={setDefaultCursorModel}
              disabled={isUpdating}
            />
          </HarnessOptionRow>
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Each harness&apos;s default model applies whenever a session runs
            on that harness — even when it isn&apos;t your default.
          </p>
        </fieldset>

        {/* Auto-approve default (stigmer/stigmer#816): a client-read seed
            like the harness/model defaults above — the session panel's
            Config switch beats it per conversation, and armed sessions
            always show the "Auto-approving tool calls" strip by the
            composer. Never applied to guest or observer surfaces. */}
        <div
          className={cn(
            "stg:flex stg:items-start stg:justify-between stg:gap-3 stg:rounded-md stg:border stg:border-input stg:px-3 stg:py-2.5",
            isUpdating && "stg:opacity-50",
          )}
        >
          <div className="stg:min-w-0">
            <span
              id={`${baseId}-default-auto-approve-title`}
              className="stg:block stg:text-xs stg:font-medium stg:text-foreground"
            >
              Auto-approve tool calls
            </span>
            <p className="stg:text-[0.65rem] stg:text-muted-foreground">
              Start your sessions with tool calls running unattended — no
              approval prompts. Each conversation can turn this off (or on)
              in its session panel.
            </p>
          </div>
          <Switch
            checked={defaultAutoApprove}
            onCheckedChange={setDefaultAutoApprove}
            disabled={isUpdating}
            aria-labelledby={`${baseId}-default-auto-approve-title`}
            className="stg:mt-0.5"
          />
        </div>
      </div>

      <MemoryEnabledRow
        id={`${baseId}-memory-enabled`}
        checked={account.spec?.preferences?.memoryEnabled ?? false}
        onToggle={(next) => void handleMemoryToggle(next)}
        saving={isSavingMemoryFlag}
        error={memoryFlagError}
        helperText="When on, agents may propose facts to remember about you; only facts you confirm are stored. Confirmed memories are shared with your future sessions and appear on those executions' records. Requires your organization to have memory enabled. Changes apply immediately."
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

/**
 * One selectable default-harness choice, presented as a bordered row
 * (the `VisibilityOptionRow` presentation shape): radio + label +
 * one-line description, with the harness's own controls nested below.
 *
 * The rows for shipped harnesses embed that harness's default-model
 * select as `children` — the pairing IS the information architecture:
 * a harness and its model default belong to each other, and each model
 * default applies whenever a session runs on that harness, independent
 * of which harness is the default. The non-selected harness's select
 * therefore stays interactive (visually secondary, never disabled).
 *
 * The nested controls live OUTSIDE the radio's `<label>` on purpose:
 * a `<select>` inside the label would toggle the radio on every
 * interaction with it.
 *
 * The shipped-harness rows must stay in lockstep with the proto's
 * `default_harness` in-list validation (`["native", "cursor"]`) — each
 * shipped harness binds to its own proto model field, so a new harness
 * adds a field, a row, and a validation entry together.
 */
function HarnessOptionRow({
  radioName,
  value,
  label,
  description,
  checked,
  onSelect,
  disabled,
  children,
}: {
  readonly radioName: string;
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onSelect: (value: string) => void;
  readonly disabled: boolean;
  readonly children?: ReactNode;
}) {
  // The radio's accessible name is the title alone (aria-labelledby), with
  // the description attached as aria-describedby — the wrapping label keeps
  // the whole text block clickable without bloating the announced name.
  const titleId = `${radioName}-${value || "platform"}-title`;
  const descriptionId = `${radioName}-${value || "platform"}-description`;

  return (
    <div
      className={cn(
        "stg:rounded-md stg:border stg:px-3 stg:py-2.5 stg:transition-colors",
        checked
          ? "stg:border-primary stg:bg-accent"
          : "stg:border-input stg:hover:bg-accent-hover",
        disabled && "stg:opacity-50",
      )}
    >
      <label
        className={cn(
          "stg:flex stg:cursor-pointer stg:items-start stg:gap-2",
          disabled && "stg:cursor-default",
        )}
      >
        <input
          type="radio"
          name={radioName}
          value={value}
          checked={checked}
          onChange={() => onSelect(value)}
          disabled={disabled}
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className="stg:mt-0.5 stg:accent-primary stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring"
        />
        <span className="stg:min-w-0 stg:flex-1">
          <span
            id={titleId}
            className="stg:block stg:text-xs stg:font-medium stg:text-foreground"
          >
            {label}
          </span>
          <span
            id={descriptionId}
            className="stg:block stg:text-[0.65rem] stg:leading-snug stg:text-muted-foreground"
          >
            {description}
          </span>
        </span>
      </label>
      {children && (
        <div
          className={cn(
            "stg:mt-2 stg:pl-6 stg:transition-opacity",
            !checked && "stg:opacity-70",
          )}
        >
          {children}
        </div>
      )}
    </div>
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
        // Both harness rows show the same visible label; the accessible
        // name stays unique per control by qualifying it with the harness
        // (WCAG label-in-name: the visible text remains a prefix).
        aria-label={`${label} — ${HARNESS_META[harness].label}`}
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
