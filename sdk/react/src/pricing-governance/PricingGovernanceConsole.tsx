"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, isPermissionDenied } from "@stigmer/sdk";
import type { ModelPricingBaseline } from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { Tabs } from "../tabs/Tabs.js";
import { BaselineEditor } from "./BaselineEditor.js";
import { RetireConfirm } from "./RetireConfirm.js";
import { ModelGovernanceDetail } from "./ModelGovernanceDetail.js";
import { OperatorAccessNotice } from "./OperatorAccessNotice.js";
import { GovernanceBadge, PendingOverrideCard, RateCell } from "./governance-primitives.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { ZERO } from "./pricing-format.js";
import { useDecidePricingOverride } from "./useDecidePricingOverride.js";
import { useRetireModelPricingBaseline } from "./useRetireModelPricingBaseline.js";
import { useUpsertModelPricingBaseline } from "./useUpsertModelPricingBaseline.js";
import {
  useModelGovernanceView,
  type ModelGovernanceRow,
} from "./useModelGovernanceView.js";

/**
 * Tab ids of {@link PricingGovernanceConsole}, accepted by
 * {@link PricingGovernanceConsoleProps.defaultTab}.
 *
 * These ids are deep-link targets: consumers wire them from their own
 * routing (e.g. a `?tab=sign-offs` query param), and external surfaces
 * compose URLs against them. Renaming a member is a breaking change to
 * every link in the wild, not just to this component's props.
 */
export type PricingGovernanceTab = "models" | "sign-offs";

/** Props for {@link PricingGovernanceConsole}. */
export interface PricingGovernanceConsoleProps {
  /** Additional CSS class names. */
  readonly className?: string;
  /**
   * The tab shown on first render. Defaults to `"models"`.
   *
   * Read once at mount, like a form field's `defaultValue` — changing
   * it afterwards has no effect, and the user's tab choice stays local
   * (the console never writes it back anywhere). Wire it from routing
   * to make the tab URL-addressable:
   *
   * ```tsx
   * // e.g. honoring a ?tab=sign-offs deep link
   * const tab = new URLSearchParams(window.location.search).get("tab");
   * <PricingGovernanceConsole
   *   defaultTab={tab === "sign-offs" ? "sign-offs" : undefined}
   * />
   * ```
   */
  readonly defaultTab?: PricingGovernanceTab;
}

const TABS: readonly { readonly id: PricingGovernanceTab; readonly label: string }[] = [
  { id: "models", label: "Models" },
  { id: "sign-offs", label: "Sign-Offs" },
];

/**
 * The platform-operator pricing console: a tabbed surface over the
 * model registry baseline and the pricing feedback loop.
 *
 * - **Models** — every catalog entry joined with its governance state
 *   (effective vs baseline rates, ledger verification), searchable.
 *   Selecting a row opens a read-only detail record; editing (with an
 *   explicit old→new rate confirmation) and typed-confirmation
 *   retirement are deliberate steps from there.
 * - **Sign-Offs** — pricing overrides proposed by reconciliation and
 *   awaiting a human decision, searchable; the tab badge shows the
 *   pending count from anywhere in the console.
 *
 * Requires `can_manage_model_pricing` on `platform:stigmer` — render it
 * only in operator-scoped surfaces (non-operators see the designed
 * access notice). Rates shown are raw provider prices (pre-markup),
 * not customer prices.
 *
 * @example
 * ```tsx
 * <PricingGovernanceConsole />
 * ```
 */
export function PricingGovernanceConsole({
  className,
  defaultTab,
}: PricingGovernanceConsoleProps) {
  const view = useModelGovernanceView();
  // Seeded once from `defaultTab`, then owned locally (see the prop's
  // JSDoc). The membership check is a public-API boundary guard: a JS
  // consumer passing an out-of-union string must land on Models, not on
  // a tabless surface.
  const [activeTab, setActiveTab] = useState<PricingGovernanceTab>(() =>
    defaultTab !== undefined && TABS.some((t) => t.id === defaultTab)
      ? defaultTab
      : "models",
  );

  const { decide, isSubmitting: isDeciding, error: decisionError } = useDecidePricingOverride();
  const { upsert, isSubmitting: isUpserting, error: upsertError, clearError: clearUpsertError } =
    useUpsertModelPricingBaseline();
  const { retire, isSubmitting: isRetiring, error: retireError, clearError: clearRetireError } =
    useRetireModelPricingBaseline();

  const handleDecide = useCallback(
    async (overrideId: string, approve: boolean) => {
      try {
        await decide({ overrideId, approve });
        // A decision changes both the pending queue and (on approval)
        // the effective rates — reload the whole view.
        view.refetch();
      } catch {
        // Surfaced via decisionError below.
      }
    },
    [decide, view.refetch],
  );

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
    <Tabs
      className={className}
      tabs={[
        TABS[0],
        { ...TABS[1], badge: view.pendingCount },
      ]}
      activeTab={activeTab}
      onTabChange={(id) => setActiveTab(id as PricingGovernanceTab)}
      aria-label="Pricing governance sections"
    >
      {activeTab === "models" ? (
        <ModelsTab
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
      ) : (
        <SignOffsTab
          view={view}
          isDeciding={isDeciding}
          decisionError={decisionError}
          onDecide={handleDecide}
        />
      )}
    </Tabs>
  );
}

