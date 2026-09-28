"use client";

import { useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Plan } from "@stigmer/protos/ai/stigmer/billing/plan/v1/api_pb";
import { Feature } from "@stigmer/protos/ai/stigmer/platform/v1/entitlement_pb";
import { Button } from "../button/index.js";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";
import { FEATURE_COPY, type NamedFeature } from "../internal/features.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import { EMPTY_PLAN_DRAFT, planInputFromDraft, type PlanDraft } from "./plan-draft.js";
import { useCreatePlan } from "./usePlanMutations.js";

/** The features a subscription plan can list, in contract order. */
const PLAN_FEATURES: readonly NamedFeature[] = [
  Feature.channels,
  Feature.sharing,
  Feature.teams,
  Feature.managed_organizations,
  Feature.byo_provider_keys,
  Feature.sso_enforcement,
];

/** Props for {@link PlanCreateForm}. */
export interface PlanCreateFormProps {
  /** Fired with the created plan. */
  readonly onCreated: (plan: Plan) => void;
  /** Fired when the operator leaves without creating. */
  readonly onCancel: () => void;
}

/**
 * Adds a subscription plan to the catalog: its name and handle, its
 * monthly minimum and usage share, its features, and the managed
 * organizations it includes. The form states before submitting that a
 * plan's terms are final: a change of terms is a new plan, and the old
 * one is retired.
 */
export function PlanCreateForm({ onCreated, onCancel }: PlanCreateFormProps) {
  const creator = useCreatePlan();
  const [draft, setDraft] = useState<PlanDraft>(EMPTY_PLAN_DRAFT);
  const [confirming, setConfirming] = useState(false);
  const result = planInputFromDraft(draft);
  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => {
    setConfirming(false);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  const toggle = (feature: Feature, on: boolean) =>
    set("features", on ? [...draft.features, feature] : draft.features.filter((f) => f !== feature));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!result.ok) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    creator.createPlan(result.input).then(onCreated, () => undefined);
  };

  const fieldError = (field: keyof PlanDraft) =>
    !result.ok && result.field === field && draft[field] !== "" ? (
      <span className="stg:block stg:text-xs stg:text-destructive">{result.message}</span>
    ) : null;

  return (
    <form onSubmit={submit} className="stg:space-y-4" aria-label="New plan">
      <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2">
        <Field label="Name" required>
          <input className={INPUT_CLASSES} value={draft.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Handle (slug)" required>
          <input
            className={INPUT_CLASSES}
            value={draft.slug}
            placeholder="team-2027"
            onChange={(e) => set("slug", e.target.value)}
          />
          {fieldError("slug")}
        </Field>
        <Field label="Monthly minimum (USD)" required>
          <input
            className={INPUT_CLASSES}
            inputMode="decimal"
            value={draft.monthlyMinimumUsd}
            onChange={(e) => set("monthlyMinimumUsd", e.target.value)}
          />
          {fieldError("monthlyMinimumUsd")}
        </Field>
        <Field label="Usage share (% of provider cost)" required>
          <input
            className={INPUT_CLASSES}
            inputMode="decimal"
            value={draft.usageSharePercent}
            onChange={(e) => set("usageSharePercent", e.target.value)}
          />
          {fieldError("usageSharePercent")}
        </Field>
      </div>

      <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-2")}>
        <legend className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">Features</legend>
        {PLAN_FEATURES.map((feature) => (
          <label key={feature} className="stg:flex stg:items-start stg:gap-2 stg:text-sm">
            <input
              type="checkbox"
              className="stg:mt-0.5"
              checked={draft.features.includes(feature)}
              onChange={(e) => toggle(feature, e.target.checked)}
            />
            <span>
              <span className="stg:block stg:text-foreground">{FEATURE_COPY[feature].label}</span>
              <span className="stg:block stg:text-xs stg:text-muted-foreground">
                {FEATURE_COPY[feature].description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      {draft.features.includes(Feature.managed_organizations) && (
        <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2">
          <Field label="Managed organizations included (empty: unlimited)">
            <input
              className={INPUT_CLASSES}
              inputMode="numeric"
              value={draft.includedManagedOrganizations}
              onChange={(e) => set("includedManagedOrganizations", e.target.value)}
            />
            {fieldError("includedManagedOrganizations")}
          </Field>
          <Field label="Each one beyond (USD/month)">
            <input
              className={INPUT_CLASSES}
              inputMode="decimal"
              value={draft.perExtraOrganizationUsd}
              onChange={(e) => set("perExtraOrganizationUsd", e.target.value)}
            />
            {fieldError("perExtraOrganizationUsd")}
          </Field>
        </div>
      )}

      {confirming && (
        <p className="stg:rounded-md stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-foreground" role="status">
          A plan&apos;s terms are final once it exists: every subscriber on it is invoiced by them. A change of terms is
          a new plan, and this one is retired. Create it?
        </p>
      )}
      {creator.error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(creator.error)}
        </p>
      )}

      <div className="stg:flex stg:justify-end stg:gap-2">
        <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={creator.isSubmitting}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!result.ok || creator.isSubmitting}>
          {confirming ? "Create plan" : "Review"}
        </Button>
      </div>
    </form>
  );
}
