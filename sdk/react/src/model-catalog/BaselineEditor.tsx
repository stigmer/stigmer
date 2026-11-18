"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";
import { create } from "@bufbuild/protobuf";
import { getUserMessage } from "@stigmer/client";
import {
  LongContextPricingSchema,
  ModelPricingBaselineSchema,
  PricingBlockSchema,
  PricingVariantSchema,
  type LongContextPricing,
  type ModelPricingBaseline,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { Card, cardClasses } from "../internal/surface/Card.js";
import { HARNESS_OPTIONS } from "@stigmer/react-core/internal";
import {
  ZERO,
  dollarsToMicros,
  formatRate,
  formatTokens,
  microsToDollarString,
} from "./pricing-format.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import { Checkbox, Field, FieldError, Select, TextInput } from "../internal/form/index.js";

// ---------------------------------------------------------------------------
// BaselineEditor — the add/edit form for model registry baselines, with an
// explicit old→new rate confirmation step (a billing-critical edit is never
// submitted without the operator seeing exactly which rates move). The
// base block and each variant carry an optional "Long prompts" group: the
// prompt length above which a call pays higher rates, and those four rates.
// Every field empty means one price at every length; a group partly filled
// is one form error. The page's title names what is edited.
//
// Internal to the model-catalog module: rendered by ModelCatalogConsole,
// never exported from the barrel.
// ---------------------------------------------------------------------------

/**
 * Dollar-rate input field (decimal keypad, "$ per million tokens").
 * File-local: this is the editor's own composition of the shared form
 * primitives, used nowhere else.
 */
function RateField({
  label,
  value,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <TextInput
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0.00"
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

/** The long-prompt step's fields, strings while editing; all empty means no step. */
interface LongForm {
  readonly threshold: string;
  readonly input: string;
  readonly output: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
}

const EMPTY_LONG: LongForm = { threshold: "", input: "", output: "", cacheWrite: "", cacheRead: "" };

function longFromStep(step: LongContextPricing | undefined): LongForm {
  if (!step || step.thresholdTokens <= 0) return EMPTY_LONG;
  return {
    threshold: String(step.thresholdTokens),
    input: microsToDollarString(step.inputPriceMicrosPerMillion),
    output: microsToDollarString(step.outputPriceMicrosPerMillion),
    cacheWrite: microsToDollarString(step.cacheWritePriceMicrosPerMillion),
    cacheRead: microsToDollarString(step.cacheReadPriceMicrosPerMillion),
  };
}

/** The most prompt tokens a step's threshold may name (the wire's int32). */
const MAX_THRESHOLD = 2_147_483_647;

/** The step a group's fields make, or none; a group partly filled is one error. */
function buildLong(long: LongForm, prefix: string, errors: string[]): LongContextPricing | undefined {
  const values = [long.threshold, long.input, long.output, long.cacheWrite, long.cacheRead].map((v) => v.trim());
  if (values.every((v) => v === "")) return undefined;
  if (values.some((v) => v === "")) {
    errors.push(`${prefix}Fill every long-prompt field, or none.`);
    return undefined;
  }
  const threshold = /^\d+$/.test(values[0]!) ? Number(values[0]) : NaN;
  if (!Number.isSafeInteger(threshold) || threshold <= 0 || threshold > MAX_THRESHOLD) {
    errors.push(`${prefix}Prompt tokens above must be a whole number above 0.`);
    return undefined;
  }
  const rate = (value: string, label: string): bigint => {
    const micros = dollarsToMicros(value);
    if (micros === null) {
      errors.push(`${prefix}The long-prompt ${label} rate must be a non-negative dollar amount.`);
      return ZERO;
    }
    return micros;
  };
  return create(LongContextPricingSchema, {
    thresholdTokens: threshold,
    inputPriceMicrosPerMillion: rate(long.input, "input"),
    outputPriceMicrosPerMillion: rate(long.output, "output"),
    cacheWritePriceMicrosPerMillion: rate(long.cacheWrite, "cache-write"),
    cacheReadPriceMicrosPerMillion: rate(long.cacheRead, "cache-read"),
  });
}

interface VariantForm {
  readonly key: string;
  readonly input: string;
  readonly output: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
  /** Comma-separated wire ids. */
  readonly wireIds: string;
  readonly long: LongForm;
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
  /** Comma-separated base-level wire ids (inbound aliases). */
  readonly wireIds: string;
  readonly input: string;
  readonly output: string;
  readonly cacheWrite: string;
  readonly cacheRead: string;
  readonly long: LongForm;
  readonly variants: readonly VariantForm[];
  readonly revisionNote: string;
}

const EMPTY_FORM: CatalogForm = {
  modelId: "",
  apiModelId: "",
  provider: "",
  harness: "stigmer",
  displayName: "",
  shortDescription: "",
  speedTier: "fast",
  costTier: "standard",
  featured: false,
  wireIds: "",
  input: "",
  output: "",
  cacheWrite: "0",
  cacheRead: "0",
  long: EMPTY_LONG,
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
    wireIds: baseline.wireIds.join(", "),
    input: microsToDollarString(pricing?.inputPriceMicrosPerMillion ?? ZERO),
    output: microsToDollarString(pricing?.outputPriceMicrosPerMillion ?? ZERO),
    cacheWrite: microsToDollarString(pricing?.cacheWritePriceMicrosPerMillion ?? ZERO),
    cacheRead: microsToDollarString(pricing?.cacheReadPriceMicrosPerMillion ?? ZERO),
    long: longFromStep(pricing?.longContext),
    variants: Object.entries(baseline.pricingVariants).map(([key, variant]) => ({
      key,
      input: microsToDollarString(variant.pricing?.inputPriceMicrosPerMillion ?? ZERO),
      output: microsToDollarString(variant.pricing?.outputPriceMicrosPerMillion ?? ZERO),
      cacheWrite: microsToDollarString(variant.pricing?.cacheWritePriceMicrosPerMillion ?? ZERO),
      cacheRead: microsToDollarString(variant.pricing?.cacheReadPriceMicrosPerMillion ?? ZERO),
      wireIds: variant.wireIds.join(", "),
      long: longFromStep(variant.pricing?.longContext),
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
 * documentation. The long-prompt step is the form's own: shown filled
 * from the previous revision, so an edit that leaves it alone keeps it.
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
  const longContext = buildLong(form.long, "", errors);

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
    wireIds: form.wireIds
      .split(",")
      .map((w) => w.trim())
      .filter((w) => w !== ""),
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: input,
      outputPriceMicrosPerMillion: output,
      cacheWritePriceMicrosPerMillion: cacheWrite,
      cacheReadPriceMicrosPerMillion: cacheRead,
      // Provenance of an operator edit is the revision itself; keep the
      // previous source string so "where did this rate come from" is
      // never blanked by a UI edit. effective_at is server-stamped.
      source: previousPricing?.source ?? "operator_console",
      sourceNote: previousPricing?.sourceNote ?? "",
      longContext,
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
      longContext: buildLong(variant.long, `Variant "${key}": `, errors),
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
  diffStep("", previous?.pricing?.longContext, next.pricing?.longContext, changes);

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
    diffStep(`Variant "${key}" `, before?.longContext, after.longContext, changes);
  }
  return changes;
}

/**
 * The long-prompt step's moves, one line each: its threshold, then each
 * rate "above" it ("Input above 100,000"), a side without a step as "—".
 */
function diffStep(
  prefix: string,
  before: LongContextPricing | undefined,
  after: LongContextPricing | undefined,
  changes: RateChange[],
) {
  const had = before !== undefined && before.thresholdTokens > 0;
  const has = after !== undefined && after.thresholdTokens > 0;
  if (!had && !has) return;
  const line = (label: string) => (prefix === "" ? label : `${prefix}${label.charAt(0).toLowerCase()}${label.slice(1)}`);
  if (before?.thresholdTokens !== after?.thresholdTokens) {
    changes.push({
      label: line("Prompt tokens above"),
      before: had ? formatTokens(before.thresholdTokens) : "—",
      after: has ? formatTokens(after.thresholdTokens) : "—",
    });
  }
  const at = formatTokens((has ? after : before)?.thresholdTokens ?? 0);
  const rates: readonly (readonly [string, (step: LongContextPricing) => bigint])[] = [
    ["Input", (step) => step.inputPriceMicrosPerMillion],
    ["Output", (step) => step.outputPriceMicrosPerMillion],
    ["Cache write", (step) => step.cacheWritePriceMicrosPerMillion],
    ["Cache read", (step) => step.cacheReadPriceMicrosPerMillion],
  ];
  for (const [label, read] of rates) {
    const b = had ? read(before) : null;
    const a = has ? read(after) : null;
    if (b !== a) {
      changes.push({
        label: line(`${label} above ${at}`),
        before: b === null ? "—" : formatRate(b),
        after: a === null ? "—" : formatRate(a),
      });
    }
  }
}

const CHANGE_COLUMNS: readonly TableColumn<RateChange>[] = [
  { id: "rate", header: "Rate", cell: (change) => change.label },
  { id: "now", header: "Now", align: "end", cell: (change) => change.before },
  { id: "new", header: "New", align: "end", cell: (change) => change.after },
];

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
    const name = pendingBaseline.displayName || pendingBaseline.modelId;
    return (
      <Card className="stg:flex stg:flex-col stg:gap-3">
        <div className="stg:flex stg:flex-col stg:gap-1">
          <p className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">
            {initial ? `Save these prices for ${name}?` : `Add ${name} to the catalog?`}
          </p>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            The registry serves the new revision at once; runs priced after that use it. Charges already made keep
            their rates.
          </p>
        </div>
        {changes.length === 0 ? (
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            No rate changes — only catalog fields move. Billing is unaffected.
          </p>
        ) : (
          <Table aria-label="Rate changes" columns={CHANGE_COLUMNS} rows={changes} rowKey={(change) => change.label} />
        )}
        {submitError && (
          <FieldError>
            {getUserMessage(submitError)}
          </FieldError>
        )}
        <div className="stg:flex stg:gap-2">
          <Button size="sm" disabled={isSubmitting} aria-busy={isSubmitting || undefined} onClick={handleConfirm}>
            {isSubmitting ? "Saving…" : initial ? "Save prices" : "Add model"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={isSubmitting}
            onClick={() => setPendingBaseline(null)}
          >
            Back
          </Button>
        </div>
      </Card>
    );
  }

  // ── form step ─────────────────────────────────────────────────────────────
  return (
    <form
      onSubmit={handleReview}
      className={cn(cardClasses(), "stg:space-y-3")}
    >
      <div className="stg:grid stg:grid-cols-2 stg:gap-2">
        <Field label="Model id">
          <TextInput
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
          <TextInput
            value={form.apiModelId}
            onChange={(e) => set("apiModelId", e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
            disabled={isSubmitting}
          />
        </Field>
        <Field label="Provider">
          <TextInput
            value={form.provider}
            onChange={(e) => set("provider", e.target.value)}
            placeholder="e.g. anthropic"
            disabled={initial !== null || isSubmitting}
            required
          />
        </Field>
        <Field label="Harness">
          <Select
            value={form.harness}
            onChange={(e) => set("harness", e.target.value)}
            disabled={initial !== null || isSubmitting}
          >
            {HARNESS_OPTIONS.map((harness) => (
              <option key={harness} value={harness}>
                {harness}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Display name">
          <TextInput
            value={form.displayName}
            onChange={(e) => set("displayName", e.target.value)}
            disabled={isSubmitting}
            required
          />
        </Field>
        <Field label="Short description">
          <TextInput
            value={form.shortDescription}
            onChange={(e) => set("shortDescription", e.target.value)}
            placeholder="3-6 word pitch"
            disabled={isSubmitting}
          />
        </Field>
        <Field label="Speed tier">
          <Select
            value={form.speedTier}
            onChange={(e) => set("speedTier", e.target.value)}
            disabled={isSubmitting}
          >
            <option value="fastest">fastest</option>
            <option value="fast">fast</option>
            <option value="balanced">balanced</option>
            <option value="slow">slow</option>
          </Select>
        </Field>
        <Field label="Cost tier">
          <Select
            value={form.costTier}
            onChange={(e) => set("costTier", e.target.value)}
            disabled={isSubmitting}
          >
            <option value="economy">economy</option>
            <option value="standard">standard</option>
            <option value="premium">premium</option>
          </Select>
        </Field>
      </div>

      {/* Inbound aliases, editable on existing entries (unlike identity):
          adding an alias to a live model is this field's primary use. */}
      <Field label="Wire ids (comma-separated)">
        <TextInput
          value={form.wireIds}
          onChange={(e) => set("wireIds", e.target.value)}
          placeholder="e.g. gemini-3-flash-preview"
          disabled={isSubmitting}
        />
      </Field>

      <label className="stg:flex stg:cursor-pointer stg:items-center stg:gap-1.5 stg:text-xs stg:text-foreground">
        <Checkbox
          checked={form.featured}
          onChange={(e) => set("featured", e.target.checked)}
          disabled={isSubmitting}
        />
        Featured (appears in the curated default picker list)
      </label>

      <fieldset className={`${UNSTYLED_FIELDSET} stg:space-y-2`}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">
          Rates ($ per million tokens)
        </legend>
        <div className="stg:grid stg:grid-cols-2 stg:gap-2 stg:sm:grid-cols-4">
          <RateField label="Input" value={form.input} disabled={isSubmitting} onChange={(v) => set("input", v)} />
          <RateField label="Output" value={form.output} disabled={isSubmitting} onChange={(v) => set("output", v)} />
          <RateField label="Cache write" value={form.cacheWrite} disabled={isSubmitting} onChange={(v) => set("cacheWrite", v)} />
          <RateField label="Cache read" value={form.cacheRead} disabled={isSubmitting} onChange={(v) => set("cacheRead", v)} />
        </div>
      </fieldset>

      <LongPromptsGroup
        long={form.long}
        disabled={isSubmitting}
        onChange={(patch) => setForm((f) => ({ ...f, long: { ...f.long, ...patch } }))}
      />

      <fieldset className={`${UNSTYLED_FIELDSET} stg:space-y-2`}>
        <legend className="stg:text-xs stg:font-medium stg:text-foreground">Pricing variants</legend>
        {form.variants.map((variant, index) => (
          <div key={index} className="stg:space-y-2 stg:rounded-md stg:border stg:border-border-muted stg:px-2.5 stg:py-2">
            <div className="stg:flex stg:items-end stg:gap-2">
              <Field label="Variant key" className="stg:w-32">
                <TextInput
                  value={variant.key}
                  onChange={(e) => updateVariant(setForm, index, { key: e.target.value })}
                  placeholder="fast"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="Wire ids (comma-separated)" className="stg:flex-1">
                <TextInput
                  value={variant.wireIds}
                  onChange={(e) => updateVariant(setForm, index, { wireIds: e.target.value })}
                  placeholder="e.g. claude-opus-4-8-fast"
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
            <LongPromptsGroup
              long={variant.long}
              disabled={isSubmitting}
              onChange={(patch) => updateVariant(setForm, index, { long: { ...variant.long, ...patch } })}
            />
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
                { key: "", input: "", output: "", cacheWrite: "0", cacheRead: "0", wireIds: "", long: EMPTY_LONG },
              ],
            }))
          }
        >
          Add variant
        </Button>
      </fieldset>

      <Field label="Revision note">
        <TextInput
          value={form.revisionNote}
          onChange={(e) => set("revisionNote", e.target.value)}
          placeholder="Why this revision (audit trail)"
          disabled={isSubmitting}
        />
      </Field>

      {validationErrors.length > 0 && (
        <div className="stg:flex stg:flex-col stg:gap-1">
          {validationErrors.map((message) => (
            <FieldError key={message}>{message}</FieldError>
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

/**
 * The optional long-prompt step: the prompt length above which a call
 * pays higher rates, and those four rates. Empty means one price at every
 * length.
 */
function LongPromptsGroup({
  long,
  disabled,
  onChange,
}: {
  readonly long: LongForm;
  readonly disabled: boolean;
  readonly onChange: (patch: Partial<LongForm>) => void;
}) {
  return (
    <fieldset className={`${UNSTYLED_FIELDSET} stg:flex stg:flex-col stg:gap-2 stg:border-t stg:border-border-muted stg:pt-4`}>
      <legend className="stg:float-left stg:mb-1 stg:text-sm stg:font-semibold stg:text-foreground">
        Long prompts <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
      </legend>
      <p className="stg:clear-both stg:m-0 stg:text-xs stg:text-muted-foreground">
        A higher price once a prompt is longer than the number below. Leave every field empty for one price at
        every length.
      </p>
      <Field label="Prompt tokens above" className="stg:max-w-48">
        <TextInput
          inputMode="numeric"
          value={long.threshold}
          onChange={(e) => onChange({ threshold: e.target.value })}
          placeholder="100000"
          disabled={disabled}
        />
      </Field>
      <div className="stg:grid stg:grid-cols-2 stg:gap-2 stg:sm:grid-cols-4">
        <RateField label="Input above" value={long.input} disabled={disabled} onChange={(v) => onChange({ input: v })} />
        <RateField label="Output above" value={long.output} disabled={disabled} onChange={(v) => onChange({ output: v })} />
        <RateField label="Cache write above" value={long.cacheWrite} disabled={disabled} onChange={(v) => onChange({ cacheWrite: v })} />
        <RateField label="Cache read above" value={long.cacheRead} disabled={disabled} onChange={(v) => onChange({ cacheRead: v })} />
      </div>
    </fieldset>
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
