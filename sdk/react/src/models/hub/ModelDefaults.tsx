"use client";

// The person's default model on each engine, beside the providers that make
// those models run: one home for the setting, where the models are. Each row
// saves the moment it changes, naming only its own preference path, so a
// change here never overwrites anything else the account holds (the harness
// choice and the other preferences stay Account Preferences'). Each row says
// whether its model can run, from the same readiness answer the launcher
// reads.

import { useCallback, useEffect, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { saveErrorMessage } from "../../internal/maskedEdit.js";
import { LoadingRegion } from "../../internal/LoadingRegion.js";
import { UNSTYLED_LIST } from "../../internal/element-resets.js";
import { ACCOUNT_DEFAULT_MODELS } from "../../identity-account/useAccountExecutionDefaults.js";
import { useMyIdentityAccount } from "../../identity-account/useMyIdentityAccount.js";
import { useUpdateIdentityAccount } from "../../identity-account/useUpdateIdentityAccount.js";
import { HARNESS_META, HARNESS_OPTIONS, type HarnessOption } from "../harness.js";
import { needsKeyLabel } from "../provider-presentation.js";
import type { ModelReadinessLookup } from "../readiness.js";
import { useModelRegistry } from "../useModelRegistry.js";
import { INPUT_CLASSES } from "./ProviderKeyForm.js";

/** Props for {@link ModelDefaults}. */
export interface ModelDefaultsProps {
  /** Each model's readiness, from `useModelReadiness`; a row says nothing while it is `undefined`. */
  readonly readinessOf: ModelReadinessLookup;
  /** Additional CSS class names for the section. */
  readonly className?: string;
}

/**
 * The person's default model on each engine, saved to their account
 * (`default_stigmer_model`, `default_claude_model`) the moment a row
 * changes, with whether each model can run here. A new conversation starts
 * on the default of the engine it runs; a pick in the composer wins for
 * that conversation.
 *
 * @example
 * ```tsx
 * const { readinessOf } = useModelReadiness(org);
 * <ModelDefaults readinessOf={readinessOf} />
 * ```
 */
export function ModelDefaults({ readinessOf, className }: ModelDefaultsProps) {
  const headingId = useId();
  const { account, isLoading, error, refetch } = useMyIdentityAccount();
  const { update, isUpdating, error: saveError } = useUpdateIdentityAccount();
  const [savingHarness, setSavingHarness] = useState<HarnessOption | null>(null);
  // The choice being saved shows at once; the account's answer replaces it.
  const [pending, setPending] = useState<Partial<Record<HarnessOption, string>>>({});
  useEffect(() => setPending({}), [account]);

  const save = useCallback(
    async (harness: HarnessOption, modelId: string) => {
      if (!account) return;
      const { preference, path } = ACCOUNT_DEFAULT_MODELS[harness];
      setSavingHarness(harness);
      setPending((current) => ({ ...current, [harness]: modelId }));
      try {
        await update(
          {
            metadata: { id: account.metadata?.id ?? "", etag: account.metadata?.etag ?? "" },
            spec: { preferences: { [preference]: modelId } },
          },
          [path],
        );
        refetch();
      } catch {
        // The hook holds the error; the section shows it, and the row goes
        // back to what is saved.
        setPending((current) => ({ ...current, [harness]: undefined }));
      } finally {
        setSavingHarness(null);
      }
    },
    [account, update, refetch],
  );

  return (
    <section
      aria-labelledby={headingId}
      className={cn("stg:rounded-xl stg:border stg:border-border stg:bg-card", className)}
    >
      <div className="stg:border-b stg:border-border stg:px-4 stg:py-3">
        <h2 id={headingId} className="stg:text-sm stg:font-semibold stg:text-foreground">
          Your default models
        </h2>
        <p className="stg:text-xs stg:text-muted-foreground">
          The model a new conversation starts on, for each engine, on every device and in the CLI. A pick in the
          composer wins for that conversation.
        </p>
      </div>
      {isLoading && !account ? (
        <LoadingRegion label="Loading your default models" className="stg:space-y-2 stg:px-4 stg:py-3">
          <div className="stg:h-8 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
          <div className="stg:h-8 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        </LoadingRegion>
      ) : error && !account ? (
        <p role="alert" className="stg:px-4 stg:py-3 stg:text-xs stg:text-destructive">
          {getUserMessage(error)}
        </p>
      ) : (
        <ul className={cn(UNSTYLED_LIST, "stg:divide-y stg:divide-border")}>
          {HARNESS_OPTIONS.map((harness) => (
            <DefaultRow
              key={harness}
              harness={harness}
              value={pending[harness] ?? account?.spec?.preferences?.[ACCOUNT_DEFAULT_MODELS[harness].preference] ?? ""}
              saving={savingHarness === harness}
              disabled={isUpdating || !account}
              onChange={(modelId) => void save(harness, modelId)}
              readinessOf={readinessOf}
            />
          ))}
        </ul>
      )}
      {saveError && (
        <p role="alert" className="stg:border-t stg:border-border stg:px-4 stg:py-2 stg:text-xs stg:text-destructive">
          {saveErrorMessage(saveError, "account")}
        </p>
      )}
    </section>
  );
}

function DefaultRow({
  harness,
  value,
  saving,
  disabled,
  onChange,
  readinessOf,
}: {
  readonly harness: HarnessOption;
  readonly value: string;
  readonly saving: boolean;
  readonly disabled: boolean;
  readonly onChange: (modelId: string) => void;
  readonly readinessOf: ModelReadinessLookup;
}) {
  const selectId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const { models, defaultModel, isLoading } = useModelRegistry({ harness });
  const isStale = value !== "" && !isLoading && !models.some((model) => model.modelId === value);
  const effective = value || defaultModel?.modelId || "";
  const readiness = effective === "" ? undefined : readinessOf(harness, effective);
  const status =
    readiness === undefined ? "" : readiness.availability.state === "missing" ? needsKeyLabel(readiness.provider) : "Ready";
  return (
    <li className="stg:grid stg:items-center stg:gap-2 stg:px-4 stg:py-3 stg:sm:grid-cols-[12rem_1fr_11rem] stg:sm:gap-4">
      <div>
        <label htmlFor={selectId} className="stg:block stg:text-xs stg:font-medium stg:text-foreground">
          {HARNESS_META[harness].label}
        </label>
        <p id={descriptionId} className="stg:text-2xs stg:text-muted-foreground">
          {HARNESS_META[harness].description}
        </p>
      </div>
      <select
        id={selectId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled || isLoading}
        aria-describedby={`${descriptionId} ${statusId}`}
        className={INPUT_CLASSES}
      >
        <option value="">Platform default{defaultModel ? ` (${defaultModel.displayName})` : ""}</option>
        {isStale && <option value={value}>{value} (unavailable)</option>}
        {models.map((model) => (
          <option key={model.modelId} value={model.modelId}>
            {model.displayName || model.modelId}
          </option>
        ))}
      </select>
      <p
        id={statusId}
        className={cn(
          "stg:text-2xs",
          readiness?.availability.state === "missing" ? "stg:text-foreground" : "stg:text-muted-foreground",
        )}
      >
        {saving ? "Saving…" : status}
      </p>
    </li>
  );
}
