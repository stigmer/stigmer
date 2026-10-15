/**
 * Pure geometry behind `TrendChart`: where a dated point sits on the plot,
 * which points join into one line, and the sentence a screen reader hears.
 * Kept apart from the component so the rules are unit-testable without a
 * DOM.
 *
 * The x axis is calendar time, not point order: a point's place is its
 * day's distance from the first day shown, so a week with no data reads as
 * a week. Days with no point are joined across, because no data is not a
 * change; a point whose value is `null` is a gap, and the line breaks on
 * either side of it, because a gap says the numbers on its two sides are
 * not comparable (an evaluator's rules changed between them). A point with
 * no neighbour on the line still shows as a dot. Coordinates are percent of
 * the plot box, y growing downwards as the SVG's does. Pinned by
 * `__tests__/trend-layout.test.ts`.
 */

/** One dated value on a trend chart. */
export interface TrendPoint {
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  /** The value that day; `null` marks a gap that breaks the line. */
  readonly value: number | null;
  /** How many things the value counts (runs graded, calls made), shown beside it. */
  readonly count: number;
}

/** A day called out on a trend chart, as a dot under the plot. */
export interface TrendMarker {
  /** The day, as YYYY-MM-DD. */
  readonly date: string;
  /** What happened that day, as the marker's tooltip and the table read it. */
  readonly label: string;
}

/** A point placed on the plot, in percent of the plot box. */
export interface PlacedPoint {
  readonly point: TrendPoint;
  readonly value: number;
  readonly x: number;
  readonly y: number;
}

const DAY_MS = 86_400_000;

/** The plot's inset from each edge, in percent, so a dot at an edge is whole. */
export const PLOT_INSET = 4;

/** Days since the epoch for a YYYY-MM-DD date (UTC); `NaN` for anything else. */
export function dayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return Number.NaN;
  return (
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
  );
}

/** The span a chart covers: `from` and `to` when given, else its first and last point. */
export function domainOf(
  points: readonly TrendPoint[],
  from?: string,
  to?: string,
): { readonly first: number; readonly last: number } {
  const days = points.map((point) => dayNumber(point.date));
  const first = from !== undefined ? dayNumber(from) : Math.min(...days);
  const last = to !== undefined ? dayNumber(to) : Math.max(...days);
  return { first, last };
}

/** Where a day sits across the plot, in percent; the middle when the span is one day. */
export function xOf(
  date: string,
  domain: { readonly first: number; readonly last: number },
): number {
  const span = domain.last - domain.first;
  const share = span > 0 ? (dayNumber(date) - domain.first) / span : 0.5;
  return PLOT_INSET + share * (100 - 2 * PLOT_INSET);
}

/** Where a value sits up the plot, in percent from the top, against `max` (0 at the bottom). */
export function yOf(value: number, max: number): number {
  const share = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return 100 - PLOT_INSET - share * (100 - 2 * PLOT_INSET);
}

/** The value the top of the plot stands for: `max` when given, else the largest value, else 1. */
export function scaleMaxOf(points: readonly TrendPoint[], max?: number): number {
  if (max !== undefined && max > 0) return max;
  const largest = Math.max(
    0,
    ...points.map((point) => point.value ?? 0),
  );
  return largest > 0 ? largest : 1;
}

/**
 * The points as runs of joined dots, oldest first: each run is a line, a
 * gap (`null` value) ends one, and a run of one point is a lone dot.
 */
export function segmentsOf(
  points: readonly TrendPoint[],
  domain: { readonly first: number; readonly last: number },
  max: number,
): readonly (readonly PlacedPoint[])[] {
  const sorted = [...points].sort(
    (a, b) => dayNumber(a.date) - dayNumber(b.date),
  );
  const segments: PlacedPoint[][] = [];
  let open: PlacedPoint[] | null = null;
  for (const point of sorted) {
    if (point.value === null) {
      open = null;
      continue;
    }
    const placed: PlacedPoint = {
      point,
      value: point.value,
      x: xOf(point.date, domain),
      y: yOf(point.value, max),
    };
    if (open === null) {
      open = [placed];
      segments.push(open);
    } else {
      open.push(placed);
    }
  }
  return segments;
}

/**
 * The chart in one sentence: what it shows, over which days, how many
 * points and gaps, the latest value with its count, and the marked days.
 */
export function describeTrend(
  label: string,
  points: readonly TrendPoint[],
  markers: readonly TrendMarker[],
  formatValue: (value: number) => string,
  formatCount: (count: number) => string,
): string {
  const valued = points.filter(
    (point): point is TrendPoint & { readonly value: number } =>
      point.value !== null,
  );
  if (valued.length === 0) return `${label}: no data.`;
  const sorted = [...valued].sort(
    (a, b) => dayNumber(a.date) - dayNumber(b.date),
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const gaps = points.length - valued.length;
  const parts = [
    `${label}: ${valued.length} ${valued.length === 1 ? "day" : "days"} from ${first?.date} to ${last?.date}`,
    `latest ${formatValue(last?.value ?? 0)} on ${last?.date} (${formatCount(last?.count ?? 0)})`,
  ];
  if (gaps > 0) {
    parts.push(`${gaps} ${gaps === 1 ? "gap" : "gaps"}`);
  }
  if (markers.length > 0) {
    parts.push(
      `marked: ${markers.map((marker) => `${marker.date} ${marker.label}`).join("; ")}`,
    );
  }
  return `${parts.join(", ")}.`;
}
