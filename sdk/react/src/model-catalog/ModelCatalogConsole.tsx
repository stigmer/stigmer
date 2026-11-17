"use client";

// ---------------------------------------------------------------------------
// ModelCatalogConsole — the platform-operator console over the model
// registry baseline: a searchable list of the catalog's models at the
// prices the catalog holds, a read-only record per model, and the
// deliberate edit, add and retire steps from there. State lives in
// useModelCatalogView; this file is the rendering and the RPC wiring.
// ---------------------------------------------------------------------------

import { useCallback } from "react";
import { isPermissionDenied, isUnimplemented } from "@stigmer/client";
import type { ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { BaselineEditor } from "./BaselineEditor.js";
import { RetireConfirm } from "./RetireConfirm.js";
import { ModelCatalogDetail } from "./ModelCatalogDetail.js";
import { MODEL_CATALOG_DENIAL } from "./OperatorAccessNotice.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { SettingsPage } from "../settings/SettingsPage.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { Table, type TableColumn } from "../internal/surface/Table.js";
import { TruncatedText } from "../internal/truncated-text.js";
import { ZERO, formatRate } from "./pricing-format.js";
import { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";
import { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
import {
  useModelCatalogView,
  type ModelCatalogRow,
} from "./useModelCatalogView.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { TextInput } from "../internal/form/index.js";

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

  // On an edition that keeps no model catalogue the server answers
  // Unimplemented, and a person who is not a platform operator is refused:
  // the frame says either in words, never as the transport's error
  // (stigmer#1230).
  const unavailable = view.error !== null && isUnimplemented(view.error);
  const denied = view.error !== null && isPermissionDenied(view.error);
  const listing = view.flow.phase === "list";
  const { flow, selected } = view;
  // A model open in place names the page, with the way back to the list.
  const open = flow.phase === "detail" && selected ? selected.baseline : null;
  const openName = open ? open.displayName || open.modelId : null;
  const title =
    flow.phase === "create"
      ? "Add model"
      : open && flow.phase === "detail" && flow.mode === "edit"
        ? `Edit prices: ${openName}`
        : (openName ?? "Model catalog");
  const back =
    flow.phase === "create"
      ? { label: "Model catalog", onBack: handleCancelEdit }
      : open && flow.phase === "detail" && flow.mode === "edit"
        ? { label: openName ?? "", onBack: handleCancelEdit }
        : open
          ? { label: "Model catalog", onBack: view.backToList }
          : undefined;
  const description = open
    ? flow.phase === "detail" && flow.mode === "edit"
      ? "A new revision with these prices. The registry serves it as soon as you confirm."
      : `${open.modelId} on the ${open.harness} harness, from ${open.provider}.`
    : flow.phase === "create"
      ? "A new model with its list prices. The registry serves it as soon as you confirm."
      : "Every model the registry serves, at the provider's list prices before any markup. Open one to see its record, edit its prices or retire it.";
  const viewing = open !== null && flow.phase === "detail" && flow.mode === "view";

  return (
    <SettingsPage
      title={title}
      back={back}
      description={description}
      actions={
        listing && !view.isLoading && view.error === null ? (
          <Button size="sm" onClick={view.openCreate}>
            Add model
          </Button>
        ) : viewing ? (
          <>
            <Button size="sm" variant="outline" onClick={view.openEdit}>
              Edit prices
            </Button>
            <Button size="sm" variant="outline" onClick={view.openRetire}>
              Retire
            </Button>
          </>
        ) : undefined
      }
      unavailable={
        unavailable &&
        "The model catalog comes with Stigmer Cloud, which bills for models. On this edition every model is paid for through your own provider keys, at your provider's prices."
      }
      denied={denied ? MODEL_CATALOG_DENIAL : false}
      className={className}
    >
      {view.isLoading ? (
        <SettingsSkeleton label="Loading the model catalog" rows={4} />
      ) : view.error ? (
        <ErrorMessage error={view.error} title="Couldn't load the model catalog." retry={view.refetch} />
      ) : (
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
      )}
    </SettingsPage>
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
    return <ModelCatalogDetail row={selected} />;
  }

  return (
    <div className="stg:space-y-3">
      <TextInput
        type="search"
        className="stg:max-w-xs"
        value={view.modelQuery}
        onChange={(e) => view.setModelQuery(e.target.value)}
        placeholder="Search models…"
        aria-label="Search models"
      />

      {view.models.length === 0 ? (
        view.modelQuery.trim() !== "" ? (
          <EmptyState
            variant="zero-results"
            size="inline"
            resourceLabel="models"
            query={view.modelQuery.trim()}
            action={{ label: "Clear search", onClick: () => view.setModelQuery("") }}
          />
        ) : (
          <EmptyState
            variant="first-use"
            title="No models in the catalog yet"
            description="Add the first model with its list prices, or start the server with its standard catalog."
            action={{ label: "Add model", onClick: view.openCreate }}
          />
        )
      ) : (
        <Table
          aria-label="Models"
          columns={MODEL_COLUMNS}
          rows={view.models}
          rowKey={(row) => row.key}
          onRowClick={(row) => view.openDetail(row.key)}
        />
      )}
    </div>
  );
}

/** The catalog's columns: a model's name and id, its harness, its list rates and its variants. */
const MODEL_COLUMNS: readonly TableColumn<ModelCatalogRow>[] = [
  {
    id: "model",
    header: "Model",
    cell: ({ baseline }) => baseline.displayName || baseline.modelId,
    // The id needs a tooltip only when it is clipped.
    detail: ({ baseline }) => (
      <TruncatedText text={`${baseline.modelId}${baseline.featured ? " · featured" : ""}`} className="stg:block" />
    ),
  },
  { id: "harness", header: "Harness", cell: ({ baseline }) => baseline.harness },
  {
    id: "input",
    header: "Input",
    align: "end",
    cell: ({ baseline }) => formatRate(baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO),
  },
  {
    id: "output",
    header: "Output",
    align: "end",
    cell: ({ baseline }) => formatRate(baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO),
  },
  {
    id: "variants",
    header: "Variants",
    align: "end",
    narrow: "hidden",
    cell: ({ baseline }) => {
      const count = Object.keys(baseline.pricingVariants).length;
      return count > 0 ? count : "—";
    },
  },
];
