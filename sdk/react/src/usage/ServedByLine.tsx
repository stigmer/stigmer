"use client";

/**
 * "Served by" line: whose provider credential served a usage aggregate's
 * tokens, for the organization panel and the session widget (stigmer#1441).
 *
 * The report's `served_by` rows always sum to the aggregate's tokens, with
 * tokens whose server is not known (a run counted from its runner's own
 * report, or a record older than the field) under UNSPECIFIED. The line
 * shows a split only when more than one known source appears; one known
 * source reads as a plain sentence ("All on your keys"), and an aggregate
 * with no known source shows nothing, or an "estimated" note where the
 * caller asks for one and nothing in the aggregate was metered. The rule is
 * a pure function, `summarizeServedBy`, so the suite in
 * `__tests__/ServedByLine.test.tsx` pins each shape without rendering.
 */

import { cn } from "@stigmer/theme";
import { ProviderKeySource } from "@stigmer/protos/ai/stigmer/agentic/run/v1/usage_pb";
import { formatTokens, sharePercent } from "./format.js";

/** One served-by row, from the wire (`ServedByUsage`) or the session hook. */
export interface ServedByRow {
  readonly providerKeySource: ProviderKeySource;
  readonly totalTokens: number | bigint;
  readonly llmCallCount: number;
}

/** One labelled share of a split. */
export interface ServedByShare {
  readonly label: string;
  readonly tokens: number;
  readonly percent: number;
}

/** What the line says about an aggregate's served-by rows. */
export type ServedBySummary =
  | { readonly kind: "split"; readonly shares: readonly ServedByShare[] }
  | { readonly kind: "single"; readonly text: string }
  | { readonly kind: "estimated" }
  | { readonly kind: "none" };

/** Plain label for a known credential source, `null` for UNSPECIFIED. */
function sourceLabel(source: ProviderKeySource): string | null {
  switch (source) {
    case ProviderKeySource.ORGANIZATION:
      return "your keys";
    case ProviderKeySource.PLATFORM:
      return "Stigmer's free model";
    case ProviderKeySource.UNSPECIFIED:
      return null;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

const UNKNOWN_LABEL = "source not recorded";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Decide what the served-by line says.
 *
 * - Two or more known sources: a split by tokens, the unknown remainder as
 *   its own share so the percentages account for every token.
 * - One known source: "All on your keys" when every token is attributed,
 *   else "Your keys served 12.3k tokens".
 * - No known source: `estimated` when the aggregate has tokens and no
 *   metered call (every token came from a runner's own report), else `none`.
 */
export function summarizeServedBy(rows: readonly ServedByRow[]): ServedBySummary {
  const total = rows.reduce((sum, r) => sum + Number(r.totalTokens), 0);
  const known = new Map<string, number>();
  let unknownTokens = 0;
  let unknownCalls = 0;
  for (const row of rows) {
    const tokens = Number(row.totalTokens);
    const label = sourceLabel(row.providerKeySource);
    if (label === null) {
      unknownTokens += tokens;
      unknownCalls += row.llmCallCount;
    } else if (tokens > 0 || row.llmCallCount > 0) {
      known.set(label, (known.get(label) ?? 0) + tokens);
    }
  }

  if (known.size >= 2) {
    const shares: ServedByShare[] = [...known.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([label, tokens]) => ({ label, tokens, percent: sharePercent(tokens, total) }));
    if (unknownTokens > 0) {
      shares.push({ label: UNKNOWN_LABEL, tokens: unknownTokens, percent: sharePercent(unknownTokens, total) });
    }
    return { kind: "split", shares };
  }

  if (known.size === 1) {
    const [label, tokens] = [...known.entries()][0]!;
    return unknownTokens > 0
      ? { kind: "single", text: `${capitalize(label)} served ${formatTokens(tokens)}` }
      : { kind: "single", text: `All on ${label}` };
  }

  return unknownTokens > 0 && unknownCalls === 0 ? { kind: "estimated" } : { kind: "none" };
}

/** Props for {@link ServedByLine}. */
export interface ServedByLineProps {
  /** The aggregate's served-by rows. */
  readonly rows: readonly ServedByRow[];
  /**
   * Show an "estimated" note when no known source served the tokens and
   * none was metered. Off where the caller already marks the numbers
   * estimated.
   */
  readonly showEstimated?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

/** Renders {@link summarizeServedBy} as one quiet line, or nothing. */
export function ServedByLine({ rows, showEstimated = false, className }: ServedByLineProps) {
  const summary = summarizeServedBy(rows);
  const base = cn("stg:text-xs stg:tabular-nums stg:text-muted-foreground", className);

  switch (summary.kind) {
    case "split":
      return (
        <p className={base} aria-label="Served by">
          Served by{" "}
          {summary.shares.map((share, i) => (
            <span key={share.label}>
              {i > 0 && " · "}
              {share.label} {formatTokens(share.tokens)} ({share.percent}%)
            </span>
          ))}
        </p>
      );
    case "single":
      return (
        <p className={base} aria-label="Served by">
          {summary.text}
        </p>
      );
    case "estimated":
      return showEstimated ? (
        <p className={base} aria-label="Served by">
          Estimated from the runners&apos; own reports
        </p>
      ) : null;
    case "none":
      return null;
    default: {
      const unreachable: never = summary;
      return unreachable;
    }
  }
}
