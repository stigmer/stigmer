"use client";

/**
 * Session usage widget: the session's total tokens first, as a figure, with
 * an "Estimated" tag when any run is counted from its runner's own report,
 * its working time and who served the tokens when that is known under it;
 * then the tokens "By model". The session Usage tab composes the same
 * parts ({@link UsageTotal}, {@link UsageByModel}) around its "By turn"
 * list.
 *
 * Numbers come from {@link useSessionUsage} (the server's session report);
 * the widget only lays them out. Usage is tokens and calls, never money,
 * so nothing here formats a currency. Figures are exact counts
 * (`formatTokenCount`, "41,210"), which stays public for the context gauge
 * and summarization views too.
 * The session Usage tab suite (`session/__tests__/UsageTab.test.tsx`) and
 * `__tests__/usage-views-show-no-money.test.tsx` pin what it renders.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import {
  useSessionUsage,
  type ModelUsageEntry,
  type UseSessionUsageReturn,
} from "@stigmer/react-core";
import { formatWorkingTime } from "../usage/format.js";
import { ServedByLine } from "../usage/ServedByLine.js";
import { Tag } from "../internal/surface/Tag.js";
import { List, ListRow } from "../internal/surface/List.js";
import { FacetSection } from "../session/facets/primitives.js";

/** Props for {@link UsageWidget}. */
export interface UsageWidgetProps {
  /**
   * All runs for the current session — both completed and actively
   * streaming. The widget reads the session usage report for the session
   * these runs belong to, and polls it while any of them is in flight.
   *
   * Renders nothing when the list is empty or the session has no usage.
   */
  readonly runs: readonly Run[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Right-sidebar widget that displays the session's token usage.
 *
 * Leads with the session's total tokens as a figure ("41,210 tokens",
 * tagged "Estimated" when any run is counted from its runner's own report),
 * with its working time and who served the tokens under it when they are
 * known. Then "By model": one row per model with its tokens, its metered
 * calls, and its input, output and cache split.
 *
 * Returns `null` when the session has no usage.
 *
 * All visual properties flow through `--stgm-*` tokens. Zero
 * Console dependencies.
 *
 * @example
 * ```tsx
 * function ConversationUsage({ sessionId, org }: { sessionId: string; org: string }) {
 *   const conv = useSessionConversation(sessionId, org);
 *   return <UsageWidget runs={conv.runs} />;
 * }
 * ```
 *
 * @see {@link useSessionUsage} — headless session-level usage hook
 */
export function UsageWidget({ runs, className }: UsageWidgetProps) {
  const usage = useSessionUsage(runs);

  if (!usage.hasUsage) return null;

  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-5", className)}>
      <UsageTotal usage={usage} />
      <UsageByModel usage={usage} />
    </div>
  );
}

/**
 * The session's total tokens as a figure (20/28 semibold) with its unit and
 * an "Estimated" tag when the figures are estimates; under it, at 12/16
 * muted, the working time and who served the tokens, each only when it
 * exists. Usage is never priced, so no money is shown. Internal: shared by
 * {@link UsageWidget} and the session Usage tab.
 */
export function UsageTotal({ usage }: { readonly usage: UseSessionUsageReturn }) {
  return (
    <div role="region" aria-label="Session usage summary" className="stg:flex stg:flex-col stg:gap-1 stg:px-2">
      <div className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:gap-y-1">
        <span className="stg:text-xl stg:font-semibold stg:tabular-nums stg:text-foreground">
          {formatTokenCount(usage.totalTokens)}
        </span>
        <span className="stg:text-xs stg:text-muted-foreground">
          {usage.totalTokens === 1 ? "token" : "tokens"}
        </span>
        {usage.isEstimated && <Tag className="stg:self-center">Estimated</Tag>}
      </div>
      {usage.workingSeconds > 0 && (
        <p className="stg:m-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
          {formatWorkingTime(usage.workingSeconds)} working
        </p>
      )}
      <ServedByLine rows={usage.servedBy} className="stg:m-0" />
    </div>
  );
}

/**
 * "By model": one row per model with its tokens at the right and, under its
 * name, its provider, metered calls and its input, output and cache split.
 * A report with no per-model rows lists its primary model with the
 * session's own split; one with no model at all lists nothing. Internal:
 * shared by {@link UsageWidget} and the session Usage tab.
 */
export function UsageByModel({ usage }: { readonly usage: UseSessionUsageReturn }) {
  const models = modelRows(usage);
  if (models.length === 0) return null;

  return (
    <FacetSection heading="By model">
      <List aria-label="Tokens by model">
        {models.map((entry) => (
          <ListRow
            key={`${entry.model}\0${entry.provider}`}
            name={entry.model}
            description={modelDetail(entry)}
            trailing={<TokenFigure count={entry.totalTokens} />}
          />
        ))}
      </List>
    </FacetSection>
  );
}

/** A row's token count at the right of a {@link ListRow}. */
export function TokenFigure({ count }: { readonly count: number }) {
  return (
    <span className="stg:text-sm stg:tabular-nums stg:text-foreground">
      {formatTokenCount(count)}
    </span>
  );
}

function modelRows(usage: UseSessionUsageReturn): readonly ModelUsageEntry[] {
  if (usage.modelBreakdown.length > 0) return usage.modelBreakdown;
  if (!usage.primaryModel) return [];
  return [
    {
      model: usage.primaryModel,
      provider: usage.primaryProvider,
      totalTokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      cacheReadTokens: usage.cacheReadTokens,
      callCount: usage.llmCallCount,
    },
  ];
}

/** "anthropic · 7 model calls · Input 36,904 · output 4,306 · cache read 13,000". */
function modelDetail(entry: ModelUsageEntry): string {
  const parts: string[] = [];
  if (entry.provider) parts.push(entry.provider);
  if (entry.callCount > 0) {
    parts.push(`${formatTokenCount(entry.callCount)} ${entry.callCount === 1 ? "model call" : "model calls"}`);
  }
  parts.push(`Input ${formatTokenCount(entry.inputTokens)}`, `output ${formatTokenCount(entry.outputTokens)}`);
  if (entry.cacheReadTokens > 0) parts.push(`cache read ${formatTokenCount(entry.cacheReadTokens)}`);
  if (entry.cacheCreationTokens > 0) parts.push(`cache write ${formatTokenCount(entry.cacheCreationTokens)}`);
  return parts.join(" · ");
}

const tokenFormatter = new Intl.NumberFormat("en-US");

/**
 * Formats an integer token count with comma-separated digit grouping
 * (en-US locale) for deterministic display across environments.
 */
export function formatTokenCount(count: number): string {
  return tokenFormatter.format(count);
}
