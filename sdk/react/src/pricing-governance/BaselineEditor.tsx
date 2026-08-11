"use client";

import { useCallback, useState, type FormEvent } from "react";
import { create } from "@bufbuild/protobuf";
import { getUserMessage } from "@stigmer/sdk";
import {
  ModelPricingBaselineSchema,
  PricingBlockSchema,
  PricingVariantSchema,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { Field, INPUT_CLASSES } from "../internal/form-primitives.js";
import {
  ZERO,
  dollarsToMicros,
  formatRate,
  microsToDollarString,
} from "./pricing-format.js";

// ---------------------------------------------------------------------------
// BaselineEditor — the add/edit form for model registry baselines, with an
// explicit old→new rate confirmation step (a billing-critical edit is never
// submitted without the operator seeing exactly which rates move).
//
// Internal to the pricing-governance module: rendered by
// PricingGovernanceConsole and ModelCatalogPanel, never exported from the
// barrel.
// ---------------------------------------------------------------------------

/**
 * Dollar-rate input field (decimal keypad, "$ per million tokens").
 * File-local: this is the editor's own composition of the shared form
 * primitives, used nowhere else.
 */
function RateField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        className={INPUT_CLASSES}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
      />
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Form model — strings while editing, converted + validated on submit.
// Validation mirrors the protovalidate rules on ModelPricingBaseline so
// errors surface before the RPC.
// ---------------------------------------------------------------------------

interface VariantForm {
  readonly key: string;
  readonly input: string;
  readonly output: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
  /** Comma-separated wire ids. */
  readonly wireIds: string;
}

interface CatalogForm {
  readonly modelId: string;
  readonly apiModelId: string;
  readonly provider: string;
  readonly harness: string;
  readonly displayName: string;
  readonly shortDescription: string;
  readonly speedTier: string;
  readonly costTier: string;
  readonly featured: boolean;
  readonly input: string;
  readonly output: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
  readonly cursorRate: string;
  readonly variants: readonly VariantForm[];
  readonly revisionNote: string;
}

const EMPTY_FORM: CatalogForm = {
  modelId: "",
  apiModelId: "",
  provider: "",
  harness: "native",
  displayName: "",
  shortDescription: "",
  speedTier: "fast",
  costTier: "standard",
  featured: false,
  input: "",
  output: "",
  cacheWrite: "0",
  cacheRead: "0",
  cursorRate: "",
  variants: [],
  revisionNote: "",
};

function formFromBaseline(baseline: ModelPricingBaseline): CatalogForm {
  const pricing = baseline.pricing;
  return {
    modelId: baseline.modelId,
    apiModelId: baseline.apiModelId,
    provider: baseline.provider,
    harness: baseline.harness,
    displayName: baseline.displayName,
    shortDescription: baseline.shortDescription,
    speedTier: baseline.speedTier || "fast",
    costTier: baseline.costTier || "standard",
    featured: baseline.featured,
    input: microsToDollarString(pricing?.inputPriceMicrosPerMillion ?? ZERO),
    output: microsToDollarString(pricing?.outputPriceMicrosPerMillion ?? ZERO),
    cacheWrite: microsToDollarString(pricing?.cacheWritePriceMicrosPerMillion ?? ZERO),
    cacheRead: microsToDollarString(pricing?.cacheReadPriceMicrosPerMillion ?? ZERO),
    cursorRate:
      (pricing?.cursorTokenRateMicrosPerMillion ?? ZERO) > ZERO
        ? microsToDollarString(pricing!.cursorTokenRateMicrosPerMillion)
        : "",
    variants: Object.entries(baseline.pricingVariants).map(([key, variant]) => ({
      key,
      input: microsToDollarString(variant.pricing?.inputPriceMicrosPerMillion ?? ZERO),
      output: microsToDollarString(variant.pricing?.outputPriceMicrosPerMillion ?? ZERO),
      cacheWrite: microsToDollarString(variant.pricing?.cacheWritePriceMicrosPerMillion ?? ZERO),
      cacheRead: microsToDollarString(variant.pricing?.cacheReadPriceMicrosPerMillion ?? ZERO),
      wireIds: variant.wireIds.join(", "),
    })),
    revisionNote: "",
  };
}

/**
 * Convert the form to a baseline proto, or return field-level errors.
 *
 * When editing, runtime metadata the form does not surface (context
 * window, summarization, capabilities, per-block provenance) is carried
 * over from the previous revision so a price edit never erases catalog
 * documentation.
 */
function buildBaseline(
  form: CatalogForm,
  carryOver: ModelPricingBaseline | null,
): { baseline?: ModelPricingBaseline; errors: string[] } {
  const errors: string[] = [];
  const requireText = (value: string, label: string) => {
    if (value.trim() === "") errors.push(`${label} is required.`);
    return value.trim();
  };
  const requireRate = (value: string, label: string): bigint => {
    const micros = dollarsToMicros(value);
    if (micros === null) {
      errors.push(`${label} must be a non-negative dollar amount.`);
      return ZERO;
    }
    return micros;
  };

  const modelId = requireText(form.modelId, "Model id");
  const provider = requireText(form.provider, "Provider");
  const harness = requireText(form.harness, "Harness");
  const displayName = requireText(form.displayName, "Display name");

  const input = requireRate(form.input, "Input rate");
  const output = requireRate(form.output, "Output rate");
  const cacheWrite = requireRate(form.cacheWrite, "Cache-write rate");
  const cacheRead = requireRate(form.cacheRead, "Cache-read rate");
  const cursorRate = form.cursorRate.trim() === "" ? ZERO : requireRate(form.cursorRate, "Cursor token rate");

  const seenKeys = new Set<string>();
  const variants: Record<string, ReturnType<typeof buildVariant>> = {};
  for (const variant of form.variants) {
    const key = variant.key.trim();
    if (key === "") {
      errors.push("Every variant needs a key (e.g. \"fast\").");
      continue;
    }
    if (seenKeys.has(key)) {
      errors.push(`Duplicate variant key "${key}".`);
      continue;
    }
    seenKeys.add(key);
    variants[key] = buildVariant(variant, key, carryOver, errors);
  }

  if (errors.length > 0) return { errors };

  const previousPricing = carryOver?.pricing;
  const baseline = create(ModelPricingBaselineSchema, {
    modelId,
    apiModelId: form.apiModelId.trim(),
    provider,
    harness,
    displayName,
    shortDescription: form.shortDescription.trim(),
    speedTier: form.speedTier,
    costTier: form.costTier,
    featured: form.featured,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: input,
      outputPriceMicrosPerMillion: output,
      cacheWritePriceMicrosPerMillion: cacheWrite,
      cacheReadPriceMicrosPerMillion: cacheRead,
      cursorTokenRateMicrosPerMillion: cursorRate,
      // Provenance of an operator edit is the revision itself; keep the
      // previous source string so "where did this rate come from" is
      // never blanked by a UI edit. effective_at is server-stamped.
      source: previousPricing?.source ?? "operator_console",
      sourceNote: previousPricing?.sourceNote ?? "",
    }),
    pricingVariants: variants,
    // Runtime metadata is not editable here — carry the previous
    // revision's values so an edit never erases them.
    contextWindowTokens: carryOver?.contextWindowTokens ?? 0,
    maxOutputTokens: carryOver?.maxOutputTokens ?? 0,
    tokenCounterMethod: carryOver?.tokenCounterMethod ?? "",
    summarization: carryOver?.summarization,
    capabilities: carryOver?.capabilities,
  });
  return { baseline, errors: [] };
}

