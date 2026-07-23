"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ModelPricingBaselineStatus,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import type { ModelPricingGovernanceEntry } from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import type { ModelPricingOverride } from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import { useModelPricingBaselines } from "./useModelPricingBaselines.js";
import { usePricingGovernance } from "./usePricingGovernance.js";

/**
 * One model in the unified governance view: the ACTIVE catalog baseline
 * joined with its effective-registry governance state and its
 * append-only revision history.
 */
export interface ModelGovernanceRow {
  /** Stable identity: `modelId|provider|harness` (the catalog key). */
  readonly key: string;
  /** The ACTIVE baseline revision (catalog fields + list rates). */
  readonly baseline: ModelPricingBaseline;
  /**
   * The base-variant governance entry (baseline vs effective rates,
   * active overrides, ledger reconcilability), or `null` when the
   * governance view has no entry for this key — the row then renders
   * baseline rates with no governance state.
   */
  readonly governance: ModelPricingGovernanceEntry | null;
  /** Governance entries for this model's named pricing variants. */
  readonly variantGovernance: readonly ModelPricingGovernanceEntry[];
  /** SUPERSEDED / RETIRED revisions, newest first as served. */
  readonly history: readonly ModelPricingBaseline[];
}

/**
 * Where the operator is in the console: browsing the model list,
 * creating a new catalog entry, or focused on one model (viewing,
 * editing, or retiring it).
 */
export type GovernanceFlow =
  | { readonly phase: "list" }
  | { readonly phase: "create" }
  | {
      readonly phase: "detail";
      readonly modelKey: string;
      readonly mode: "view" | "edit" | "retire";
    };

/** Return value of {@link useModelGovernanceView}. */
export interface UseModelGovernanceViewReturn {
  /** Unified model rows, filtered by {@link modelQuery}, sorted by display name. */
  readonly models: readonly ModelGovernanceRow[];
  /** PENDING_SIGNOFF overrides, filtered by {@link signOffQuery}, oldest first as served. */
  readonly pendingOverrides: readonly ModelPricingOverride[];
  /** Unfiltered pending-override count (for the Sign-Offs tab badge). */
  readonly pendingCount: number;
  /** Current search text over the model list. */
  readonly modelQuery: string;
  /** Set the model-list search text. */
  readonly setModelQuery: (query: string) => void;
  /** Current search text over the sign-off queue. */
  readonly signOffQuery: string;
  /** Set the sign-off search text. */
  readonly setSignOffQuery: (query: string) => void;
  /** Current console flow state. */
  readonly flow: GovernanceFlow;
  /** The focused model when {@link flow} is in the detail phase, else `null`. */
  readonly selected: ModelGovernanceRow | null;
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
  /** `true` while either underlying fetch is in its initial load. */
  readonly isLoading: boolean;
  /** First error from the underlying fetches, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch both the catalog and the governance view. */
  readonly refetch: () => void;
}

/** The catalog identity key shared by both data sources. */
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
 * Behavior hook backing the pricing-governance console: joins the model
 * registry baseline catalog ({@link useModelPricingBaselines}, with
 * history) and the governance view ({@link usePricingGovernance}) into
 * one row per catalog key, and owns the console's search and
 * list/create/detail flow state.
 *
 * The two RPCs describe the same models from different angles — the
 * catalog is what operators author, governance is what the pricing
 * feedback loop composed on top — so the console renders them as one
 * surface instead of two parallel tables. Per-variant governance
 * entries fold into their model's row rather than appearing as
 * top-level rows.
 *
 * Platform-operator surface: the caller needs `can_manage_model_pricing`
 * on `platform:stigmer`; rates are raw provider prices (pre-markup).
 *
 * @example
 * ```tsx
 * const view = useModelGovernanceView();
 * return view.models.map((row) => <ModelRow key={row.key} row={row} />);
 * ```
 */
export function useModelGovernanceView(): UseModelGovernanceViewReturn {
  // History is always fetched so opening a detail view never triggers a
  // second round-trip; the catalog is small (dozens of models) and this
  // is an operator-only surface.
  const baselinesFetch = useModelPricingBaselines({ includeHistory: true });
  const governanceFetch = usePricingGovernance();

  const [modelQuery, setModelQuery] = useState("");
  const [signOffQuery, setSignOffQuery] = useState("");
  const [flow, setFlow] = useState<GovernanceFlow>({ phase: "list" });

  const rows = useMemo<readonly ModelGovernanceRow[]>(() => {
    const baselines = baselinesFetch.baselines ?? [];
    const entries = governanceFetch.governance?.entries ?? [];

    const baseByKey = new Map<string, ModelPricingGovernanceEntry>();
    const variantsByKey = new Map<string, ModelPricingGovernanceEntry[]>();
    for (const entry of entries) {
      const key = modelKey(entry);
      if (entry.variant === "") {
        baseByKey.set(key, entry);
      } else {
        variantsByKey.set(key, [...(variantsByKey.get(key) ?? []), entry]);
      }
    }

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
          governance: baseByKey.get(key) ?? null,
          variantGovernance: variantsByKey.get(key) ?? [],
          history: historyByKey.get(key) ?? [],
        };
      })
      .sort((a, b) =>
        (a.baseline.displayName || a.baseline.modelId).localeCompare(
          b.baseline.displayName || b.baseline.modelId,
        ),
      );
  }, [baselinesFetch.baselines, governanceFetch.governance]);

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

  const allPending = useMemo(
    () => governanceFetch.governance?.pendingOverrides ?? [],
    [governanceFetch.governance],
  );
  const pendingOverrides = useMemo(
    () =>
      allPending.filter((override) =>
        matchesQuery(signOffQuery, override.modelId, override.variant),
      ),
    [allPending, signOffQuery],
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

  const refetch = useCallback(() => {
    baselinesFetch.refetch();
    governanceFetch.refetch();
  }, [baselinesFetch.refetch, governanceFetch.refetch]);

  const isLoading = baselinesFetch.isLoading || governanceFetch.isLoading;
  const error = baselinesFetch.error ?? governanceFetch.error;

  return useMemo(
    () => ({
      models,
      pendingOverrides,
      pendingCount: allPending.length,
      modelQuery,
      setModelQuery,
      signOffQuery,
      setSignOffQuery,
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
      pendingOverrides,
      allPending.length,
      modelQuery,
      signOffQuery,
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
