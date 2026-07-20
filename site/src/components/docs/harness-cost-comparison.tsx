import data from "@/data/harness-cost-comparison.json";
import {
  costBarPercent,
  defaultCategories,
  describeNativeAdvantage,
  formatBenchmarkUsd,
  formatRunDate,
  formatSpread,
  formatTokens,
  parityCategories,
  type ComparisonCategory,
  type HarnessCellData,
  type HarnessCostComparisonData,
} from "./harness-cost-comparison.data";

// Renders the measured native-vs-cursor cost comparison from the curated
// benchmark fixture. Two sections, deliberately ordered:
//
//   1. Model parity — both harnesses pinned to the same model, so the cost
//      delta is pure harness overhead. Stable across reruns; the headline.
//   2. Default models — each harness's auto-selected model on the run date.
//      A dated snapshot: Cursor's routing changes over time, so this section
//      names the routed model and the date instead of implying permanence.
//
// The table is the accessible primary; the cost bars are decorative
// (aria-hidden) with the numbers as their text alternative. The surrounding
// MDX prose must state the headline finding in words — this component never
// carries the takeaway alone.

const comparison = data as HarnessCostComparisonData;

/** One harness's cell: steady-state median, spread, first-call cost, and a decorative scale bar. */
function CostCell({ cell, maxMicros }: { cell: HarnessCellData; maxMicros: number }) {
  return (
    <td className="px-4 py-3 align-top">
      <div className="font-mono text-sm text-foreground">
        {formatBenchmarkUsd(cell.warmBillableMicros)}
        <span className="ml-1 text-xs text-subtle">{formatSpread(cell.spreadMicros)}</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 w-full max-w-24 rounded-full bg-card">
        <div
          className="h-1 rounded-full bg-muted-foreground/60"
          style={{ width: `${costBarPercent(cell.warmBillableMicros, maxMicros)}%` }}
        />
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {cell.coldBillableMicros !== null && (
          <span>first call {formatBenchmarkUsd(cell.coldBillableMicros)} · </span>
        )}
        {formatTokens(cell.totalTokens)} tokens
      </div>
    </td>
  );
}

function ComparisonTable({
  categories,
  showModels,
}: {
  categories: ComparisonCategory[];
  showModels: boolean;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-card">
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Task</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Native</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Cursor</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                Native advantage
              </th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => {
              const maxMicros = Math.max(
                cat.native.warmBillableMicros,
                cat.cursor.warmBillableMicros,
              );
              return (
                <tr key={cat.id} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <div className="text-foreground font-medium">{cat.label}</div>
                    {showModels && (
                      <div className="mt-1 text-xs text-muted-foreground font-mono">
                        {cat.native.model} · {cat.cursor.model}
                      </div>
                    )}
                  </td>
                  <CostCell cell={cat.native} maxMicros={maxMicros} />
                  <CostCell cell={cat.cursor} maxMicros={maxMicros} />
                  <td className="px-4 py-3 align-top text-foreground">
                    {describeNativeAdvantage(cat.warmCostRatio)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function HarnessCostComparison() {
  const parity = parityCategories(comparison);
  const defaults = defaultCategories(comparison);
  const parityModel = parity[0]?.native.model;

  return (
    <div className="space-y-8 not-prose my-6">
      {parity.length > 0 && (
        <section>
          <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-1">
            Same model on both harnesses
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Both harnesses pinned to <span className="font-mono">{parityModel}</span> with an
            identical prompt — the cost difference is harness overhead, not model pricing.
            Costs are the median of {comparison.repsPerCell} warm runs (±half the observed
            spread); &quot;first call&quot; is the cold run that pays the prompt-cache write.
          </p>
          <ComparisonTable categories={parity} showModels={false} />
        </section>
      )}

      {defaults.length > 0 && (
        <section>
          <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-1">
            Default model on each harness
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Each harness picks its own default model, so this is a snapshot: on{" "}
            {formatRunDate(comparison.runTimestamp)}, Cursor auto-routed to{" "}
            <span className="font-mono">{defaults[0]?.cursor.model}</span> and native defaulted
            to <span className="font-mono">{defaults[0]?.native.model}</span>. Cursor&apos;s
            routing changes over time; re-run the benchmark before relying on this section.
          </p>
          <ComparisonTable categories={defaults} showModels={false} />
        </section>
      )}

      <p className="text-xs text-subtle">
        Measured {formatRunDate(comparison.runTimestamp)} · {comparison.repsPerCell} warm
        repetitions per cell after one discarded cache warmup · benchmark suite{" "}
        <span className="font-mono">{comparison.gitSha}</span> · prices include the 10%
        platform commission.
      </p>
    </div>
  );
}