function buildVariant(
  variant: VariantForm,
  key: string,
  carryOver: ModelPricingBaseline | null,
  errors: string[],
) {
  const rate = (value: string, label: string): bigint => {
    const micros = dollarsToMicros(value);
    if (micros === null) {
      errors.push(`Variant "${key}" ${label} must be a non-negative dollar amount.`);
      return ZERO;
    }
    return micros;
  };
  const previous = carryOver?.pricingVariants[key]?.pricing;
  return create(PricingVariantSchema, {
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: rate(variant.input, "input rate"),
      outputPriceMicrosPerMillion: rate(variant.output, "output rate"),
      cacheWritePriceMicrosPerMillion: rate(variant.cacheWrite, "cache-write rate"),
      cacheReadPriceMicrosPerMillion: rate(variant.cacheRead, "cache-read rate"),
      source: previous?.source ?? "operator_console",
      sourceNote: previous?.sourceNote ?? "",
    }),
    wireIds: variant.wireIds
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w !== ""),
  });
}

// ---------------------------------------------------------------------------
// Rate diff for the confirmation step
// ---------------------------------------------------------------------------

interface RateChange {
  readonly label: string;
  readonly before: string;
  readonly after: string;
}

function diffRates(
  previous: ModelPricingBaseline | null,
  next: ModelPricingBaseline,
): RateChange[] {
  const changes: RateChange[] = [];
  const compare = (label: string, before: bigint | undefined, after: bigint | undefined) => {
    const b = before ?? ZERO;
    const a = after ?? ZERO;
    if (b !== a) {
      changes.push({
        label,
        before: previous ? formatRate(b) : "—",
        after: formatRate(a),
      });
    }
  };

  compare("Input", previous?.pricing?.inputPriceMicrosPerMillion, next.pricing?.inputPriceMicrosPerMillion);
  compare("Output", previous?.pricing?.outputPriceMicrosPerMillion, next.pricing?.outputPriceMicrosPerMillion);
  compare("Cache write", previous?.pricing?.cacheWritePriceMicrosPerMillion, next.pricing?.cacheWritePriceMicrosPerMillion);
  compare("Cache read", previous?.pricing?.cacheReadPriceMicrosPerMillion, next.pricing?.cacheReadPriceMicrosPerMillion);
  compare("Cursor token rate", previous?.pricing?.cursorTokenRateMicrosPerMillion, next.pricing?.cursorTokenRateMicrosPerMillion);

  const variantKeys = new Set([
    ...Object.keys(previous?.pricingVariants ?? {}),
    ...Object.keys(next.pricingVariants),
  ]);
  for (const key of variantKeys) {
    const before = previous?.pricingVariants[key]?.pricing;
    const after = next.pricingVariants[key]?.pricing;
    if (!after) {
      changes.push({ label: `Variant "${key}"`, before: "present", after: "removed" });
      continue;
    }
    compare(`Variant "${key}" input`, before?.inputPriceMicrosPerMillion, after.inputPriceMicrosPerMillion);
    compare(`Variant "${key}" output`, before?.outputPriceMicrosPerMillion, after.outputPriceMicrosPerMillion);
    compare(`Variant "${key}" cache write`, before?.cacheWritePriceMicrosPerMillion, after.cacheWritePriceMicrosPerMillion);
    compare(`Variant "${key}" cache read`, before?.cacheReadPriceMicrosPerMillion, after.cacheReadPriceMicrosPerMillion);
  }
  return changes;
}

