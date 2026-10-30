"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { saveErrorMessage } from "@stigmer/react-core/internal";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountPreferences } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "./useUpdateIdentityAccount.js";
import { DEFAULT_MODELS_HUB_HREF } from "../billing/ProviderKeyNotice.js";
import { useServerInfo } from "../server-info.js";
import { type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META, HARNESS_OPTIONS, isHarnessOption } from "@stigmer/react-core/internal";
import { MemoryEnabledRow } from "../internal/MemoryEnabledRow.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Switch } from "../switch/Switch.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link AccountPreferencesPanel}. */
export interface AccountPreferencesPanelProps {
  /** Fired with the updated resource after a successful save. */
  readonly onUpdated?: (account: IdentityAccount) => void;
  /**
   * Where Models & providers is, in the host's routing: each engine's
   * default model is set there, beside the providers that make it run.
   * Defaults to {@link DEFAULT_MODELS_HUB_HREF}.
   */
  readonly modelsHubHref?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The preferences the form saves, each by its own path. Each engine's
 * default model is not among them: Models & providers saves those, by
 * their own paths, so a save here never overwrites one.
 */
const PREFERENCES_FORM_PATHS = [
  "spec.preferences.standing_context",
  "spec.preferences.default_harness",
  "spec.preferences.default_auto_approve",
];

/**
 * The default harness `prefs` declares, "" for none: a stored word the
 * platform does not offer (one a retired harness or an older build wrote)
 * reads as no preference, as the execution defaults read it
 * (useAccountExecutionDefaults), so the form never shows it unselected
 * and never writes it back for the server to refuse.
 */
function defaultHarnessOf(prefs: IdentityAccountPreferences | undefined): HarnessOption | "" {
  const stored = prefs?.defaultHarness ?? "";
  return isHarnessOption(stored) ? stored : "";
}

/**
 * Self-contained editor for the current user's declared preferences
 * (`IdentityAccountSpec.preferences`): standing context plus the
 * execution defaults (default harness and the auto-approve default). Each
 * engine's default model lives in Models & providers (`ModelDefaults`),
 * which the panel links.
 *
 * The declared text is snapshotted into the user's own eligible agent
 * runs and delivered to the agent as background context.
 * Self-service: the account is resolved via `whoAmI()` and updated
 * through the caller's self-ownership permission — no explicit
 * permission check is needed. On save, calls `identityAccount.update()`
 * naming only the preferences this form owns, with the etag the account
 * was loaded at, and fires `onUpdated`.
 *
 * Served in every edition, so the panel asks no edition question: the
 * identity-account kind is `open_source`-tier and a trusted-local server
 * creates the operator account at boot, so `whoAmI()` always has a row to
 * answer with. A server that cannot answer surfaces its error through the
 * fetch-error state below, never a hidden branch.
 *
 * The one posture question it does ask is about memory. The person's own
 * memory switch is honoured only by a server that authenticates its
 * callers; on a server that trusts every request (the single-operator
 * laptop), memory is the organization's switch alone, so the panel says
 * that in the switch's place rather than offering one that does nothing.
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
  modelsHubHref = DEFAULT_MODELS_HUB_HREF,
  className,
}: AccountPreferencesPanelProps) {
  const baseId = useId();

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

  const memoryGovernance = useMemoryGovernance();

  const [standingContext, setStandingContext] = useState("");
  const [defaultHarness, setDefaultHarness] = useState("");
  const [defaultAutoApprove, setDefaultAutoApprove] = useState(false);

  const serverPreferences = account?.spec?.preferences;
  const serverStandingContext = serverPreferences?.standingContext ?? "";
  const serverDefaultHarness = defaultHarnessOf(serverPreferences);
  const serverDefaultAutoApprove = serverPreferences?.defaultAutoApprove ?? false;

  // Sync the form fields when server data changes.
  useEffect(() => {
    if (!account) return;
    const prefs = account.spec?.preferences;
    setStandingContext(prefs?.standingContext ?? "");
    setDefaultHarness(defaultHarnessOf(prefs));
    setDefaultAutoApprove(prefs?.defaultAutoApprove ?? false);
  }, [account]);

  const hasChanges = useMemo(
    () =>
      standingContext.trim() !== serverStandingContext ||
      defaultHarness !== serverDefaultHarness ||
      defaultAutoApprove !== serverDefaultAutoApprove,
    [
      standingContext,
      defaultHarness,
      defaultAutoApprove,
      serverStandingContext,
      serverDefaultHarness,
      serverDefaultAutoApprove,
    ],
  );

  const canSubmit = hasChanges && !isUpdating;

  const handleDiscard = useCallback(() => {
    setStandingContext(serverStandingContext);
    setDefaultHarness(serverDefaultHarness);
    setDefaultAutoApprove(serverDefaultAutoApprove);
    clearError();
  }, [
    serverStandingContext,
    serverDefaultHarness,
    serverDefaultAutoApprove,
    clearError,
  ]);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit || !account) return;

      clearError();
      try {
        // The update names the preferences this form owns, one path each:
        // every other preference (the memory flag, any later one) and every
        // other field keep their stored values.
        const updated = await update(
          {
            metadata: { id: account.metadata?.id ?? "", etag: account.metadata?.etag ?? "" },
            spec: {
              preferences: {
                standingContext: standingContext.trim(),
                defaultHarness,
                defaultAutoApprove,
              },
            },
          },
          PREFERENCES_FORM_PATHS,
        );
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
      defaultAutoApprove,
      update,
      clearError,
      refetch,
      onUpdated,
    ],
  );

  // The memory consent flag applies instantly (the UX-checkpoint decision):
  // a consent bit flipped-but-unsaved that silently reverts on navigation is
  // the failure consent UX must not have. It names the flag alone.
  const handleMemoryToggle = useCallback(
    async (next: boolean) => {
      if (!account) return;
      try {
        const updated = await updateMemoryFlag(
          {
            metadata: { id: account.metadata?.id ?? "", etag: account.metadata?.etag ?? "" },
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
    [account, updateMemoryFlag, refetch, onUpdated],
  );

  // -----------------------------------------------------------------------
  // Loading state
  // -----------------------------------------------------------------------

  if (isFetching && !account) {
    return (
      <LoadingRegion
        className={cn("stg:space-y-4", className)}
        label="Loading account preferences"
      >
        <div className="stg:bg-muted-subtle stg:h-28 stg:animate-pulse stg:rounded" />
        <div className="stg:bg-muted-subtle stg:h-8 stg:w-32 stg:animate-pulse stg:rounded" />
      </LoadingRegion>
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
        helperText="Shared with agents as background context — not instructions. Applies only to runs you start and is visible on those run records."
      />

      <div className="stg:space-y-3">
        <div>
          <h3 className="stg:text-xs stg:font-medium stg:text-foreground">
            Execution defaults
          </h3>
          <p className="stg:text-2xs stg:text-muted-foreground">
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
          {HARNESS_OPTIONS.map((harness) => (
            <HarnessOptionRow
              key={harness}
              radioName={`${baseId}-default-harness`}
              value={harness}
              label={HARNESS_META[harness].label}
              description={HARNESS_META[harness].description}
              checked={defaultHarness === harness}
              onSelect={setDefaultHarness}
              disabled={isUpdating}
            />
          ))}
          <p className="stg:text-2xs stg:text-muted-foreground">
            <a
              href={modelsHubHref}
              className="stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2 stg:hover:text-foreground-hover"
            >
              Default models are in Models &amp; providers
            </a>
            , beside the providers that run them.
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
            <p className="stg:text-2xs stg:text-muted-foreground">
              Start your sessions with tool calls running unattended — no
              approval prompts. A plugin&apos;s hooks and an agent&apos;s tool
              lists still apply. Each conversation can turn this off (or on)
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

      {memoryGovernance === "organization" && <OrganizationGovernedMemory />}
      {memoryGovernance === "person" && (
        <MemoryEnabledRow
          id={`${baseId}-memory-enabled`}
          checked={account.spec?.preferences?.memoryEnabled ?? false}
          onToggle={(next) => void handleMemoryToggle(next)}
          saving={isSavingMemoryFlag}
          error={memoryFlagError}
          helperText="When on, agents may propose facts to remember about you; only facts you confirm are stored. Confirmed memories are shared with your future sessions and appear on those runs' records; once you have many, each conversation recalls the most relevant ones, shown on the run. Requires your organization to have memory enabled. Changes apply immediately."
        />
      )}

      {updateError && (
        <p className="stg:text-destructive stg:text-2xs" role="alert">
          {saveErrorMessage(updateError, "account")}
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
 * one-line description.
 *
 * The rows are the offered engines (`HARNESS_OPTIONS`), and must stay in
 * lockstep with the proto's `default_harness` in-list validation
 * (`["stigmer", "claude"]`).
 */
function HarnessOptionRow({
  radioName,
  value,
  label,
  description,
  checked,
  onSelect,
  disabled,
}: {
  readonly radioName: string;
  readonly value: string;
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onSelect: (value: string) => void;
  readonly disabled: boolean;
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
          className="stg:mt-0.5 stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring"
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
            className="stg:block stg:text-2xs stg:leading-snug stg:text-muted-foreground"
          >
            {description}
          </span>
        </span>
      </label>
    </div>
  );
}

/**
 * Who decides memory on the connected server, for the memory row.
 *
 * - `"person"`: the person's own switch counts (a server that authenticates
 *   its callers, one too old to report its posture, or one whose answer
 *   failed: an unknown posture offers the control and lets the server
 *   decide, as `authentication_required`'s contract says).
 * - `"organization"`: the server trusts every request, so its one operator
 *   decides memory through the organization's switch alone.
 * - `null`: the server has not answered yet, so the row renders nothing
 *   rather than a switch that flashes and disappears.
 */
function useMemoryGovernance(): "person" | "organization" | null {
  const { serverInfo, error } = useServerInfo();
  if (serverInfo !== null) {
    return serverInfo.authenticationRequired === false ? "organization" : "person";
  }
  return error !== null ? "person" : null;
}

/** The memory row on a server where the organization's switch alone decides. */
function OrganizationGovernedMemory() {
  return (
    <div className="stg:space-y-1">
      <span className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
        Memory
      </span>
      <p className="stg:text-2xs stg:leading-snug stg:text-muted-foreground">
        On this server, memory follows your organization&apos;s setting. Turn it
        on or off in the organization&apos;s preferences.
      </p>
    </div>
  );
}
