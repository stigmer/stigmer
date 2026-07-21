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