// ---------------------------------------------------------------------------
// BaselineEditor — form step, then an explicit confirm step
// ---------------------------------------------------------------------------

export function BaselineEditor({
  initial,
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
}: {
  readonly initial: ModelPricingBaseline | null;
  readonly isSubmitting: boolean;
  readonly submitError: Error | null;
  readonly onSubmit: (baseline: ModelPricingBaseline, revisionNote: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [form, setForm] = useState<CatalogForm>(
    initial ? formFromBaseline(initial) : EMPTY_FORM,
  );
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [pendingBaseline, setPendingBaseline] = useState<ModelPricingBaseline | null>(null);

  const set = <K extends keyof CatalogForm>(field: K, value: CatalogForm[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleReview = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const { baseline, errors } = buildBaseline(form, initial);
      setValidationErrors(errors);
      if (baseline) setPendingBaseline(baseline);
    },
    [form, initial],
  );

  const handleConfirm = useCallback(async () => {
    if (!pendingBaseline) return;
    try {
      await onSubmit(pendingBaseline, form.revisionNote.trim());
    } catch {
      // Surfaced via submitError; return to the confirm view.
    }
  }, [pendingBaseline, form.revisionNote, onSubmit]);

  // ── confirm step ──────────────────────────────────────────────────────────
  if (pendingBaseline) {
    const changes = diffRates(initial, pendingBaseline);
    return (
      <div className="stg:space-y-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3 stg:py-3">
        <h4 className="stg:text-xs stg:font-semibold stg:text-foreground">
          {initial ? "Confirm baseline revision" : "Confirm new catalog entry"}
          {" · "}
          <span className="stg:font-normal stg:text-muted-foreground">
            {pendingBaseline.modelId} / {pendingBaseline.provider} / {pendingBaseline.harness}
          </span>
        </h4>
        {changes.length === 0 ? (
          <p className="stg:text-xs stg:text-muted-foreground">
            No rate changes — only catalog fields move. Billing is unaffected.
          </p>
        ) : (
          <div className="stg:space-y-1" role="table" aria-label="Rate changes">
            {changes.map((change) => (
              <p key={change.label} className="stg:text-xs stg:text-foreground" role="row">
                <span className="stg:text-muted-foreground">{change.label}: </span>
                <span className="stg:line-through">{change.before}</span>
                {" → "}
                <span className="stg:font-medium">{change.after}</span>
              </p>
            ))}
            <p className="stg:text-[11px] stg:text-muted-foreground">
              New rates govern charges from the moment this revision is applied
              (forward-only; already-billed records keep their stamps).
            </p>
          </div>
        )}
        {submitError && (
          <p className="stg:text-destructive stg:text-xs" role="alert">
            {getUserMessage(submitError)}
          </p>
        )}
        <div className="stg:flex stg:gap-2">
          <Button size="sm" disabled={isSubmitting} onClick={handleConfirm}>
            {isSubmitting ? "Applying…" : "Apply revision"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => setPendingBaseline(null)}
          >
            Back
          </Button>
        </div>
      </div>
    );
  }

  // ── form step ─────────────────────────────────────────────────────────────
  return (
    <form
      onSubmit={handleReview}
      className="stg:space-y-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:px-3 stg:py-3"
    >
      <h4 className="stg:text-xs stg:font-semibold stg:text-foreground">
        {initial ? `Edit ${initial.modelId}` : "Add model"}
      </h4>

      <div className="stg:grid stg:grid-cols-2 stg:gap-2">
        <Field label="Model id" required>
          <input
            className={INPUT_CLASSES}
            value={form.modelId}
            onChange={(e) => set("modelId", e.target.value)}
            placeholder="e.g. claude-sonnet-4.6"
            // Identity is the catalog key: editing it would create a NEW
            // entry, not revise this one — lock it on edit.
            disabled={initial !== null || isSubmitting}
            required
          />
        </Field>
        <Field label="Provider API id">
          <input
            className={INPUT_CLASSES}
            value={form.apiModelId}
            onChange={(e) => set("apiModelId", e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            disabled={isSubmitting}
          />
        </Field>
        <Field label="Provider" required>
          <input
            className={INPUT_CLASSES}
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
            placeholder="e.g. anthropic"
            disabled={initial !== null || isSubmitting}
            required
          />
        </Field>
        <Field label="Harness" required>
          <select
            className={INPUT_CLASSES}
            value={form.harness}
            onChange={(e) => set("harness", e.target.value)}
            disabled={initial !== null || isSubmitting}
          >
            <option value="native">native</option>
            <option value="cursor">cursor</option>
          </select>
        </Field>
        <Field label="Display name" required>
          <input
            className={INPUT_CLASSES}
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            disabled={isSubmitting}
            required
          />
        </Field>
        <Field label="Short description">
          <input
            className={INPUT_CLASSES}
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            placeholder="3-6 word pitch"
            disabled={isSubmitting}
          />
        </Field>
        <Field label="Speed tier">
          <select
            className={INPUT_CLASSES}
            value={form.speedTier}
            onChange={(e) => set("speedTier", e.target.value)}
            disabled={isSubmitting}
          >
            <option value="fastest">fastest</option>
            <option value="fast">fast</option>
            <option value="balanced">balanced</option>
            <option value="slow">slow</option>
          </select>
        </Field>
        <Field label="Cost tier">
          <select
            className={INPUT_CLASSES}
            value={form.costTier}
            onChange={(e) => set("costTier", e.target.value)}
            disabled={isSubmitting}
          >
            <option value="economy">economy</option>
            <option value="standard">standard</option>
            <option value="premium">premium</option>
          </select>
        </Field>
      </div>

      <label className="stg:flex stg:cursor-pointer stg:items-center stg:gap-1.5 stg:text-xs stg:text-foreground">
        <input
          type="checkbox"
          checked={form.featured}
          onChange={(e) => set("featured", e.target.checked)}
          disabled={isSubmitting}
        />
        Featured (appears in the curated default picker list)
      </label>

      <fieldset className="stg:space-y-2">
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Rates ($ per million tokens)
        </legend>
        <div className="stg:grid stg:grid-cols-2 stg:gap-2 stg:sm:grid-cols-5">
          <RateField label="Input" value={form.input} disabled={isSubmitting} onChange={(v) => set("input", v)} />
          <RateField label="Output" value={form.output} disabled={isSubmitting} onChange={(v) => set("output", v)} />
          <RateField label="Cache write" value={form.cacheWrite} disabled={isSubmitting} onChange={(v) => set("cacheWrite", v)} />
          <RateField label="Cache read" value={form.cacheRead} disabled={isSubmitting} onChange={(v) => set("cacheRead", v)} />
          <RateField
            label="Cursor token rate"
            value={form.cursorRate}
            placeholder="cursor only"
            disabled={isSubmitting}
            onChange={(v) => set("cursorRate", v)}
          />
        </div>
      </fieldset>

      <fieldset className="stg:space-y-2">
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">Pricing variants</legend>
        {form.variants.map((variant, index) => (
          <div key={index} className="stg:space-y-2 stg:rounded-md stg:border stg:border-border-muted stg:px-2.5 stg:py-2">
            <div className="stg:flex stg:items-end stg:gap-2">
              <Field label="Variant key" className="stg:w-32">
                <input
                  className={INPUT_CLASSES}
                  value={variant.key}
                  onChange={(e) => updateVariant(setForm, index, { key: e.target.value })}
                  placeholder="fast"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="Wire ids (comma-separated)" className="stg:flex-1">
                <input
                  className={INPUT_CLASSES}
                  value={variant.wireIds}
                  onChange={(e) => updateVariant(setForm, index, { wireIds: e.target.value })}
                  placeholder="e.g. composer-2.5-fast"
                  disabled={isSubmitting}
                />
              </Field>
              <Button
                size="sm"
                variant="outline"
                disabled={isSubmitting}
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    variants: f.variants.filter((_, i) => i !== index),
                  }))
                }
              >
                Remove
              </Button>
            </div>
            <div className="stg:grid stg:grid-cols-2 stg:gap-2 stg:sm:grid-cols-4">
              <RateField label="Input" value={variant.input} disabled={isSubmitting} onChange={(v) => updateVariant(setForm, index, { input: v })} />
              <RateField label="Output" value={variant.output} disabled={isSubmitting} onChange={(v) => updateVariant(setForm, index, { output: v })} />
              <RateField label="Cache write" value={variant.cacheWrite} disabled={isSubmitting} onChange={(v) => updateVariant(setForm, index, { cacheWrite: v })} />
              <RateField label="Cache read" value={variant.cacheRead} disabled={isSubmitting} onChange={(v) => updateVariant(setForm, index, { cacheRead: v })} />
            </div>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          disabled={isSubmitting}
          onClick={() =>
            setForm((f) => ({
              ...f,
              variants: [
                ...f.variants,
                { key: "", input: "", output: "", cacheWrite: "0", cacheRead: "0", wireIds: "" },
              ],
            }))
          }
        >
          Add variant
        </Button>
      </fieldset>

      <Field label="Revision note">
        <input
          className={INPUT_CLASSES}
          value={form.revisionNote}
          onChange={(e) => set("revisionNote", e.target.value)}
          placeholder="Why this revision (audit trail)"
          disabled={isSubmitting}
        />
      </Field>

      {validationErrors.length > 0 && (
        <div role="alert" className="stg:space-y-0.5">
          {validationErrors.map((message) => (
            <p key={message} className="stg:text-destructive stg:text-xs">
              {message}
            </p>
          ))}
        </div>
      )}

      <div className="stg:flex stg:gap-2">
        <Button size="sm" type="submit" disabled={isSubmitting}>
          Review changes
        </Button>
        <Button size="sm" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function updateVariant(
  setForm: (updater: (f: CatalogForm) => CatalogForm) => void,
  index: number,
  patch: Partial<VariantForm>,
) {
  setForm((f) => ({
    ...f,
    variants: f.variants.map((v, i) => (i === index ? { ...v, ...patch } : v)),
  }));
}