// ---------------------------------------------------------------------------
// ModelsTab (internal)
// ---------------------------------------------------------------------------

function ModelsTab({
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
  readonly view: ReturnType<typeof useModelGovernanceView>;
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
      <ModelGovernanceDetail
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
          className="stg:grid stg:grid-cols-[2fr_1fr_1fr_1fr_0.7fr_1fr] stg:gap-2 stg:border-b stg:border-border stg:px-3 stg:py-2 stg:text-[11px] stg:font-medium stg:text-muted-foreground"
        >
          <span>Model</span>
          <span>Harness</span>
          <span className="stg:text-right">Input</span>
          <span className="stg:text-right">Output</span>
          <span className="stg:text-right">Variants</span>
          <span className="stg:text-right">Governance</span>
        </div>
        {view.models.length === 0 ? (
          <p className="stg:px-3 stg:py-2 stg:text-xs stg:text-muted-foreground">
            {view.modelQuery.trim() !== ""
              ? `No models match "${view.modelQuery.trim()}".`
              : "The catalog is empty — has the baseline seed migration run?"}
          </p>
        ) : (
          <ul role="list" aria-label="Models" className="stg:m-0 stg:list-none stg:p-0">
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
  readonly row: ModelGovernanceRow;
  readonly onOpen: () => void;
}) {
  const { baseline, governance } = row;
  const variantCount = Object.keys(baseline.pricingVariants).length;
  const hasOverrides = (governance?.activeOverrides.length ?? 0) > 0;

  return (
    <li className="stg:border-b stg:border-border stg:last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "stg:grid stg:w-full stg:grid-cols-[2fr_1fr_1fr_1fr_0.7fr_1fr] stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-left stg:text-xs",
          "stg:transition-colors stg:hover:bg-accent",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
        )}
      >
        <span className="stg:min-w-0">
          <span className="stg:block stg:truncate stg:font-medium stg:text-foreground" title={baseline.modelId}>
            {baseline.displayName || baseline.modelId}
          </span>
          <span className="stg:block stg:truncate stg:text-[11px] stg:text-muted-foreground">
            {baseline.modelId}
            {baseline.featured ? " · featured" : ""}
          </span>
        </span>
        <span className="stg:text-muted-foreground">{baseline.harness}</span>
        <RateCell
          baseline={baseline.pricing?.inputPriceMicrosPerMillion ?? ZERO}
          effective={
            governance?.effectiveInputMicrosPerMillion ??
            baseline.pricing?.inputPriceMicrosPerMillion ??
            ZERO
          }
        />
        <RateCell
          baseline={baseline.pricing?.outputPriceMicrosPerMillion ?? ZERO}
          effective={
            governance?.effectiveOutputMicrosPerMillion ??
            baseline.pricing?.outputPriceMicrosPerMillion ??
            ZERO
          }
        />
        <span className="stg:text-right stg:text-muted-foreground">
          {variantCount > 0 ? variantCount : "—"}
        </span>
        <span className="stg:text-right">
          {governance ? (
            <GovernanceBadge
              ledgerReconcilable={governance.ledgerReconcilable}
              hasOverrides={hasOverrides}
            />
          ) : (
            <span className="stg:text-[10px] stg:text-muted-foreground">—</span>
          )}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------
// SignOffsTab (internal)
// ---------------------------------------------------------------------------

function SignOffsTab({
  view,
  isDeciding,
  decisionError,
  onDecide,
}: {
  readonly view: ReturnType<typeof useModelGovernanceView>;
  readonly isDeciding: boolean;
  readonly decisionError: Error | null;
  readonly onDecide: (overrideId: string, approve: boolean) => void;
}) {
  return (
    <div className="stg:space-y-3">
      <input
        type="search"
        className={cn(INPUT_CLASSES, "stg:max-w-xs")}
        value={view.signOffQuery}
        onChange={(e) => view.setSignOffQuery(e.target.value)}
        placeholder="Search sign-offs…"
        aria-label="Search sign-offs"
      />

      {decisionError && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
          {getUserMessage(decisionError)}
        </p>
      )}

      {view.pendingOverrides.length === 0 ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          {view.signOffQuery.trim() !== ""
            ? `No pending sign-offs match "${view.signOffQuery.trim()}".`
            : "No pricing overrides awaiting a decision."}
        </p>
      ) : (
        <div className="stg:space-y-2">
          {view.pendingOverrides.map((override) => (
            <PendingOverrideCard
              key={override.overrideId}
              override={override}
              isSubmitting={isDeciding}
              onDecide={onDecide}
            />
          ))}
        </div>
      )}
    </div>
  );
}
