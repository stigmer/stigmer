"use client";

/**
 * By harness: the organization's tokens and calls per run harness
 * (Stigmer, Claude) as a segmented bar over one line per harness
 * ("Stigmer · 18.4M tokens · 3.0k calls · 100%"), each engine named as the
 * pickers name it (`HARNESS_META`), in a section beside "By model".
 *
 * Segments are sized by tokens, the one measure every run has (a run
 * counted from its runner's own report has tokens and no metered calls).
 * Usage is tokens, never money. The suite in
 * `__tests__/HarnessSplitCard.test.tsx` pins the labels, shares and the
 * empty case.
 */

import { cn } from "@stigmer/design-tokens";
import type { HarnessUsage } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META, isNamedHarness } from "@stigmer/react-core/internal";
import { Section } from "../resource-detail/Section.js";
import { formatCalls, formatTokens, sharePercent } from "./format.js";

/** Props for {@link HarnessSplitCard}. */
export interface HarnessSplitCardProps {
  /** Harness breakdown entries from the org usage report. */
  readonly breakdown: readonly HarnessUsage[];
  /** Additional CSS class names. */
  readonly className?: string;
}

const HARNESS_COLORS: Readonly<Record<HarnessOption, string>> = {
  stigmer: "stg:bg-chart-1",
  claude: "stg:bg-chart-2",
};

/** A usage row's engine word, by its name and colour; a word this build does not name keeps its own, in a neutral colour. */
function engineOf(harness: string): { readonly label: string; readonly color: string } {
  return isNamedHarness(harness) ? { label: HARNESS_META[harness].label, color: HARNESS_COLORS[harness] } : { label: harness, color: "stg:bg-chart-4" };
}

/**
 * Displays the token split between run harnesses as a segmented bar.
 *
 * Renders a horizontal bar over one line per harness naming its tokens,
 * calls and share, for an at-a-glance read of each harness's usage.
 */
export function HarnessSplitCard({
  breakdown,
  className,
}: HarnessSplitCardProps) {
  if (breakdown.length === 0) return null;

  const totalTokens = breakdown.reduce(
    (sum, h) => sum + Number(h.totalTokens),
    0,
  );

  if (totalTokens <= 0) return null;

  return (
    <Section title="By harness" className={className}>
      <div className="stg:p-4">
        {/* Segmented bar */}
        <div
          className="stg:flex stg:h-3 stg:w-full stg:overflow-hidden stg:rounded-full"
          role="img"
          aria-label="Token distribution by harness"
        >
          {breakdown.map((entry) => {
            const pct = (Number(entry.totalTokens) / totalTokens) * 100;
            if (pct <= 0) return null;
            return (
              <div
                key={entry.harness}
                className={cn("stg:transition-all", engineOf(entry.harness).color)}
                style={{ width: `${pct}%` }}
              />
            );
          })}
        </div>

        {/* One line per harness: name · tokens · calls · share. */}
        <div className="stg:mt-2.5 stg:flex stg:flex-wrap stg:gap-x-5 stg:gap-y-1">
          {breakdown.map((entry) => {
            const engine = engineOf(entry.harness);
            const pct = sharePercent(entry.totalTokens, totalTokens);
            return (
              <div key={entry.harness} className="stg:flex stg:min-w-0 stg:items-center stg:gap-1.5">
                <div className={cn("stg:size-2 stg:shrink-0 stg:rounded-full", engine.color)} />
                <span className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
                  {`${engine.label} · ${formatTokens(entry.totalTokens)} · ${formatCalls(entry.callCount)} · ${pct}%`}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}
