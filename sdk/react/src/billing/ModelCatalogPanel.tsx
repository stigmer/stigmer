"use client";

import { useCallback, useMemo, useState, type FormEvent } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  PricingVariantSchema,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { useModelPricingBaselines } from "./useModelPricingBaselines.js";
import { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
import { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";

/** Props for {@link ModelCatalogPanel}. */
export interface ModelCatalogPanelProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Money helpers — the UI edits dollars-per-million; the proto stores
// integer micro-USD. Registry prices carry at most 4 decimal places, so
// the round-trip through Math.round is exact.
// ---------------------------------------------------------------------------

// BigInt literals (0n) require an ES2020 target, which not every consuming
// app's tsconfig guarantees — the constructor form is target-agnostic.
const ZERO = BigInt(0);

function microsToDollarString(micros: bigint): string {
  if (micros === ZERO) return "0";
  const dollars = Number(micros) / 1_000_000;
  // Trim trailing zeros without losing sub-cent precision (e.g. 0.075).
  return String(parseFloat(dollars.toFixed(6)));
}

/** Parse a dollar input; returns null for anything that is not a finite, non-negative number. */
function dollarsToMicros(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return BigInt(Math.round(parsed * 1_000_000));
}

function formatRate(micros: bigint): string {
  const dollars = Number(micros) / 1_000_000;
  return `$${dollars.toFixed(dollars < 1 ? 4 : 2)}/M`;
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
// Rate diff for the confirmation step — a billing-critical edit is never
// submitted without the operator seeing exactly which rates move.
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
// ModelCatalogPanel
// ---------------------------------------------------------------------------

type EditorState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly baseline: ModelPricingBaseline };

/**
 * Platform-operator panel for authoring the model registry baseline:
 * the catalog list with revision history, an add/edit form with an
 * explicit old-to-new rate confirmation, and typed-confirmation
 * retirement (DD-004 — this replaces hand edits of
 * {@code model-registry.json}).
 *
 * Requires `can_manage_model_pricing` on `platform:stigmer` — render it
 * only in operator-scoped surfaces. Rates are raw provider prices
 * (pre-markup), not customer prices.
 *
 * @example
 * ```tsx
 * <ModelCatalogPanel />
 * ```
 */
export function ModelCatalogPanel({ className }: ModelCatalogPanelProps) {
  const [showHistory, setShowHistory] = useState(false);
  const { baselines, isLoading, error, refetch } = useModelPricingBaselines({
    includeHistory: showHistory,
  });
  const { upsert, isSubmitting: isUpserting, error: upsertError, clearError: clearUpsertError } =
    useUpsertModelPricingBaseline();
  const { retire, isSubmitting: isRetiring, error: retireError, clearError: clearRetireError } =
    useRetireModelPricingBaseline();

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [retireTarget, setRetireTarget] = useState<ModelPricingBaseline | null>(null);

  const activeBaselines = useMemo(
    () =>
      (baselines ?? []).filter(
        (b) => b.status === ModelPricingBaselineStatus.pricing_baseline_active,
      ),
    [baselines],
  );
  const historyByKey = useMemo(() => {
    const map = new Map<string, ModelPricingBaseline[]>();
    if (!showHistory) return map;
    for (const b of baselines ?? []) {
      if (b.status === ModelPricingBaselineStatus.pricing_baseline_active) continue;
      const key = `${b.modelId}|${b.provider}|${b.harness}`;
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [baselines, showHistory]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    clearUpsertError();
  }, [clearUpsertError]);

  const handleUpsert = useCallback(
    async (baseline: ModelPricingBaseline, revisionNote: string) => {
      await upsert({ baseline, revisionNote: revisionNote || undefined });
      setEditor(null);
      refetch();
    },
    [upsert, refetch],
  );

  const handleRetire = useCallback(
    async (target: ModelPricingBaseline, revisionNote: string) => {
      await retire({
        modelId: target.modelId,
        provider: target.provider,
        harness: target.harness,
        revisionNote: revisionNote || undefined,
      });
      setRetireTarget(null);
      refetch();
    },
    [retire, refetch],
  );

  if (isLoading) {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-muted-subtle" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted-subtle" />
        ))}
      </div>
    );
  }

  if (error) {
    // A non-operator landing here is expected (the route is reachable by
    // URL) — show the designed access notice, not a raw RPC error.
    if (isPermissionDenied(error)) {
      return <OperatorAccessNotice className={className} />;
    }
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <section className={cn("space-y-3", className)} aria-label="Model catalog">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Model Catalog</h3>
        <div className="flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(e) => setShowHistory(e.target.checked)}
            />
            Show revision history
          </label>
          <Button size="sm" onClick={() => setEditor({ mode: "create" })} disabled={editor !== null}>
            Add model
          </Button>
        </div>
      </div>

      {editor && (
        <BaselineEditor
          initial={editor.mode === "edit" ? editor.baseline : null}
          isSubmitting={isUpserting}
          submitError={upsertError}
          onSubmit={handleUpsert}
          onCancel={closeEditor}
        />
      )}

      {retireTarget && (
        <RetireConfirm
          target={retireTarget}
          isSubmitting={isRetiring}
          submitError={retireError}
          onConfirm={handleRetire}
          onCancel={() => {
            setRetireTarget(null);
            clearRetireError();
          }}
        />
      )}

      <div className="rounded-lg border border-border bg-card" role="table" aria-label="Baseline catalog">
        <div
          role="row"
          className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] gap-2 border-b border-border px-3 py-2 text-[11px] font-medium text-muted-foreground"
        >
          <span role="columnheader">Model</span>
          <span role="columnheader">Harness</span>
          <span role="columnheader" className="text-right">Input</span>
          <span role="columnheader" className="text-right">Output</span>
          <span role="columnheader" className="text-right">Variants</span>
          <span role="columnheader" className="sr-only">Actions</span>
        </div>
        {activeBaselines.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            The catalog is empty — has the baseline seed migration run?
          </p>
        ) : (
          activeBaselines.map((baseline) => (
            <CatalogRow
              key={baseline.baselineId}
              baseline={baseline}
              history={historyByKey.get(
                `${baseline.modelId}|${baseline.provider}|${baseline.harness}`,
              )}
              disabled={editor !== null || retireTarget !== null}
              onEdit={() => setEditor({ mode: "edit", baseline })}
              onRetire={() => setRetireTarget(baseline)}
            />
          ))
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// CatalogRow (internal)
// ---------------------------------------------------------------------------

function CatalogRow({
  baseline,
  history,
  disabled,
  onEdit,
  onRetire,
}: {
  readonly baseline: ModelPricingBaseline;
  readonly history?: readonly ModelPricingBaseline[];
  readonly disabled: boolean;
  readonly onEdit: () => void;
  readonly onRetire: () => void;
}) {
  const variantCount = Object.keys(baseline.pricingVariants).length;
  return (
    <div className="border-b border-border last:border-b-0">
      <div
        role="row"
        className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] items-center gap-2 px-3 py-2 text-xs"
      >
        <span role="cell" className="min-w-0">
          <span className="block truncate font-medium text-foreground" title={baseline.modelId}>
            {baseline.displayName || baseline.modelId}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {baseline.modelId}
            {baseline.featured ? " · featured" : ""}
          </span>
        </span>
        <span role="cell" className="text-muted-foreground">
          {baseline.harness}
        </span>
        <span role="cell" className="text-right text-foreground">
          {formatRate(baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span role="cell" className="text-right text-foreground">
          {formatRate(baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span role="cell" className="text-right text-muted-foreground">
          {variantCount > 0 ? variantCount : "—"}
        </span>
        <span role="cell" className="flex shrink-0 justify-end gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onRetire}>
            Retire
          </Button>
        </span>
      </div>
      {history && history.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {history.map((revision) => (
            <p key={revision.baselineId} className="text-[11px] text-muted-foreground">
              {revision.status === ModelPricingBaselineStatus.pricing_baseline_retired
                ? "Retired"
                : "Superseded"}
              {" · "}
              {formatRate(revision.pricing?.inputPriceMicrosPerMillion ?? ZERO)} in /{" "}
              {formatRate(revision.pricing?.outputPriceMicrosPerMillion ?? ZERO)} out
              {" · "}
              {revision.decidedBy}
              {revision.revisionNote ? ` — ${revision.revisionNote}` : ""}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BaselineEditor (internal) — form, then an explicit confirm step
// ---------------------------------------------------------------------------

const INPUT_CLASSES = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

function BaselineEditor({
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
      <div className="space-y-3 rounded-lg border border-border bg-card px-3 py-3">
        <h4 className="text-xs font-semibold text-foreground">
          {initial ? "Confirm baseline revision" : "Confirm new catalog entry"}
          {" · "}
          <span className="font-normal text-muted-foreground">
            {pendingBaseline.modelId} / {pendingBaseline.provider} / {pendingBaseline.harness}
          </span>
        </h4>
        {changes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No rate changes — only catalog fields move. Billing is unaffected.
          </p>
        ) : (
          <div className="space-y-1" role="table" aria-label="Rate changes">
            {changes.map((change) => (
              <p key={change.label} className="text-xs text-foreground" role="row">
                <span className="text-muted-foreground">{change.label}: </span>
                <span className="line-through">{change.before}</span>
                {" → "}
                <span className="font-medium">{change.after}</span>
              </p>
            ))}
            <p className="text-[11px] text-muted-foreground">
              New rates govern charges from the moment this revision is applied
              (forward-only; already-billed records keep their stamps).
            </p>
          </div>
        )}
        {submitError && (
          <p className="text-destructive text-xs" role="alert">
            {getUserMessage(submitError)}
          </p>
        )}
        <div className="flex gap-2">
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
      className="space-y-3 rounded-lg border border-border bg-card px-3 py-3"
    >
      <h4 className="text-xs font-semibold text-foreground">
        {initial ? `Edit ${initial.modelId}` : "Add model"}
      </h4>

      <div className="grid grid-cols-2 gap-2">
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

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-foreground">
        <input
          type="checkbox"
          checked={form.featured}
          onChange={(e) => set("featured", e.target.checked)}
          disabled={isSubmitting}
        />
        Featured (appears in the curated default picker list)
      </label>

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-foreground">
          Rates ($ per million tokens)
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
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

      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-foreground">Pricing variants</legend>
        {form.variants.map((variant, index) => (
          <div key={index} className="space-y-2 rounded-md border border-border-muted px-2.5 py-2">
            <div className="flex items-end gap-2">
              <Field label="Variant key" className="w-32">
                <input
                  className={INPUT_CLASSES}
                  value={variant.key}
                  onChange={(e) => updateVariant(setForm, index, { key: e.target.value })}
                  placeholder="fast"
                  disabled={isSubmitting}
                />
              </Field>
              <Field label="Wire ids (comma-separated)" className="flex-1">
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
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <div role="alert" className="space-y-0.5">
          {validationErrors.map((message) => (
            <p key={message} className="text-destructive text-xs">
              {message}
            </p>
          ))}
        </div>
      )}

      <div className="flex gap-2">
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

function Field({
  label,
  required,
  className,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

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
// RetireConfirm (internal) — typed confirmation for a destructive action
// ---------------------------------------------------------------------------

function RetireConfirm({
  target,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: {
  readonly target: ModelPricingBaseline;
  readonly isSubmitting: boolean;
  readonly submitError: Error | null;
  readonly onConfirm: (target: ModelPricingBaseline, revisionNote: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const confirmed = typed === target.modelId;

  return (
    <div className="space-y-2 rounded-lg border border-destructive bg-card px-3 py-3">
      <h4 className="text-xs font-semibold text-foreground">
        Retire {target.displayName || target.modelId}?
      </h4>
      <p className="text-xs text-muted-foreground">
        The model disappears from every price surface (billing lookups, model
        pickers, the served registry) and any active pricing overrides on it are
        archived. The revision history is kept, and the key can be revived by a
        later upsert. Type <span className="font-medium text-foreground">{target.modelId}</span>{" "}
        to confirm.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          className={INPUT_CLASSES}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={target.modelId}
          disabled={isSubmitting}
          aria-label="Type the model id to confirm retirement"
        />
        <input
          className={INPUT_CLASSES}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (audit trail)"
          disabled={isSubmitting}
        />
      </div>
      {submitError && (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(submitError)}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={!confirmed || isSubmitting}
          onClick={() => onConfirm(target, note.trim()).catch(() => undefined)}
        >
          {isSubmitting ? "Retiring…" : "Retire model"}
        </Button>
        <Button size="sm" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
