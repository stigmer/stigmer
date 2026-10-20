"use client";

/**
 * Session usage widget: the session's tokens, per model, with an
 * "Estimated" badge when any run is counted from its runner's own report,
 * and who served the tokens when that is known.
 *
 * Numbers come from {@link useSessionUsage} (the server's session report);
 * the widget only lays them out. Usage is tokens and calls, never money,
 * so nothing here formats a currency. `formatTokenCount` stays public for
 * the context gauge and summarization views, which show exact token counts.
 * The session Usage tab suite (`session/__tests__/UsageTab.test.tsx`) and
 * `__tests__/usage-views-show-no-money.test.tsx` pin what it renders.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { cn } from "@stigmer/design-tokens";
import {
  useSessionUsage,
  type ModelUsageEntry,
} from "../session/useSessionUsage.js";
import { formatCalls, formatCompactCount, formatTokens } from "../usage/format.js";
import { ServedByLine } from "../usage/ServedByLine.js";

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
 * Shows the session's total tokens (marked "Estimated" when any run is
 * counted from its runner's own report), the model or per-model tokens,
 * metered call count, the prompt/completion and cache split, and who
 * served the tokens when that is known.
 *
 * Returns `null` when the session has no usage, matching the
 * conditional-render pattern of {@link WriteBacksWidget}.
 *
 * All visual properties flow through `--stgm-*` tokens. Zero
 * Console dependencies.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 *
 * <UsageWidget
 *   runs={conv.runs}
 * />
 * ```
 *
 * @see {@link useSessionUsage} — headless session-level usage hook
 */
export function UsageWidget({ runs, className }: UsageWidgetProps) {
  const usage = useSessionUsage(runs);

  if (!usage.hasUsage) return null;

  const multiModel = usage.modelBreakdown.length > 1;

  return (
    <div
      className={cn("stg:flex stg:flex-col stg:gap-1.5", className)}
      role="region"
      aria-label="Session usage summary"
    >
      <div className="stg:flex stg:items-baseline stg:gap-1.5">
        <span className="stg:text-sm stg:font-medium stg:tabular-nums stg:text-foreground">
          {formatTokens(usage.totalTokens)}
        </span>
        {usage.isEstimated && (
          <span className="stg:rounded stg:bg-muted stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none stg:text-muted-foreground">
            Estimated
          </span>
        )}
      </div>

      {multiModel ? (
        <ModelBreakdown models={usage.modelBreakdown} />
      ) : (
        <div className="stg:truncate stg:text-xs stg:text-muted-foreground">
          {usage.primaryModel}
          {usage.primaryProvider && ` · ${usage.primaryProvider}`}
        </div>
      )}

      {usage.llmCallCount > 0 && (
        <div className="stg:text-xs stg:tabular-nums stg:text-muted-foreground">
          {formatCalls(usage.llmCallCount)}
        </div>
      )}

      <div className="stg:pl-2 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
        prompt {formatCompactCount(usage.inputTokens)} · completion{" "}
        {formatCompactCount(usage.outputTokens)}
      </div>

      {(usage.cacheReadTokens > 0 || usage.cacheCreationTokens > 0) && (
        <CacheLine
          readTokens={usage.cacheReadTokens}
          creationTokens={usage.cacheCreationTokens}
        />
      )}

      <ServedByLine rows={usage.servedBy} />
    </div>
  );
}

function ModelBreakdown({
  models,
}: {
  readonly models: readonly ModelUsageEntry[];
}) {
  return (
    <div
      className="stg:flex stg:flex-col stg:gap-0.5"
      role="list"
      aria-label="Model token breakdown"
    >
      {models.map((entry) => (
        <div
          key={`${entry.model}\0${entry.provider}`}
          className="stg:flex stg:items-baseline stg:justify-between stg:text-xs stg:text-muted-foreground"
          role="listitem"
        >
          <span className="stg:truncate">{entry.model}</span>
          <span className="stg:ml-2 stg:shrink-0 stg:tabular-nums">
            {formatTokens(entry.totalTokens)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CacheLine({
  readTokens,
  creationTokens,
}: {
  readonly readTokens: number;
  readonly creationTokens: number;
}) {
  const parts: string[] = [];
  if (readTokens > 0) parts.push(`${formatCompactCount(readTokens)} read`);
  if (creationTokens > 0)
    parts.push(`${formatCompactCount(creationTokens)} write`);

  return (
    <div className="stg:pl-2 stg:text-xs stg:tabular-nums stg:text-muted-foreground">
      cache {parts.join(" · ")}
    </div>
  );
}

const tokenFormatter = new Intl.NumberFormat("en-US");

/**
 * Formats an integer token count with comma-separated digit grouping
 * (en-US locale) for deterministic display across environments.
 */
export function formatTokenCount(count: number): string {
  return tokenFormatter.format(count);
}
