"use client";

// ---------------------------------------------------------------------------
// useModelCatalogView — the model catalog console's view state: one row
// per ACTIVE catalog entry with its revision history folded in, the
// search over that list, and the list/create/detail flow. Pure
// composition over useModelPricingBaselines, so its tests drive it
// through a mocked data hook and the RPC wiring is pinned by the
// console's suite.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import {
  ModelPricingBaselineStatus,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { useModelPricingBaselines } from "./useModelPricingBaselines.js";

/**
 * One model in the catalog view: the ACTIVE catalog baseline and its
 * append-only revision history.
 */
export interface ModelCatalogRow {
  /** Stable identity: `modelId|provider|harness` (the catalog key). */
  readonly key: string;
  /** The ACTIVE baseline revision (catalog fields + list rates). */
  readonly baseline: ModelPricingBaseline;
  /** SUPERSEDED / RETIRED revisions, newest first as served. */
  readonly history: readonly ModelPricingBaseline[];
}

/**
 * Where the operator is in the console: browsing the model list,
 * creating a new catalog entry, or focused on one model (viewing,
 * editing, or retiring it).
 */
export type ModelCatalogFlow =
  | { readonly phase: "list" }
  | { readonly phase: "create" }
  | {
      readonly phase: "detail";
      readonly modelKey: string;
      readonly mode: "view" | "edit" | "retire";
    };

/** Return value of {@link useModelCatalogView}. */
export interface UseModelCatalogViewReturn {
  /** Catalog rows, filtered by {@link modelQuery}, sorted by display name. */
  readonly models: readonly ModelCatalogRow[];
  /** Current search text over the model list. */
  readonly modelQuery: string;
  /** Set the model-list search text. */
  readonly setModelQuery: (query: string) => void;
  /** Current console flow state. */
  readonly flow: ModelCatalogFlow;
  /** The focused model when {@link flow} is in the detail phase, else `null`. */
  readonly selected: ModelCatalogRow | null;
  /** Focus one model (read-only detail). */
  readonly openDetail: (modelKey: string) => void;
  /** Open the add-model editor. */
  readonly openCreate: () => void;
  /** Switch the focused model into the edit form. */
  readonly openEdit: () => void;
  /** Switch the focused model into the retire confirmation. */
  readonly openRetire: () => void;
  /** Leave edit/retire back to the read-only detail. */
  readonly backToDetail: () => void;
  /** Return to the model list. */
  readonly backToList: () => void;
  /** `true` while the catalog is in its initial load. */
  readonly isLoading: boolean;
  /** The catalog fetch's error, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the catalog. */
  readonly refetch: () => void;
}

/** The catalog identity key. */
function modelKey(entry: {
  readonly modelId: string;
  readonly provider: string;
  readonly harness: string;
}): string {
  return `${entry.modelId}|${entry.provider}|${entry.harness}`;
}

function matchesQuery(query: string, ...fields: readonly string[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  return fields.some((field) => field.toLowerCase().includes(q));
}

/**
 * Behavior hook backing the model catalog console: reads the model
 * registry baseline catalog ({@link useModelPricingBaselines}, with
 * history) into one row per catalog key, and owns the console's search
 * and list/create/detail flow state.
 *
 * Platform-operator surface: the caller needs `can_manage_model_pricing`
 * on `platform:stigmer`; rates are raw provider prices (pre-markup).
 *
 * @example
 * ```tsx
 * const view = useModelCatalogView();
 * return view.models.map((row) => <ModelRow key={row.key} row={row} />);
 * ```
 */
export function useModelCatalogView(): UseModelCatalogViewReturn {
  // History is always fetched so opening a detail view never triggers a
  // second round-trip; the catalog is small (dozens of models) and this
  // is an operator-only surface.
  const baselinesFetch = useModelPricingBaselines({ includeHistory: true });

  const [modelQuery, setModelQuery] = useState("");
  const [flow, setFlow] = useState<ModelCatalogFlow>({ phase: "list" });

  const rows = useMemo<readonly ModelCatalogRow[]>(() => {
    const baselines = baselinesFetch.baselines ?? [];

    const historyByKey = new Map<string, ModelPricingBaseline[]>();
    for (const baseline of baselines) {
      if (baseline.status === ModelPricingBaselineStatus.pricing_baseline_active) continue;
      const key = modelKey(baseline);
      historyByKey.set(key, [...(historyByKey.get(key) ?? []), baseline]);
    }

    return baselines
      .filter((b) => b.status === ModelPricingBaselineStatus.pricing_baseline_active)
      .map((baseline) => {
        const key = modelKey(baseline);
        return {
          key,
          baseline,
          history: historyByKey.get(key) ?? [],
        };
      })
      .sort((a, b) =>
        (a.baseline.displayName || a.baseline.modelId).localeCompare(
          b.baseline.displayName || b.baseline.modelId,
        ),
      );
  }, [baselinesFetch.baselines]);

  const models = useMemo(
    () =>
      rows.filter((row) =>
        matchesQuery(
          modelQuery,
          row.baseline.modelId,
          row.baseline.displayName,
          row.baseline.provider,
          row.baseline.harness,
        ),
      ),
    [rows, modelQuery],
  );

  // Resolve the focused row fresh each render so a refetch (e.g. after an
  // edit) is reflected in the open detail; a retired model resolves to
  // null and the console falls back to the list.
  const selected = useMemo(() => {
    if (flow.phase !== "detail") return null;
    return rows.find((row) => row.key === flow.modelKey) ?? null;
  }, [flow, rows]);

  const openDetail = useCallback(
    (key: string) => setFlow({ phase: "detail", modelKey: key, mode: "view" }),
    [],
  );
  const openCreate = useCallback(() => setFlow({ phase: "create" }), []);
  const openEdit = useCallback(
    () =>
      setFlow((f) =>
        f.phase === "detail" ? { ...f, mode: "edit" } : f,
      ),
    [],
  );
  const openRetire = useCallback(
    () =>
      setFlow((f) =>
        f.phase === "detail" ? { ...f, mode: "retire" } : f,
      ),
    [],
  );
  const backToDetail = useCallback(
    () =>
      setFlow((f) =>
        f.phase === "detail" ? { ...f, mode: "view" } : f,
      ),
    [],
  );
  const backToList = useCallback(() => setFlow({ phase: "list" }), []);

  const { refetch, isLoading, error } = baselinesFetch;

  return useMemo(
    () => ({
      models,
      modelQuery,
      setModelQuery,
      flow,
      selected,
      openDetail,
      openCreate,
      openEdit,
      openRetire,
      backToDetail,
      backToList,
      isLoading,
      error,
      refetch,
    }),
    [
      models,
      modelQuery,
      flow,
      selected,
      openDetail,
      openCreate,
      openEdit,
      openRetire,
      backToDetail,
      backToList,
      isLoading,
      error,
      refetch,
    ],
  );
}
