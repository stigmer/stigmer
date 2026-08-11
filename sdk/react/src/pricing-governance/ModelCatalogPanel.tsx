"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import {
  ModelPricingBaselineStatus,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { BaselineEditor } from "./BaselineEditor.js";
import { RetireConfirm } from "./RetireConfirm.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { ZERO, formatRate } from "./pricing-format.js";
import { useModelPricingBaselines } from "./useModelPricingBaselines.js";
import { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
import { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";

/** Props for {@link ModelCatalogPanel}. */
export interface ModelCatalogPanelProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

type EditorState =
  | { readonly mode: "create" }
  | { readonly mode: "edit"; readonly baseline: ModelPricingBaseline };

/**
 * Platform-operator panel for authoring the model registry baseline:
 * the catalog list with revision history, an add/edit form with an
 * explicit old-to-new rate confirmation, and typed-confirmation
 * retirement (DD-004 — this replaces hand edits of
 * `model-registry.json`).
 *
 * Prefer {@link PricingGovernanceConsole} for new surfaces — it
 * composes this catalog with the governance view into one tabbed
 * console. This standalone panel remains for consumers embedding just
 * the catalog editor.
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
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
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
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  return (
    <section className={cn("stg:space-y-3", className)} aria-label="Model catalog">
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Model Catalog</h3>
        <div className="stg:flex stg:items-center stg:gap-3">
          <label className="stg:flex stg:cursor-pointer stg:items-center stg:gap-1.5 stg:text-[11px] stg:text-muted-foreground">
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

      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card" role="table" aria-label="Baseline catalog">
        <div
          role="row"
          className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[11px] stg:font-medium stg:text-muted-foreground"
        >
          <span role="columnheader">Model</span>
          <span role="columnheader">Harness</span>
          <span role="columnheader" className="stg:text-right">Input</span>
          <span role="columnheader" className="stg:text-right">Output</span>
          <span role="columnheader" className="stg:text-right">Variants</span>
          <span role="columnheader" className="stg:sr-only">Actions</span>
        </div>
        {activeBaselines.length === 0 ? (
          <p className="stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
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
    <div className="stg:border-b stg:border-border stg:last:border-b-0">
      <div
        role="row"
        className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-xs"
      >
        <span role="cell" className="stg:min-w-0">
          <span className="stg:block stg:truncate stg:font-medium stg:text-foreground" title={baseline.modelId}>
            {baseline.displayName || baseline.modelId}
          </span>
          <span className="stg:block stg:truncate stg:text-[11px] stg:text-muted-foreground">
            {baseline.modelId}
            {baseline.featured ? " · featured" : ""}
          </span>
        </span>
        <span role="cell" className="stg:text-muted-foreground">
          {baseline.harness}
        </span>
        <span role="cell" className="stg:text-right stg:text-foreground">
          {formatRate(baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span role="cell" className="stg:text-right stg:text-foreground">
          {formatRate(baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span role="cell" className="stg:text-right stg:text-muted-foreground">
          {variantCount > 0 ? variantCount : "—"}
        </span>
        <span role="cell" className="stg:flex stg:shrink-0 stg:justify-end stg:gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={onEdit}>
            Edit
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={onRetire}>
            Retire
          </Button>
        </span>
      </div>
      {history && history.length > 0 && (
        <div className="stg:space-y-1 stg:px-3 stg:pb-2">
          {history.map((revision) => (
            <p key={revision.baselineId} className="stg:text-[11px] stg:text-muted-foreground">
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
