"use client";

/**
 * A small line chart of one dated series, drawn inline with no charting
 * dependency: a daily pass rate on an agent's Quality tab today, and any
 * per-day number (an agent's usage) tomorrow.
 *
 * The line is SVG stretched to the plot box with strokes that do not
 * scale, so it stays two pixels at any width; the dots, the markers and
 * their hover targets are HTML over it, placed in percent, so they stay
 * round. A `null` value is a gap that breaks the line (`trend-layout.ts`
 * has the rules). Each dot shows its date, value and count in the SDK's
 * tooltip on hover, never a native title. The plot is one image to a
 * screen reader, named by `label` and described in a sentence, and a
 * visually hidden table of every point and marker is the full reading, so
 * the dots are not tab stops: ninety of them would be ninety stops.
 *
 * Colours come only from the theme's categorical chart tokens
 * (`--stgm-chart-1` to `--stgm-chart-5`, picked by `series`); the grid,
 * the markers and every piece of text wear the main text and border
 * tokens, never the series colour. Pinned by `__tests__/TrendChart.test.tsx`
 * and `__tests__/trend-layout.test.ts`.
 */

import { useId } from "react";
import { cn } from "@stigmer/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import {
  describeTrend,
  domainOf,
  scaleMaxOf,
  segmentsOf,
  xOf,
  type TrendMarker,
  type TrendPoint,
} from "./trend-layout.js";

export type { TrendMarker, TrendPoint } from "./trend-layout.js";

/** Which of the theme's five categorical chart colours draws the line. */
export type TrendSeries = 1 | 2 | 3 | 4 | 5;

