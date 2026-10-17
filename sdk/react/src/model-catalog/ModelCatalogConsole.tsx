"use client";

// ---------------------------------------------------------------------------
// ModelCatalogConsole — the platform-operator console over the model
// registry baseline: a searchable list of the catalog's models at the
// prices the catalog holds, a read-only record per model, and the
// deliberate edit, add and retire steps from there. State lives in
// useModelCatalogView; this file is the rendering and the RPC wiring.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage, isPermissionDenied } from "@stigmer/client";
import type { ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { BaselineEditor } from "./BaselineEditor.js";
import { RetireConfirm } from "./RetireConfirm.js";
import { ModelCatalogDetail } from "./ModelCatalogDetail.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { ZERO, formatRate } from "./pricing-format.js";
import { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";
import { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
import {
  useModelCatalogView,
  type ModelCatalogRow,
} from "./useModelCatalogView.js";

/** Props for {@link ModelCatalogConsole}. */
export interface ModelCatalogConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * The platform-operator model catalog console: every catalog entry with
 * its list rates, searchable. Selecting a row opens a read-only detail
 * record (rate card, variants, catalog metadata, revision history);
 * editing (with an explicit old→new rate confirmation), adding a model
 * and typed-confirmation retirement are deliberate steps from there.
 *
 * Requires `can_manage_model_pricing` on `platform:stigmer` — render it
 * only in operator-scoped surfaces (non-operators see the designed
 * access notice). Rates shown are raw provider prices (pre-markup),
 * not customer prices.
 *
 * @example
 * ```tsx
 * <ModelCatalogConsole />
 * ```
 */
export function ModelCatalogConsole({ className }: ModelCatalogConsoleProps) {
  const view = useModelCatalogView();

  const { upsert, isSubmitting: isUpserting, error: upsertError, clearError: clearUpsertError } =
    useUpsertModelPricingBaseline();
  const { retire, isSubmitting: isRetiring, error: retireError, clearError: clearRetireError } =
    useRetireModelPricingBaseline();

  const handleUpsert = useCallback(
    async (baseline: ModelPricingBaseline, revisionNote: string) => {
      await upsert({ baseline, revisionNote: revisionNote || undefined });
      view.refetch();
      // An edit lands back on the (refreshed) detail; a create lands on
      // the list — the new row's key is derivable but focusing it before
      // the refetch resolves would show stale data.
      if (view.flow.phase === "detail") view.backToDetail();
      else view.backToList();
    },
    [upsert, view.refetch, view.flow.phase, view.backToDetail, view.backToList],
  );

  const handleCancelEdit = useCallback(() => {
    clearUpsertError();
    if (view.flow.phase === "detail") view.backToDetail();
    else view.backToList();
  }, [clearUpsertError, view.flow.phase, view.backToDetail, view.backToList]);

  const handleRetire = useCallback(
    async (target: ModelPricingBaseline, revisionNote: string) => {
      await retire({
        modelId: target.modelId,
        provider: target.provider,
        harness: target.harness,
        revisionNote: revisionNote || undefined,
      });
      view.refetch();
      view.backToList();
    },
    [retire, view.refetch, view.backToList],
  );

  const handleCancelRetire = useCallback(() => {
    clearRetireError();
    view.backToDetail();
  }, [clearRetireError, view.backToDetail]);

  if (view.isLoading) {
    return (
      <div className={cn("stg:space-y-2", className)} aria-busy="true">
        <div className="stg:h-4 stg:w-40 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="stg:h-10 stg:animate-pulse stg:rounded-lg stg:bg-muted-subtle" />
        ))}
      </div>
    );
  }

  if (view.error) {
    // A non-operator landing here is expected (the route is reachable by
    // URL) — show the designed access notice, not a raw RPC error.
    if (isPermissionDenied(view.error)) {
      return <OperatorAccessNotice className={className} />;
    }
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(view.error)}
      </p>
    );
  }

  return (
    <div className={className}>
      <ModelCatalogBody
        view={view}
        isUpserting={isUpserting}
        upsertError={upsertError}
        onUpsert={handleUpsert}
        onCancelEdit={handleCancelEdit}
        isRetiring={isRetiring}
        retireError={retireError}
        onRetire={handleRetire}
        onCancelRetire={handleCancelRetire}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ModelCatalogBody (internal): the list, or the focused model's view
// ---------------------------------------------------------------------------

function ModelCatalogBody({
  view,
  isUpserting,
  upsertError,
  onUpsert,
  onCancelEdit,
  isRetiring,
  retireError,
  onRetire,
  onCancelRetire,
}: {
  readonly view: ReturnType<typeof useModelCatalogView>;
  readonly isUpserting: boolean;
  readonly upsertError: Error | null;
  readonly onUpsert: (baseline: ModelPricingBaseline, revisionNote: string) => Promise<void>;
  readonly onCancelEdit: () => void;
  readonly isRetiring: boolean;
  readonly retireError: Error | null;
  readonly onRetire: (target: ModelPricingBaseline, revisionNote: string) => Promise<void>;
  readonly onCancelRetire: () => void;
}) {
  const { flow, selected } = view;

  if (flow.phase === "create") {
    return (
      <BaselineEditor
        initial={null}
        isSubmitting={isUpserting}
        submitError={upsertError}
        onSubmit={onUpsert}
        onCancel={onCancelEdit}
      />
    );
  }

  // A stale detail key (e.g. the model was just retired) falls through
  // to the list rather than rendering an empty record.
  if (flow.phase === "detail" && selected) {
    if (flow.mode === "edit") {
      return (
        <BaselineEditor
          initial={selected.baseline}
          isSubmitting={isUpserting}
          submitError={upsertError}
          onSubmit={onUpsert}
          onCancel={onCancelEdit}
        />
      );
    }
    if (flow.mode === "retire") {
      return (
        <RetireConfirm
          target={selected.baseline}
          isSubmitting={isRetiring}
          submitError={retireError}
          onConfirm={onRetire}
          onCancel={onCancelRetire}
        />
      );
    }
    return (
      <ModelCatalogDetail
        row={selected}
        onEdit={view.openEdit}
        onRetire={view.openRetire}
        onBack={view.backToList}
      />
    );
  }

  return (
    <div className="stg:space-y-3">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <input
          type="search"
          className={cn(INPUT_CLASSES, "stg:max-w-xs")}
          value={view.modelQuery}
          onChange={(e) => view.setModelQuery(e.target.value)}
          placeholder="Search models…"
          aria-label="Search models"
        />
        <Button size="sm" onClick={view.openCreate}>
          Add model
        </Button>
      </div>

      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card">
        {/* Presentational column guide — each row is a self-describing
            button (its full text content is its accessible name), so
            the header is a visual aid, not an ARIA table header. */}
        <div
          aria-hidden="true"
          className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_0.7fr] stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[11px] stg:font-medium stg:text-muted-foreground"
        >
          <span>Model</span>
          <span>Harness</span>
          <span className="stg:text-right">Input</span>
          <span className="stg:text-right">Output</span>
          <span className="stg:text-right">Variants</span>
        </div>
        {view.models.length === 0 ? (
          <p className="stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
            {view.modelQuery.trim() !== ""
              ? `No models match "${view.modelQuery.trim()}".`
              : "The catalog is empty — has the baseline seed migration run?"}
          </p>
        ) : (
          <ul role="list" aria-label="Models" className={UNSTYLED_LIST}>
            {view.models.map((row) => (
              <ModelRow key={row.key} row={row} onOpen={() => view.openDetail(row.key)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One model row: a real button (keyboard + AT support for "open the
 * record" for free) laid out on the shared column grid. Its full text
 * content is its accessible name, so AT users hear the same facts the
 * columns show.
 */
function ModelRow({
  row,
  onOpen,
}: {
  readonly row: ModelCatalogRow;
  readonly onOpen: () => void;
}) {
  const { baseline } = row;
  const variantCount = Object.keys(baseline.pricingVariants).length;

  return (
    <li className="stg:border-b stg:border-border stg:last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "stg:grid stg:w-full stg:grid-cols-[2fr_1fr_1fr_1fr_0.7fr] stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-left stg:text-xs",
          "stg:transition-colors stg:hover:bg-accent",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
        )}
      >
        <span className="stg:min-w-0">
          {/* The display name needs no tooltip: the model id it used to
              reveal is printed on the line below, which shows its own
              tooltip when clipped. */}
          <span className="stg:block stg:truncate stg:font-medium stg:text-foreground">
            {baseline.displayName || baseline.modelId}
          </span>
          <TruncatedText
            text={`${baseline.modelId}${baseline.featured ? " · featured" : ""}`}
            className="stg:block stg:text-[11px] stg:text-muted-foreground"
          />
        </span>
        <span className="stg:text-muted-foreground">{baseline.harness}</span>
        <span className="stg:text-right stg:text-foreground">
          {formatRate(baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span className="stg:text-right stg:text-foreground">
          {formatRate(baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO)}
        </span>
        <span className="stg:text-right stg:text-muted-foreground">
          {variantCount > 0 ? variantCount : "—"}
        </span>
      </button>
    </li>
  );
}
