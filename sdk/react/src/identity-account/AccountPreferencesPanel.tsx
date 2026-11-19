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
import { saveErrorMessage } from "@stigmer/react-core/internal";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountPreferences } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { useMyIdentityAccount } from "./useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "./useUpdateIdentityAccount.js";
import { DEFAULT_MODELS_HUB_HREF } from "../billing/refusals.js";
import { useServerInfo } from "../server-info.js";
import { DEFAULT_HARNESS, type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META, HARNESS_OPTIONS, isHarnessOption } from "@stigmer/react-core/internal";
import { MemoryEnabledRow } from "../internal/MemoryEnabledRow.js";
import { StandingContextField } from "../internal/StandingContextField.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { SwitchField } from "../internal/form/SwitchField.js";
import { Section } from "../resource-detail/Section.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Field, FieldError, Select } from "../internal/form/index.js";

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
    return <SettingsSkeleton label="Loading account preferences" rows={2} className={className} />;
  }

  // -----------------------------------------------------------------------
  // Fetch error
  // -----------------------------------------------------------------------

  if (fetchError) {
    return <ErrorMessage error={fetchError} title="Couldn't load your preferences." retry={refetch} className={className} />;
  }

  if (!account) return null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <form onSubmit={handleSubmit} className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      <Section title="What agents should know about you">
        <div className="stg:flex stg:flex-col stg:gap-3 stg:p-4">
          <StandingContextField
            id={`${baseId}-standing-context`}
            value={standingContext}
            onChange={setStandingContext}
            disabled={isUpdating}
            placeholder={
              "e.g. Keep answers terse. I prefer TypeScript examples. My timezone is IST."
            }
            helperText="Shared with agents as background, not as instructions. Applies only to runs you start and shows on those run records."
          />
        </div>
      </Section>

      <Section title="Default models">
        <fieldset className="stg:m-0 stg:flex stg:flex-col stg:gap-2 stg:border-0 stg:p-4" disabled={isUpdating}>
          <legend className="stg:sr-only">Default models</legend>
          {/* One harness of a few: a select, its choice's line under it. */}
          <Field
            label="Harness a new conversation starts on"
            hint={
              isHarnessOption(defaultHarness)
                ? HARNESS_META[defaultHarness].description
                : "Stigmer picks the harness for new sessions."
            }
          >
            <Select value={defaultHarness} onChange={(e) => setDefaultHarness(e.target.value)} disabled={isUpdating}>
              {/* Names the harness "Platform default" means, as the platform picks it today. */}
              <option value="">{`Platform default (${HARNESS_META[DEFAULT_HARNESS].label})`}</option>
              {HARNESS_OPTIONS.map((harness) => (
                <option key={harness} value={harness}>
                  {HARNESS_META[harness].label}
                </option>
              ))}
            </Select>
          </Field>
          <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
            Each harness&apos;s default model is set on{" "}
            <a
              href={modelsHubHref}
              className="stg:font-medium stg:text-foreground stg:underline stg:underline-offset-2 stg:hover:text-foreground-hover"
            >
              Models and providers
            </a>
            . A pick in the composer wins for that conversation.
          </p>

          {/* Auto-approve default (stigmer/stigmer#816): a client-read seed
              like the harness/model defaults above — the session panel's
              Config switch beats it per conversation, and armed sessions
              always show the "Approving tool calls automatically" strip by the
              composer. Never applied to guest or observer surfaces. */}
          <SwitchField
            className="stg:mt-2"
            label="Auto-approve tool calls"
            hint="Start your sessions with tool calls running unattended, with no approval prompts. A plugin's hooks and an agent's tool lists still apply. Each conversation can turn this off (or on) in its session panel."
            checked={defaultAutoApprove}
            onCheckedChange={setDefaultAutoApprove}
            disabled={isUpdating}
          />
        </fieldset>
        {/* Save holds the standing context and the defaults above it; memory saves as it flips. */}
        <div className="stg:flex stg:flex-col stg:gap-3 stg:px-4 stg:pb-4">
          {updateError && <FieldError>{saveErrorMessage(updateError, "account")}</FieldError>}
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
        </div>
      </Section>


      {memoryGovernance !== null && (
        <Section title="Memory">
          <div className="stg:p-4">
            {memoryGovernance === "organization" ? (
              <OrganizationGovernedMemory />
            ) : (
              <MemoryEnabledRow
                id={`${baseId}-memory-enabled`}
                checked={account.spec?.preferences?.memoryEnabled ?? false}
                onToggle={(next) => void handleMemoryToggle(next)}
                saving={isSavingMemoryFlag}
                error={memoryFlagError}
                label="Agents may remember confirmed facts about me"
                helperText="Agents may propose facts to remember; only facts you confirm are kept, under Memory, and they show on the records of the runs that use them. Your organization's memory must be on too. Saves as you switch it."
              />
            )}
          </div>
        </Section>
      )}
    </form>
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
    <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
      On this server, memory follows your organization&apos;s setting. Turn it
      on or off in the organization&apos;s preferences.
    </p>
  );
}