/** Props for {@link TrendChart}. */
export interface TrendChartProps {
  /** What the chart shows, as its visible caption and its accessible name. */
  readonly label: string;
  /** The series, any order; a `null` value is a gap that breaks the line. */
  readonly points: readonly TrendPoint[];
  /** Days to call out with a dot under the plot (a new agent version). */
  readonly markers?: readonly TrendMarker[];
  /** First day of the x axis (YYYY-MM-DD); the first point's day when omitted. */
  readonly from?: string;
  /** Last day of the x axis (YYYY-MM-DD); the last point's day when omitted. */
  readonly to?: string;
  /** The value the top of the plot stands for; the largest value when omitted (1 for a rate). */
  readonly max?: number;
  /** A value as text, as in "83%". @default String */
  readonly formatValue?: (value: number) => string;
  /** A point's count as text, as in "12 runs". @default the number */
  readonly formatCount?: (count: number) => string;
  /** The chart colour token the line wears. @default 1 */
  readonly series?: TrendSeries;
  /** Replaces the generated one-sentence description a screen reader hears. */
  readonly description?: string;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

const LINE_CLASS: Record<TrendSeries, string> = {
  1: "stg:text-chart-1",
  2: "stg:text-chart-2",
  3: "stg:text-chart-3",
  4: "stg:text-chart-4",
  5: "stg:text-chart-5",
};

const DOT_CLASS: Record<TrendSeries, string> = {
  1: "stg:bg-chart-1",
  2: "stg:bg-chart-2",
  3: "stg:bg-chart-3",
  4: "stg:bg-chart-4",
  5: "stg:bg-chart-5",
};

const HIT_TARGET_CLASS =
  "stg:absolute stg:flex stg:size-4 stg:-translate-x-1/2 stg:-translate-y-1/2 stg:items-center stg:justify-center";

/**
 * A line chart of one dated series with gaps, day markers, tooltips and a
 * table fallback.
 *
 * @example
 * ```tsx
 * <TrendChart
 *   label="Run health, daily pass rate"
 *   points={[{ date: "2026-10-01", value: 0.9, count: 10 }]}
 *   max={1}
 *   formatValue={(rate) => `${Math.round(rate * 100)}%`}
 *   formatCount={(count) => `${count} runs`}
 * />
 * ```
 */
export function TrendChart({
  label,
  points,
  markers = [],
  from,
  to,
  max,
  formatValue = String,
  formatCount = String,
  series = 1,
  description,
  className,
}: TrendChartProps) {
  const descriptionId = useId();
  const hasPoints = points.length > 0 || (from !== undefined && to !== undefined);
  const domain = hasPoints ? domainOf(points, from, to) : { first: 0, last: 0 };
  const scaleMax = scaleMaxOf(points, max);
  const segments = hasPoints ? segmentsOf(points, domain, scaleMax) : [];
  const shownMarkers = markers.filter((marker) => {
    const x = xOf(marker.date, domain);
    return hasPoints && Number.isFinite(x) && x >= 0 && x <= 100;
  });
  const sentence =
    description ??
    describeTrend(label, points, shownMarkers, formatValue, formatCount);

  return (
    <figure className={cn("stg:m-0 stg:flex stg:flex-col stg:gap-1", className)}>
      <figcaption className="stg:text-xs stg:text-muted-foreground">
        {label}
      </figcaption>
      <div className="stg:flex stg:gap-1.5">
        <div
          aria-hidden="true"
          className="stg:flex stg:h-20 stg:flex-col stg:justify-between stg:text-right stg:text-2xs stg:tabular-nums stg:text-muted-foreground"
        >
          <span>{formatValue(scaleMax)}</span>
          <span>{formatValue(0)}</span>
        </div>
        <div className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:gap-1">
        <div
          role="img"
          aria-label={label}
          aria-describedby={descriptionId}
          data-testid="trend-plot"
          className="stg:relative stg:h-20"
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="stg:absolute stg:inset-0 stg:size-full stg:overflow-visible"
          >
            {[0, 50, 100].map((y) => (
              <line
                key={y}
                x1={0}
                x2={100}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                className="stg:text-border"
              />
            ))}
            {shownMarkers.map((marker) => {
              const x = xOf(marker.date, domain);
              return (
                <line
                  key={`marker-${marker.date}`}
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={100}
                  stroke="currentColor"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                  className="stg:text-muted-foreground"
                />
              );
            })}
            {segments
              .filter((segment) => segment.length > 1)
              .map((segment) => (
                <polyline
                  key={`line-${segment[0]?.point.date}`}
                  data-segment=""
                  points={segment.map((placed) => `${placed.x},${placed.y}`).join(" ")}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                  className={LINE_CLASS[series]}
                />
              ))}
          </svg>
          {segments.flat().map((placed) => (
            <Tooltip key={placed.point.date}>
              <TooltipTrigger
                render={
                  <span
                    data-point={placed.point.date}
                    className={HIT_TARGET_CLASS}
                    style={{ left: `${placed.x}%`, top: `${placed.y}%` }}
                  />
                }
              >
                <span
                  className={cn(
                    "stg:size-2 stg:rounded-full stg:ring-2 stg:ring-background",
                    DOT_CLASS[series],
                  )}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="stg:text-xs">
                {placed.point.date}: {formatValue(placed.value)} (
                {formatCount(placed.point.count)})
              </TooltipContent>
            </Tooltip>
          ))}
          {shownMarkers.map((marker) => (
            <Tooltip key={`marker-${marker.date}`}>
              <TooltipTrigger
                render={
                  <span
                    data-marker={marker.date}
                    className={HIT_TARGET_CLASS}
                    style={{ left: `${xOf(marker.date, domain)}%`, top: "100%" }}
                  />
                }
              >
                <span className="stg:size-2 stg:rounded-full stg:bg-muted-foreground stg:ring-2 stg:ring-background" />
              </TooltipTrigger>
              <TooltipContent side="top" className="stg:text-xs">
                {marker.date}: {marker.label}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {hasPoints && (
          <div
            aria-hidden="true"
            className="stg:flex stg:justify-between stg:text-2xs stg:tabular-nums stg:text-muted-foreground"
          >
            <span>{from ?? earliestDate(points)}</span>
            <span>{to ?? latestDate(points)}</span>
          </div>
        )}
        </div>
      </div>
      <p id={descriptionId} className="stg:sr-only">
        {sentence}
      </p>
      <table className="stg:sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Value</th>
            <th scope="col">Count</th>
          </tr>
        </thead>
        <tbody>
          {[...points]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.date}</th>
                <td>
                  {point.value === null ? "gap" : formatValue(point.value)}
                </td>
                <td>{formatCount(point.count)}</td>
              </tr>
            ))}
          {shownMarkers.map((marker) => (
            <tr key={`marker-${marker.date}`}>
              <th scope="row">{marker.date}</th>
              <td colSpan={2}>{marker.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function earliestDate(points: readonly TrendPoint[]): string {
  return points.reduce(
    (earliest, point) => (earliest === "" || point.date < earliest ? point.date : earliest),
    "",
  );
}

function latestDate(points: readonly TrendPoint[]): string {
  return points.reduce(
    (latest, point) => (point.date > latest ? point.date : latest),
    "",
  );
}
