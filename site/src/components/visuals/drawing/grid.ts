/**
 * The layout engine the site's drawn pictures share: boxes and the lines
 * between them placed on a CSS grid of named areas, with no measuring in
 * JavaScript.
 *
 * A picture is data: two maps of areas (wide and compact), each a grid's
 * tracks and one string per row naming the area every cell belongs to. Every
 * box, every connector and every label is a named area, so the markup is the
 * same at both widths and each piece knows only its name. `drawingCss` turns
 * the maps into the stylesheet, so the width a picture goes wide at is
 * written once, in its own data.
 *
 * Connectors are segments anchored to their own area: each end sits on the
 * area's start, centre or end, never at a pixel coordinate, so the lines
 * follow the boxes at every width. A centre is a grid line only across one
 * track, so a line meeting a box's middle runs at the edge of a track the box
 * spans symmetrically (a box over two equal tracks meets lines on the grid
 * line between them).
 *
 * A frame is a box drawn around other areas, such as a system opened up to
 * show its parts. `grid-template-areas` names cannot overlap, so a frame is
 * never a name in the maps: it names the areas it holds, and its rectangle is
 * computed from theirs, widened by one gutter track or row on each side. A
 * gutter holds nothing but the connector pieces that cross the frame's edge.
 */

export type Layout = "wide" | "compact";

export const LAYOUTS: readonly Layout[] = ["wide", "compact"];

export interface Grid {
  columns: readonly string[];
  rows: readonly string[];
  /** One string per row, one area name (or `.`) per column. */
  map: readonly string[];
  /** The widest the grid draws, centred in the figure. */
  maxWidth: string;
  /** The boxes' text: font size and line height, in px. */
  text: readonly [number, number];
}

/** A point along or across an area. */
export type Anchor = "start" | "centre" | "end";

/** One straight piece of a connector, inside its area. */
export interface Segment {
  /** `x` runs left and right, `y` up and down. */
  axis: "x" | "y";
  /** Where it starts and ends along its axis; it points from `from` to `to`. */
  from: Anchor;
  to: Anchor;
  /** Where it sits across its axis. */
  at: Anchor;
  /** Whether it ends in a chevron at `to`. */
  arrow?: true;
}

export interface Connector {
  /** A dashed line; every other line is solid. */
  dashed?: true;
  /** The part of the picture's loop that lights it; a line no step lights rests quiet. */
  part?: string;
  segments: Record<Layout, readonly Segment[]>;
}

/** An area's place in its grid, in grid lines counted from 0: columns `x0`..`x1`, rows `y0`..`y1`. */
export interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const FRACTION: Record<Anchor, number> = { start: 0, centre: 0.5, end: 1 };

/** Where an anchor falls along an area, as a fraction of it. */
export function fraction(anchor: Anchor): number {
  return FRACTION[anchor];
}

/** Whether a segment passes through or ends at a fraction along its axis. */
function covers(segment: Segment, along: number): boolean {
  const [low, high] = [fraction(segment.from), fraction(segment.to)].sort((a, b) => a - b);
  return low <= along && along <= high;
}

/**
 * Which ends of a segment turn a corner: they meet a perpendicular segment of
 * the same area. Two lines centred on crossing grid lines stop half their
 * thickness short of each other, so the renderer runs such an end on by half
 * a thickness to close the corner; an end at a box or a chevron stops at its
 * anchor.
 */
export function corners(segments: readonly Segment[], segment: Segment): { from: boolean; to: boolean } {
  const turns = (end: Anchor) =>
    segments.some(
      (other) =>
        other.axis !== segment.axis &&
        fraction(other.at) === fraction(end) &&
        covers(other, fraction(segment.at)),
    );
  return { from: turns(segment.from), to: !segment.arrow && turns(segment.to) };
}

/** The area names a map uses, once each. */
export function areaNames(grid: Grid): Set<string> {
  return new Set(grid.map.flatMap((row) => row.split(" ")).filter((name) => name !== "."));
}

/** Each area's rectangle, as the browser reads the map (the smallest rectangle round its cells). */
export function rects(grid: Grid): Map<string, Rect> {
  const found = new Map<string, Rect>();
  grid.map.forEach((row, y) =>
    row.split(" ").forEach((name, x) => {
      if (name === ".") return;
      const rect = found.get(name);
      found.set(
        name,
        rect
          ? { x0: Math.min(rect.x0, x), x1: Math.max(rect.x1, x + 1), y0: Math.min(rect.y0, y), y1: Math.max(rect.y1, y + 1) }
          : { x0: x, x1: x + 1, y0: y, y1: y + 1 },
      );
    }),
  );
  return found;
}

/**
 * A frame's rectangle: the smallest one round the areas it holds, widened by
 * one track and one row on each side for its gutters.
 */
export function frameRect(grid: Grid, members: readonly string[]): Rect {
  const placed = rects(grid);
  const held = members.map((member) => {
    const rect = placed.get(member);
    if (!rect) throw new Error(`a frame holds ${member}, which the map does not name`);
    return rect;
  });
  return {
    x0: Math.min(...held.map((rect) => rect.x0)) - 1,
    x1: Math.max(...held.map((rect) => rect.x1)) + 1,
    y0: Math.min(...held.map((rect) => rect.y0)) - 1,
    y1: Math.max(...held.map((rect) => rect.y1)) + 1,
  };
}

/** A track's smallest width, in px: a fixed length, or a `minmax` whose floor is one. */
function trackMinimum(track: string): number {
  const fixed = /^(\d+(?:\.\d+)?)px$/.exec(track) ?? /^minmax\((\d+(?:\.\d+)?)(?:px)?,/.exec(track);
  if (!fixed) throw new Error(`no minimum width can be read from the track ${track}`);
  return Number(fixed[1]);
}

/** The narrowest a grid lays out without overflowing: the sum of its columns' minimums. */
export function minWidth(grid: Grid): number {
  return grid.columns.reduce((total, track) => total + trackMinimum(track), 0);
}

export interface DrawingStyle {
  /** The figure's attribute, without `data-`: every selector starts at `[data-<attribute>]`. */
  attribute: string;
  areas: Record<Layout, Grid>;
  /** The container width, in px, from which the drawing lays out wide. */
  wideFrom: number;
  /** Each frame, by id, and the areas it holds. */
  frames?: Readonly<Record<string, readonly string[]>>;
  /** The drawing's own rules, each a selector inside the figure and its block, per layout. */
  rules?: Partial<Record<Layout, readonly string[]>>;
}

/** A rectangle as a `grid-area` value: grid lines count from 1. */
function gridArea(rect: Rect): string {
  return `${rect.y0 + 1}/${rect.x0 + 1}/${rect.y1 + 1}/${rect.x1 + 1}`;
}

/** One layout's grid, its boxes' text, its frames, its own rules, and its segments shown and the other's hidden. */
function layoutRules(style: DrawingStyle, layout: Layout): string {
  const scope = `[data-${style.attribute}]`;
  const grid = style.areas[layout];
  const other: Layout = layout === "wide" ? "compact" : "wide";
  const areas = grid.map.map((row) => `"${row}"`).join(" ");
  return [
    `${scope} [data-${style.attribute}-drawing]{grid-template-columns:${grid.columns.join(" ")};` +
      `grid-template-rows:${grid.rows.join(" ")};grid-template-areas:${areas};max-width:${grid.maxWidth}}`,
    `${scope} [data-box]{font-size:${grid.text[0]}px;line-height:${grid.text[1]}px}`,
    `${scope} [data-layout=${other}]{display:none}`,
    `${scope} [data-layout=${layout}]{display:block}`,
    ...Object.entries(style.frames ?? {}).map(
      ([id, members]) => `${scope} [data-frame=${id}]{grid-area:${gridArea(frameRect(grid, members))}}`,
    ),
    ...(style.rules?.[layout] ?? []).map((rule) => `${scope} ${rule}`),
  ].join("");
}

/**
 * A drawing's stylesheet: the compact grid by default, a rule placing each
 * area, and the wide grid inside one container query. Every selector starts
 * at the figure's own attribute, because React hoists the sheet into the
 * page's head.
 *
 * `grid-template-areas` needs quoted strings. React escapes only `<style`
 * and `</style` in a hoisted style's text, so quotes reach the page as
 * written; the sheet holds no `<`, the one character that escaping touches.
 */
export function drawingCss(style: DrawingStyle): string {
  const scope = `[data-${style.attribute}]`;
  const names = [...areaNames(style.areas.compact)];
  return [
    `${scope} [data-${style.attribute}-drawing]{display:grid;justify-content:center;margin-inline:auto}`,
    layoutRules(style, "compact"),
    ...names.map((name) => `${scope} [data-area=${name}]{grid-area:${name}}`),
    `@container (min-width:${style.wideFrom}px){${layoutRules(style, "wide")}}`,
  ].join("\n");
}
